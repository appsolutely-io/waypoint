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
      // "*/*" takes every type, as a bare wildcard.
      (taken.endsWith("/*") &&
        (taken.length === 3 || type.startsWith(taken.slice(0, -1))))
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
