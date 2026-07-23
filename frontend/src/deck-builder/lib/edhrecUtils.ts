import type { EDHRECCard } from '@/deck-builder/types';

/**
 * Extract the best available USD price string from an EDHRECCard.
 * 2026-07-23 (E126): EDHREC cardlist cardviews stopped carrying `prices` —
 * always undefined now (confirmed live). Kept as a stub rather than deleted
 * + rewiring every call site, since callers still expect this signature;
 * revert to a real read if EDHREC ever restores per-card prices.
 */
export function getEdhrecCardPrice(_card: EDHRECCard): string | undefined {
  return undefined;
}

const WUBRG = 'WUBRG';

/**
 * Sort a color array in WUBRG order.
 * Pass `excludeC: true` to filter out colorless ('C') before sorting
 * (needed for EDHREC slug generation, which treats 'C' as a special key).
 */
export function sortWUBRG(colors: string[], excludeC = false): string[] {
  const filtered = excludeC ? colors.filter((c) => c !== 'C') : [...colors];
  return filtered.sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
}
