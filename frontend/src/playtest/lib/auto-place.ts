import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import { isPlaytestLand } from './zones';

/**
 * Type-based battlefield zoning, oriented to the player (mobile portrait /
 * desktop landscape both treat "down" as closest to you):
 *   - bottom row → lands (frequently tapped; near hand for ergonomics)
 *   - middle row → creatures + tokens (the "front line")
 *   - top row    → other permanents (artifacts, enchantments, walkers, battles)
 *
 * Sorceries/instants don't normally sit on the battlefield but if dropped here
 * they fall in with permanents.
 */

export type BattlefieldRow = 'permanents' | 'creatures' | 'lands';

/** Y centers as fractions of battlefield height. Tuned to feel like Archidekt. */
const ROW_Y_FRACTION: Record<BattlefieldRow, number> = {
  permanents: 0.17,
  creatures: 0.5,
  lands: 0.83,
};

/**
 * Default battlefield card box (matches the `.playtest-card` desktop size —
 * i.e. `--pt-card-w`/`--pt-card-h` at that density in playtest.css). Used
 * both as the packing-math card size when the caller can't supply the live
 * one, and as part of `FALLBACK_RECT` below.
 */
const CARD_W = 90;
const CARD_H = 126;

/** Reasonable defaults if we can't measure the battlefield yet. */
const FALLBACK_RECT: Rect = {
  width: 800,
  height: 540,
  cardW: CARD_W,
  cardH: CARD_H,
  reservedBottom: 0,
  reservedTop: 0,
};

/** Gap between whole cards in a row. */
const GAP = 8;

/** Share of a card's height a sub-row steps down by once a row is full: the
 *  name band and most of the art of the row above stay readable under the
 *  cards stacked over it — the way a physical table shingles a full row. */
const SUB_ROW_DY_FRACTION = 0.35;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function rowForCard(card: PlaytestCard): BattlefieldRow {
  if (card.isToken) return 'creatures';
  const t = (card.typeLine ?? '').toLowerCase();
  // "Tribal" / "Kindred" carry no permanent connotation; classify by the
  // accompanying noun (`Tribal — Goblin Creature`).
  if (isPlaytestLand(card.typeLine)) return 'lands';
  if (t.includes('creature')) return 'creatures';
  return 'permanents';
}

export interface Rect {
  width: number;
  height: number;
  /** Live card box, when the caller can measure it (reads `--pt-card-w`/
   *  `--pt-card-h` off the battlefield element). Defaults to `CARD_W`/
   *  `CARD_H` — the desktop density — when the caller can't supply it. */
  cardW?: number;
  cardH?: number;
  /**
   * Fraction (0..1) of the battlefield's height at the BOTTOM that floating
   * chrome covers and a new permanent must not land under — at the table
   * tier (≥1024px) the hand fan and the zone piles overlay the board rather
   * than sitting in rows beside it. A fraction rather than pixels because
   * the thing being cleared is itself sized off `--pt-card-h`, so a pixel
   * constant would go stale at every density. The three type rows are laid
   * out inside what's left; positions still normalize against the FULL
   * height, which is what the renderer's `top: y * (100% - cardH)` resolves
   * against.
   */
  reservedBottom?: number;
  /** Same idea for the top: the life panel floats over the board's top-left
   *  at the table tier, so the permanents row starts under it. */
  reservedTop?: number;
}

/**
 * Compute the auto-placement position for a card entering the battlefield
 * from hand (tap-to-play) or from a zone viewer ("→ Battlefield"). Drag
 * placements ignore this — only initial placement uses it.
 *
 * Cards sit side by side inside their type row, wrapping to a shingled
 * sub-row when the row fills past the battlefield width. Returns x/y as 0..1 fractions of
 * the battlefield box (see `BattlefieldCard.x` in lib/playtest/types.ts) —
 * the packing math below works in the same pixel space `rect` is measured in,
 * then normalizes at the end.
 */
export function autoPlace(
  card: PlaytestCard,
  battlefield: readonly BattlefieldCard[],
  rect?: Rect | null
): { x: number; y: number } {
  const row = rowForCard(card);
  const r = rect && rect.width > 0 && rect.height > 0 ? rect : FALLBACK_RECT;
  const cardW = r.cardW ?? CARD_W;
  const cardH = r.cardH ?? CARD_H;

  const leftPad = 16;
  const rightPad = 16;
  const usableWidth = Math.max(cardW, r.width - leftPad - rightPad);
  const inRow = battlefield.filter((b) => rowForCard(b.card) === row).length;

  // Whole cards side by side until the row is full (a real table: lands in
  // a row, not a shingled stack), then wrap to a sub-row stepped down by a
  // fraction of a card so every title stays visible. A pure function can't
  // re-space the cards already placed, so the step is never a function of
  // how many are in the row — that would land every later card on the same
  // spot.
  const wholeFit = Math.max(1, Math.floor((usableWidth + GAP) / (cardW + GAP)));
  const col = inRow % wholeFit;
  const subRow = Math.floor(inRow / wholeFit);
  const xStep = cardW + GAP;

  // The rows live above whatever floating chrome the caller reserved.
  const rowsTop = r.height * clamp01(r.reservedTop ?? 0);
  const rowsHeight = Math.max(
    cardH,
    r.height * (1 - clamp01(r.reservedTop ?? 0) - clamp01(r.reservedBottom ?? 0))
  );
  const yCenter = rowsTop + rowsHeight * ROW_Y_FRACTION[row];
  const x = leftPad + col * xStep;
  const y = yCenter - cardH / 2 + subRow * cardH * SUB_ROW_DY_FRACTION;

  // Keep within bounds so a tall hand placement never drifts off the
  // battlefield's left edge or above the top, then normalize to the fraction
  // the reducer/renderer expect.
  const xClamped = Math.max(0, Math.min(x, r.width - cardW));
  const yClamped = Math.max(rowsTop, Math.min(y, rowsTop + rowsHeight - cardH));
  return {
    x: clamp01(xClamped / Math.max(1, r.width - cardW)),
    y: clamp01(yClamped / Math.max(1, r.height - cardH)),
  };
}
