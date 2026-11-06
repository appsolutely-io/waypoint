/**
 * A locale Intl accepts for a tag: its canonical form when Intl accepts
 * it, else the language of the tag's catalogue (`zh-Hans` for Simplified
 * Chinese, `en` otherwise). Intl refuses with a RangeError tags that RFC
 * 5646 allows (extended language subtags, some grandfathered tags) as well
 * as malformed ones, so no tag is given to Intl as is.
 */
export function intlLocale(locale: string, simplified: boolean): string {
  try {
    return Intl.getCanonicalLocales(locale)[0]!;
  } catch {
    return simplified ? "zh-Hans" : "en";
  }
}
