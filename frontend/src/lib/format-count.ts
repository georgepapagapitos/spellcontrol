/**
 * Compact integer formatter for counts (cards, decks, views, copies…):
 * `999` -> `'999'`, `1500` -> `'1.5k'`, `12000` -> `'12k'`. Pure extraction of
 * Header.tsx's former private helper — zero behavior change, just made
 * reusable (and coverage-gated, since it now lives in `src/lib/**`).
 */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}
