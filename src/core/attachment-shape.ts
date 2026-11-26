// The rules every copy of a message's files agrees on: how many files a
// message may carry, what one file must look like and what a host takes.
// The upload chunk, the read of a page and the composer's picker all read
// them here, so the three cannot drift apart.
import type { MessageAttachment } from "../protocol/generated";

/** The files one message may carry. */
export const MAX_ATTACHMENTS = 20;

/** The longest a file's name may be. */
export const MAX_NAME_LENGTH = 300;

/** The longest a file's media type may be. */
export const MAX_MEDIA_TYPE_LENGTH = 255;

/** Whether a value is a string with something in it. */
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/**
 * Whether a value is a file the protocol allows. A stored file names the
 * id the host gave it; a file that is not stored yet has none.
 */
export const attachmentWellFormed = (
  value: unknown,
  stored: boolean,
): value is MessageAttachment => {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<MessageAttachment>;
  return (
    (stored ? nonempty(file.id) : file.id === undefined || nonempty(file.id)) &&
    nonempty(file.name) &&
    file.name.length <= MAX_NAME_LENGTH &&
    nonempty(file.mediaType) &&
    file.mediaType.length <= MAX_MEDIA_TYPE_LENGTH &&
    typeof file.size === "number" &&
    Number.isSafeInteger(file.size) &&
    file.size >= 0 &&
    (file.url === undefined || nonempty(file.url))
  );
};

/**
 * The problem codes a file store can meet, whichever side said them. The
 * words a row gets for its files follow this list.
 */
export const STORE_FAILURES = [
  "refused",
  "rate-limited",
  "unavailable",
  "attachments-lost",
] as const;
/** Any one of the codes a file store can meet. */
export type StoreFailure = (typeof STORE_FAILURES)[number];
/**
 * Whether a code is one a file store can meet, whichever side said it.
 * The codes are widened for a plain string only in this module.
 */
export const isStoreFailure = (code: string): code is StoreFailure =>
  (STORE_FAILURES as readonly string[]).includes(code);
/**
 * The codes a host may say about files it was asked to store. The client's
 * own attachments-lost never travels from a host, so a host that says it
 * anyway is refused like any other error a store cannot meet.
 */
export const HOST_STORE_FAILURES = [
  "refused",
  "rate-limited",
  "unavailable",
] as const;
/**
 * Whether a code is one only the client may say about its files: a host
 * cannot know that the client no longer holds the bytes it was asked to
 * store. A code a host may say travels as the side that said it said it,
 * and this one comes back as the refusal it is.
 */
export const isClientOnlyStoreFailure = (code: string): boolean =>
  isStoreFailure(code) &&
  !(HOST_STORE_FAILURES as readonly string[]).includes(code);
/**
 * The words a row's files line follows its failure code with, one message
 * key per outcome: what the host refused, what it asked to wait for, what
 * never reached it, and what is gone for good.
 */
export const STORE_FAILURE_TEXT = {
  refused: "chat.attachmentFailed",
  "rate-limited": "chat.attachmentNotUploadedYet",
  unavailable: "chat.attachmentNotUploaded",
  "attachments-lost": "chat.attachmentLost",
} as const;

/**
 * Whether the host takes a file of this media type. A type the host names
 * may end in "/*", which takes every type under it. Media types compare
 * without regard to case, as RFC 2045 reads them.
 */
export const acceptsMediaType = (
  accept: readonly string[] | undefined,
  mediaType: string,
): boolean => {
  if (accept === undefined) return true;
  const type = mediaType.toLowerCase();
  return accept.some((named) => {
    const taken = named.toLowerCase();
    return (
      taken === type ||
      // The bare wildcard takes every type; a prefix like "x/*" takes only
      // the types under it.
      (taken.endsWith("/*") &&
        (taken === "*/*" || type.startsWith(taken.slice(0, -1))))
    );
  });
};

/** Whether the host takes a file of this size. */
export const acceptsSize = (
  maxBytes: number | undefined,
  size: number,
): boolean => maxBytes === undefined || size <= maxBytes;

/** Whether the host takes a file of this media type and this size. */
export const acceptsFile = (
  accept: readonly string[] | undefined,
  maxBytes: number | undefined,
  mediaType: string,
  size: number,
): boolean =>
  acceptsMediaType(accept, mediaType) && acceptsSize(maxBytes, size);
