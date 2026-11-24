// The files a message carries: kept out of the eager core and loaded only
// when a host gives the client an upload port.
import type {
  AttachmentPort,
  AttachmentUpload,
  PendingAttachment,
  StoragePort,
} from "./client";
import type { MessageAttachment } from "../protocol/generated";
import type { ScopeSignal } from "./scope";
import {
  acceptsFile,
  attachmentWellFormed,
  STORE_FAILURES,
} from "./attachment-shape";

/** The files a message will carry, and the ids the host has given so far. */
export interface StagedFiles {
  files: readonly AttachmentUpload[];
  ids: (string | undefined)[];
}

/**
 * Keeps the files a message will carry in the client's own record and
 * returns what the outbox row keeps of them: their names, their media
 * types and their sizes. How many files one message may carry is the
 * send path's rule, checked before the row is queued.
 */
export function stage(
  id: string,
  attachments: readonly AttachmentUpload[],
  into: Map<string, StagedFiles>,
): PendingAttachment[] {
  into.set(id, {
    files: attachments,
    ids: attachments.map(() => undefined),
  });
  return attachments.map((file) => ({
    name: file.name,
    mediaType: file.mediaType,
    size: file.data.byteLength,
  }));
}

/** The outbox change that keeps a message's stored references on its row. */
type AttachOperation = {
  kind: "attach";
  id: string;
  attachments: readonly PendingAttachment[];
};

/**
 * Finishes a message's attempt on its own conversation's stored record,
 * wherever the client is now: the row it left behind gets a definite
 * failure instead of an attempt that never settled. The write goes
 * through the same committed path every other write takes, so a commit
 * that lands meanwhile is kept and the revision only moves forward.
 */
export async function finishAbroad(
  storage: StoragePort | undefined,
  at: string,
  id: string,
  attempt: string,
): Promise<void> {
  if (!storage) return;
  await (
    await import("./storage-commit")
  ).commitRecord(storage, at, (stored) => {
    const rows = (stored as { pending?: unknown[] } | null)?.pending;
    if (!Array.isArray(rows)) return null;
    const row = rows.find(
      (entry) => (entry as { id?: unknown } | null)?.id === id,
    ) as { open?: unknown; failure?: unknown } | undefined;
    if (!row || !Array.isArray(row.open) || !row.open.includes(attempt))
      return null;
    row.open = row.open.filter((each) => each !== attempt);
    row.failure = { code: "unavailable", id };
    return { ...stored };
  });
}

/**
 * Stores the files a message carries and keeps the references the host gave
 * on the row that carries them. Each file is kept on the row as soon as the
 * host has it, so a message whose second file fails keeps the first and a
 * retry uploads only what is missing. A file the host refuses, a file it
 * cannot store and a row whose files are gone fail the message with the
 * refusal it met; a row whose bytes the client no longer holds fails with
 * attachments-lost, and the person picks the files again.
 *
 * A scope that aborted while the files were uploading stops the loop: no
 * further file is uploaded, and the reference is not written to a
 * conversation the message does not belong to. The id is kept with the
 * staged files instead, so a retry after switching back carries it without
 * uploading the file again, and the attempt is finished with a definite
 * failure on the row's own conversation so it does not hang open.
 */
export async function upload(
  attachments: readonly PendingAttachment[],
  staged: StagedFiles | undefined,
  port: AttachmentPort | undefined,
  conversationId: string,
  clientMessageId: string,
  attempt: string,
  record: (operation: AttachOperation) => void,
  persist: () => Promise<unknown>,
  signal: ScopeSignal | undefined,
  storage: StoragePort | undefined,
  at: string,
  report: (problem: { code: "unavailable"; id: "storage-write" }) => void,
): Promise<MessageAttachment[]> {
  if (!port) throw { code: "refused", id: clientMessageId };
  const files = staged?.files ?? [];
  const ids = staged?.ids ?? [];
  const stored: MessageAttachment[] = [];
  const settle = async () => {
    try {
      await finishAbroad(storage, at, clientMessageId, attempt);
    } catch {
      report({ code: "unavailable", id: "storage-write" });
    }
  };
  const place = async (): Promise<MessageAttachment[]> => {
    for (const [index, attachment] of attachments.entries()) {
      if (!attachmentWellFormed(attachment, false))
        throw { code: "refused", id: clientMessageId };
      // A file the host already stored keeps its reference: the same
      // message may be sent twice.
      const kept = attachment.id ?? ids[index];
      if (kept) {
        stored.push({
          id: kept,
          name: attachment.name,
          mediaType: attachment.mediaType,
          size: attachment.size,
        });
        continue;
      }
      // A conversation that moved on does not get further uploads: the
      // message belongs to the conversation before.
      if (signal?.aborted) break;
      const file = files[index];
      if (!file) throw { code: "attachments-lost", id: clientMessageId };
      if (
        !acceptsFile(
          port.accept,
          port.maxBytes,
          file.mediaType,
          file.data.byteLength,
        )
      )
        throw { code: "refused", id: clientMessageId };
      let id: string;
      try {
        const result: { id?: unknown } = await port.upload(file.data, {
          conversationId,
          clientMessageId,
          index,
          fileName: file.name,
          contentType: file.mediaType,
        });
        id = typeof result.id === "string" ? result.id : "";
      } catch (error) {
        // A host's own problem travels as it is when it is one a store can
        // meet; anything else, and a code only this client says, is the
        // row's refusal.
        const code = (error as { code?: unknown } | null)?.code;
        throw typeof code === "string" &&
          code !== "attachments-lost" &&
          (STORE_FAILURES as readonly string[]).includes(code)
          ? error
          : { code: "refused", id: clientMessageId };
      }
      if (!id) throw { code: "refused", id: clientMessageId };
      ids[index] = id;
      stored.push({
        id,
        name: file.name,
        mediaType: file.mediaType,
        size: file.data.byteLength,
      });
      if (signal?.aborted) continue;
      record({
        kind: "attach",
        id: clientMessageId,
        attachments: attachments.map((entry, place) => stored[place] ?? entry),
      });
      await persist();
    }
    return stored;
  };
  try {
    const placed = await place();
    if (signal?.aborted) await settle();
    return placed;
  } catch (problem) {
    if (signal?.aborted) await settle();
    throw problem;
  }
}
