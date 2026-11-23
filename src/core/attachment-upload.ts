// The files a message carries: kept out of the eager core and loaded only
// when a host gives the client an upload port.
import type {
  AttachmentPort,
  AttachmentUpload,
  PendingAttachment,
} from "./client";
import type { MessageAttachment } from "../protocol/generated";
import { acceptsFile, attachmentWellFormed } from "./attachment-shape";

/** The files a message will carry, until the host has stored them. */
const staged = new Map<string, readonly AttachmentUpload[]>();

/**
 * Keeps the files a message will carry and returns what the outbox row
 * keeps of them: their names, their media types and their sizes.
 */
export function stage(
  id: string,
  attachments: readonly AttachmentUpload[],
): PendingAttachment[] {
  staged.set(id, attachments);
  return attachments.map((file) => ({
    name: file.name,
    mediaType: file.mediaType,
    size: file.data.byteLength,
  }));
}

/** Releases the bytes a message's files held. */
export function unstage(id: string): void {
  staged.delete(id);
}

/** The outbox change that keeps a message's stored references on its row. */
type AttachOperation = {
  kind: "attach";
  id: string;
  attachments: readonly PendingAttachment[];
};

/**
 * Stores the files a message carries and keeps the references the host gave
 * on the row that carries them. Each file is kept on the row as soon as the
 * host has it, so a message whose second file fails keeps the first and a
 * retry uploads only what is missing. A file the host refuses, a file it
 * cannot store and a row whose files are gone fail the message with the
 * refusal it met.
 */
export async function upload(
  attachments: readonly PendingAttachment[],
  port: AttachmentPort | undefined,
  conversationId: string,
  clientMessageId: string,
  record: (operation: AttachOperation) => void,
  persist: () => Promise<unknown>,
): Promise<MessageAttachment[]> {
  if (!port) throw { code: "refused", id: clientMessageId };
  const files = staged.get(clientMessageId) ?? [];
  const stored: MessageAttachment[] = [];
  for (const [index, attachment] of attachments.entries()) {
    if (!attachmentWellFormed(attachment, false))
      throw { code: "refused", id: clientMessageId };
    // A file the host already stored keeps its reference: the same
    // message may be sent twice.
    if (attachment.id) {
      stored.push({
        id: attachment.id,
        name: attachment.name,
        mediaType: attachment.mediaType,
        size: attachment.size,
      });
      continue;
    }
    const file = files[index];
    if (
      !file ||
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
      // A host's own problem travels as it is; anything else is a refusal.
      throw typeof (error as { code?: unknown } | null)?.code === "string"
        ? error
        : { code: "refused", id: clientMessageId };
    }
    if (!id) throw { code: "refused", id: clientMessageId };
    stored.push({
      id,
      name: file.name,
      mediaType: file.mediaType,
      size: file.data.byteLength,
    });
    record({
      kind: "attach",
      id: clientMessageId,
      attachments: attachments.map((entry, at) => stored[at] ?? entry),
    });
    await persist();
  }
  staged.delete(clientMessageId);
  return stored;
}
