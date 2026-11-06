export function isSafeUrl(
  url: string | null | undefined,
  extraSchemes: readonly string[] = [],
): boolean {
  // No destination is no link.
  if (typeof url !== "string" || !url) return false;
  if (/[\\\u0000-\u0020\u007f]/.test(url) || url.startsWith("//")) return false;
  if (url.startsWith("#") || url.startsWith("/")) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (!scheme || ["javascript", "vbscript", "data"].includes(scheme))
    return false;
  return [
    "https",
    "http",
    "mailto",
    ...extraSchemes.map((value) => value.toLowerCase().replace(/:$/, "")),
  ].includes(scheme);
}
