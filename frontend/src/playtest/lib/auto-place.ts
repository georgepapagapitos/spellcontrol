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
const FALLBACK_RECT = { width: 800, height: 540, cardW: CARD_W, cardH: CARD_H };

/** Horizontal overlap between cascading siblings — ~30% (more dense, less stack). */
const X_OVERLAP_FRACTION = 0.3;

/** Vertical offset applied when a row wraps to a sub-row. */
const SUB_ROW_DY = 22;

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

interface Rect {
  width: number;
  height: number;
  /** Live card box, when the caller can measure it (reads `--pt-card-w`/
   *  `--pt-card-h` off the battlefield element). Defaults to `CARD_W`/
   *  `CARD_H` — the desktop density — when the caller can't supply it. */
  cardW?: number;
  cardH?: number;
}

/**
 * Compute the auto-placement position for a card entering the battlefield
 * from hand (tap-to-play) or from a zone viewer ("→ Battlefield"). Drag
 * placements ignore this — only initial placement uses it.
 *
 * Cards cascade horizontally inside their row, wrapping to a sub-row when
 * the row fills past the battlefield width. Returns x/y as 0..1 fractions of
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

  const xStep = cardW * (1 - X_OVERLAP_FRACTION);
  const leftPad = 16;
  const rightPad = 16;
  const usableWidth = Math.max(cardW, r.width - leftPad - rightPad);
  // How many cards fit before we need to wrap. At least 1.
  const perSubRow = Math.max(1, Math.floor((usableWidth - cardW) / xStep) + 1);

  const inRow = battlefield.filter((b) => rowForCard(b.card) === row).length;
  const subRow = Math.floor(inRow / perSubRow);
  const col = inRow % perSubRow;

  const yCenter = r.height * ROW_Y_FRACTION[row];
  const x = leftPad + col * xStep;
  const y = yCenter - cardH / 2 + subRow * SUB_ROW_DY;

  // Keep within bounds so a tall hand placement never drifts off the
  // battlefield's left edge or above the top, then normalize to the fraction
  // the reducer/renderer expect.
  const xClamped = Math.max(0, Math.min(x, r.width - cardW));
  const yClamped = Math.max(0, Math.min(y, r.height - cardH));
  return {
    x: clamp01(xClamped / Math.max(1, r.width - cardW)),
    y: clamp01(yClamped / Math.max(1, r.height - cardH)),
  };
}
