/**
 * Commander-damage math shared by `GameBoard`'s cmd-focus panels and
 * `OnlineGameView`'s from-seat picker — a leaf module (no component imports)
 * so both surfaces read rule 903.10a's 21-per-commander threshold the same
 * way.
 */

/** Progress toward 21 commander damage, clamped to [0, 1] for a --fill bar. */
export function cmdDamageFillRatio(value: number): number {
  return Math.max(0, Math.min(value, 21)) / 21;
}

/** "N to lethal" hint text, or null when there's nothing worth showing (0, or already lethal). */
export function cmdDamageToLethal(value: number): number | null {
  return value > 0 && value < 21 ? 21 - value : null;
}
