// The files a message carries: kept out of the eager core and loaded only
// when a host gives the client an upload port.
import type {
  AttachmentPort,
  AttachmentUpload,
  PendingAttachment,
} from "./client";
import type { MessageAttachment } from "../protocol/generated";

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

/** Whether the host takes this file. */
function accepted(file: AttachmentUpload, port: AttachmentPort): boolean {
  const accept = port.accept;
  return (
    (accept === undefined || accept.includes(file.mediaType)) &&
    (port.maxBytes === undefined || file.data.byteLength <= port.maxBytes)
  );
}

/** Whether a row's attachment is one the host can be told about. */
function wellFormed(attachment: PendingAttachment): boolean {
  return (
    typeof attachment.name === "string" &&
    attachment.name.length > 0 &&
    typeof attachment.mediaType === "string" &&
    attachment.mediaType.length > 0 &&
    Number.isSafeInteger(attachment.size) &&
    attachment.size >= 0 &&
    (attachment.id === undefined ||
      (typeof attachment.id === "string" && attachment.id.length > 0))
  );
}

/** The outbox change that keeps a message's stored references on its row. */
type AttachOperation = {
  kind: "attach";
  id: string;
  attachments: readonly PendingAttachment[];
};

/**
 * Stores the files a message carries and keeps the references the host gave
 * on the row that carries them. A file the host refuses, a file it cannot
 * store and a row whose files are gone fail the message with the refusal it
 * met.
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
    if (!wellFormed(attachment)) throw { code: "refused", id: clientMessageId };
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
    if (!file || !accepted(file, port))
      throw { code: "refused", id: clientMessageId };
    let id: string;
    try {
      ({ id } = await port.upload(file.data, {
        conversationId,
        clientMessageId,
        fileName: file.name,
        contentType: file.mediaType,
      }));
    } catch {
      throw { code: "refused", id: clientMessageId };
    }
    stored.push({
      id,
      name: file.name,
      mediaType: file.mediaType,
      size: file.data.byteLength,
    });
  }
  staged.delete(clientMessageId);
  // The row keeps the references, so a message that is sent twice carries
  // the same ones.
  record({ kind: "attach", id: clientMessageId, attachments: stored });
  await persist();
  return stored;
}
