/**
 * Compact count formatter: 812, 1.2k, 31k, 4.7M, 12M. One decimal below ten
 * of a unit with a trailing .0 dropped, whole units above. The one copy for
 * every count chip and deck count (the header, hub tabs, theme chips, public
 * deck and profile counters, EDHREC deck counts): a card played in millions
 * of decks read "4667k" before the M branch.
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '');
  if (n < 1000) return String(n);
  if (n < 10_000) return `${trim(n / 1000)}k`;
  // 999,500 would round to "1000k"; it reads as 1M.
  if (n < 999_500) return `${Math.round(n / 1000)}k`;
  if (n < 9_950_000) return `${trim(n / 1_000_000)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}
