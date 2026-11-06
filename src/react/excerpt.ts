// A bounded excerpt of text a message visibly shows: whitespace collapsed,
// directional formatting removed (the excerpt is isolated where it is
// shown), and cut to a number of grapheme clusters, never inside one.

/** How many grapheme clusters an excerpt keeps before its ellipsis. */
export const EXCERPT_GRAPHEMES = 120;
const DIRECTIONAL = /[‪-‮⁦-⁩]/g;

/** The excerpt, or none when nothing visible is left or graphemes cannot be told apart. */
export function excerpt(
  text: string,
  limit = EXCERPT_GRAPHEMES,
): string | undefined {
  const plain = text.replace(DIRECTIONAL, "").replace(/\s+/g, " ").trim();
  if (!plain) return undefined;
  // Code points would split combining marks, flags and joined emoji.
  if (typeof Intl.Segmenter !== "function") return undefined;
  // Segmented only as far as the cut: the bound plus one cluster.
  const kept: string[] = [];
  for (const cluster of new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(plain)) {
    if (kept.length === limit) return `${kept.join("")}…`;
    kept.push(cluster.segment);
  }
  return plain;
}
