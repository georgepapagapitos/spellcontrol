/**
 * Compact count formatter (e.g. 1234 -> "1.2k") shared by the header's
 * card/binder/list counts and the public deck/profile page's view/copy
 * counters. Pure extraction of Header.tsx's original private helper, zero
 * behavior change — Header.tsx's own inline copy is retargeted to import
 * this in the sibling w1-public-profile-page PR, not here.
 */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}
