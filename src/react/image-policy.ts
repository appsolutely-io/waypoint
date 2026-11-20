import { isSafeUrl } from "./urls";
export interface MarkdownImagePolicy {
  origin?: string;
  allow?: (url: string) => boolean;
}
// Whether the renderer below shows an image as an image (its alt text is
// then not visible) rather than as a link labelled with its alt text.
export function showsImage(
  src: string,
  images?: MarkdownImagePolicy,
  extraSchemes?: readonly string[],
): boolean {
  let sameOrigin = false;
  if (images?.origin) {
    try {
      sameOrigin =
        new URL(src, images.origin).origin === new URL(images.origin).origin;
    } catch {
      sameOrigin = false;
    }
  }
  return (
    isSafeUrl(src, extraSchemes) &&
    (sameOrigin || Boolean(images?.allow?.(src)))
  );
}
