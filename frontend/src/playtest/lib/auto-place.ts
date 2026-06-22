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

/** Reasonable defaults if we can't measure the battlefield yet. */
const FALLBACK_RECT = { width: 800, height: 540 };

/**
 * Approximate dimensions of a battlefield card (matches the .playtest-card
 * desktop size in CSS). Used to size the cascade step.
 */
const CARD_W = 90;
const CARD_H = 126;

/** Horizontal overlap between cascading siblings — ~30% (more dense, less stack). */
const X_OVERLAP_FRACTION = 0.3;

/** Vertical offset applied when a row wraps to a sub-row. */
const SUB_ROW_DY = 22;

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
}

/**
 * Compute the auto-placement position for a card entering the battlefield
 * from hand (tap-to-play) or from a zone viewer ("→ Battlefield"). Drag
 * placements ignore this — only initial placement uses it.
 *
 * Cards cascade horizontally inside their row, wrapping to a sub-row when
 * the row fills past the battlefield width.
 */
export function autoPlace(
  card: PlaytestCard,
  battlefield: readonly BattlefieldCard[],
  rect?: Rect | null
): { x: number; y: number } {
  const row = rowForCard(card);
  const r = rect && rect.width > 0 && rect.height > 0 ? rect : FALLBACK_RECT;

  const xStep = CARD_W * (1 - X_OVERLAP_FRACTION);
  const leftPad = 16;
  const rightPad = 16;
  const usableWidth = Math.max(CARD_W, r.width - leftPad - rightPad);
  // How many cards fit before we need to wrap. At least 1.
  const perSubRow = Math.max(1, Math.floor((usableWidth - CARD_W) / xStep) + 1);

  const inRow = battlefield.filter((b) => rowForCard(b.card) === row).length;
  const subRow = Math.floor(inRow / perSubRow);
  const col = inRow % perSubRow;

  const yCenter = r.height * ROW_Y_FRACTION[row];
  const x = leftPad + col * xStep;
  const y = yCenter - CARD_H / 2 + subRow * SUB_ROW_DY;

  // Keep within bounds so a tall hand placement never drifts off the
  // battlefield's left edge or above the top.
  return {
    x: Math.max(0, Math.min(x, r.width - CARD_W)),
    y: Math.max(0, Math.min(y, r.height - CARD_H)),
  };
}
