/**
 * A `srcset` offering Scryfall's `small` (146px) beside the `normal` (488px)
 * image for a thumbnail drawn well under 488px wide.
 *
 * The browser's own downscale of a 488px card to a ~120px tile is soft: a 1x
 * screen showed the Home price movers visibly blurry next to the same card
 * served as Scryfall's pre-scaled `small`. With both widths declared, a 1x
 * screen takes `small` and a high-DPI one still takes `normal`. The sizes
 * differ only by the path segment, so `small` is a string swap; a URL that is
 * not a Scryfall `normal` image gets no srcset, and `src` stands alone.
 */
export function thumbSrcSet(normal: string): string | undefined {
  if (!normal.includes('cards.scryfall.io/normal/')) return undefined;
  const small = normal.replace('/normal/', '/small/');
  return `${small} 146w, ${normal} 488w`;
}
