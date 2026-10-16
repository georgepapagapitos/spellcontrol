import type { MarkGroup } from './copy-locations';

/** What a grid tile says about its stack before the marks, on the same plate. */
export interface PlateLead {
  qty: number;
  /** The set code chip, when the same name shows as several printings. */
  set?: { code: string; title: string };
  /** Unallocated copies, while the tradeable-surplus filter is on. */
  surplus?: number;
}

// Plate metrics in em of the plate's own font, mirroring CopyPlaces.css and
// measured in Chrome on 2026-10-16 (a two-place ×6 plate: 8.40em, the sum
// 8.45em). Each threshold carries a small margin for a wider fallback font;
// the shrink after the last step is plain flex layout, not this sum.
const EM = {
  pad: 1, // .copy-places-plate padding-inline, both sides
  gap: 0.4,
  sep: 0.1,
  disc: 1.61, // the disc's glyph, padding and 1px border
  digit: 0.62,
  countGap: 0.2,
  overlap: 0.9, // a disc's share of the row once the discs overlap
  mono: 0.68, // a set-code character, letter-spacing included
  times: 0.75, // "×" and its margin
  margin: 0.25,
} as const;

const digits = (n: number) => String(n).length;

/**
 * The one plate's widths, in em, at the two points where it gives something
 * up: `full` holds every count; `lean` has dropped the counts and overlapped
 * the discs as far as they go, set code still in. Below `full` the counts
 * fold away (the list still has them); below `lean` the set code does too,
 * which buys the discs its room. Past that they keep overlapping and, at the
 * very last, clip. CSS compares these with the tile (CopyPlaces.css).
 */
export function plateWidths(groups: readonly MarkGroup[], lead?: PlateLead) {
  const setW = lead?.set ? EM.mono * lead.set.code.length : 0;
  const leadParts = [
    lead && lead.qty > 1 ? EM.times + EM.digit * digits(lead.qty) : 0,
    setW,
    lead?.surplus ? EM.digit * (digits(lead.surplus) + 5) : 0,
  ].filter((w) => w > 0);
  const leadW = leadParts.reduce((a, b) => a + b, 0) + EM.gap * Math.max(0, leadParts.length - 1);
  const sepW = leadParts.length > 0 ? EM.gap * 2 + EM.sep : 0;
  const counts = groups.reduce(
    (w, g) => w + (g.counted ? EM.countGap + EM.digit * digits(g.copies) : 0),
    0
  );
  const discs = groups.length * EM.disc + EM.gap * (groups.length - 1);
  const stacked = EM.disc + EM.overlap * (groups.length - 1);
  const round = (n: number) => Math.ceil(n * 10) / 10;
  return {
    full: round(EM.pad + leadW + sepW + discs + counts + EM.margin),
    lean: round(EM.pad + leadW + sepW + stacked + EM.margin),
  };
}
