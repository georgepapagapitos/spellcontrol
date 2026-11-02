import { modernScryfallImage } from '@spellcontrol/deck-metrics';

/**
 * A `srcset` offering Scryfall's `thumb` (146px) beside the `grid` (488px)
 * image for a thumbnail drawn well under 488px wide.
 *
 * The browser's own downscale of a 488px card to a ~120px tile is soft: a 1x
 * screen showed the Home price movers visibly blurry next to the same card
 * served as Scryfall's pre-scaled `thumb`. With both widths declared, a 1x
 * screen takes `thumb` and a high-DPI one still takes `grid`. The sizes
 * differ only by the path segment, so `thumb` is a string swap; a URL that is
 * not a Scryfall `normal` image gets no srcset, and `src` stands alone.
 */
export function thumbSrcSet(normal: string): string | undefined {
  // A stored JPEG URL is read as its WebP twin (E1088); `grid` is `normal`,
  // `thumb` is `small`.
  const grid = modernScryfallImage(normal);
  if (!grid.includes('cards.scryfall.io/grid/')) return undefined;
  const thumb = grid.replace('/grid/', '/thumb/');
  return `${thumb} 146w, ${grid} 488w`;
}
