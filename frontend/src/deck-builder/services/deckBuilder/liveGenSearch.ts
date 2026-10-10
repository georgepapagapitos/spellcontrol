/**
 * The whole-deck search's budget in the live-data panel (E638).
 *
 * In the app the search stops after SEARCH_TIME_BUDGET_MS (15 s) of work, so
 * how far it gets depends on how busy the machine is. Two panel runs of the same
 * code on 2026-10-09 built different Atraxa and Ur-Dragon decks, and a
 * text-only change read 13/15 composition-identical until a third run matched
 * it. A panel is an A/B instrument: it must give the same deck for the same
 * code and data. So by default the panel lifts the clock and the search stops
 * on its own evaluation cap (optimizer DEFAULT_OPTIONS.maxEvaluations), the way
 * deckGenerator.golden.test.ts compares two runs. LIVE_GEN_SEARCH_CLOCK=1 keeps
 * the app's wall clock, to measure what a user on this machine would get.
 */
export const DETERMINISTIC_SEARCH_BUDGET_MS = 600_000;

/** The `searchTimeBudgetMs` the live panel passes to generateDeck; undefined keeps the app's clock. */
export function liveSearchBudgetMs(env: Record<string, string | undefined>): number | undefined {
  return env.LIVE_GEN_SEARCH_CLOCK === '1' ? undefined : DETERMINISTIC_SEARCH_BUDGET_MS;
}
