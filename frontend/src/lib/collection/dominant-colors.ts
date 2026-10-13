import type { EnrichedCard } from '@/types/index';

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;
/** A color has to be in at least this share of the cards to be called out. */
const MIN_COLOR_SHARE = 0.15;
const MAX_COLORS_NAMED = 2;

/** The colors most of the collection plays, strongest first; empty for a colorless pile. */
export function dominantColors(cards: readonly EnrichedCard[]): string[] {
  if (cards.length === 0) return [];
  const counts = new Map<string, number>();
  for (const c of cards) {
    for (const color of c.colorIdentity ?? []) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  return COLOR_ORDER.filter((k) => (counts.get(k) ?? 0) / cards.length >= MIN_COLOR_SHARE)
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
    .slice(0, MAX_COLORS_NAMED);
}
