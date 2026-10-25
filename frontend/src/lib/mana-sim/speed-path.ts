import type {
  AssemblyOption,
  WinConCategory,
  WinConditionAnalysis,
} from '@/deck-builder/services/winConditions/types';

/**
 * A path whose assembly IS the kill — the pieces resolving ends the game, so
 * the clock is a real kill turn. **This now gates whether the clock renders at
 * all**, not just its wording.
 *
 * Why: for a strategic mass (aristocrats / go-wide / poison / voltron),
 * "assembled" means `STRATEGIC_MIN_CARDS` of the evidence pool have been cast —
 * a *detector qualification* bar, not a "your plan is working" bar. Measured
 * over 19 real EDHREC average decks, the resulting turn is very nearly a pure
 * function of pool SIZE rather than deck speed:
 *
 *   pool 19-20 cards → t4-t9    (Atraxa poison t4, Ghired t9, Meren t8)
 *   pool 11-12 cards → t10-t24  (Muldrotha t10, Prosper t16, Winota t24)
 *   pool 5-6 cards   → t36-t42  (Tergrid t37, Godo t36, Miirym t41)
 *
 * Miirym reading "go-wide online by turn 41" — a deck that copies dragon tokens
 * every turn — is the tell: it has a 5-card go-wide evidence pool, and the
 * number was reporting that, dressed as a turn. Kill-category clocks over the
 * same corpus are coherent and track power (Najeela t3 · Kinnan/Urza t8 ·
 * Kaalia t10 · Korvold t11 · Edgar t14 · Krenko t15 · Lathril t23), so those
 * still show. Strategic paths keep their row and evidence, just no clock line.
 *
 * Restoring a number for strategic paths means defining a real per-category
 * "online" bar (10 poison counters, a payoff plus N bodies) — a modeling job
 * with no ground truth to validate against, deliberately not attempted here.
 */
export function isKillClock(category: WinConCategory): boolean {
  return category === 'infinite-combo' || category === 'alt-win';
}

/** A win path the clock can time, with the tutors that fetch its missing pieces. */
export interface SpeedPath {
  assembly: AssemblyOption[];
  tutors: readonly string[];
}

/**
 * The deck's win path as the bracket's speed read times it, or null when there
 * is none to time: no win path, a path that is not a kill (see
 * {@link isKillClock}; generic combat has no assembly at all), or one whose
 * pieces are all in the command zone.
 *
 * An option with no library piece to draw (a combo of the commander alone, or
 * of the commander and a card the list has to name) would read as assembled on
 * turn 1 in every game, which says nothing about speed, so it is dropped.
 */
export function speedPathOf(wc: WinConditionAnalysis | null | undefined): SpeedPath | null {
  const primary = wc?.primary;
  if (!primary || !isKillClock(primary.category)) return null;
  const assembly = (primary.assembly ?? []).filter((o) => o.need >= 1 && o.names.length >= 1);
  return assembly.length > 0 ? { assembly, tutors: wc.tutors ?? [] } : null;
}
