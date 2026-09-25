import type { ComboMatch, ComboMatchResponse } from '@/types/combos';

/**
 * A complete in-deck combo that only fires because a sideboard card fills one
 * of its slots. Kept separate from `mainboardComplete` so the bracket/coach
 * side of the app (which only ever counts commander(s) + mainboard) never
 * floors on a swap-pile card the 99 doesn't actually contain.
 */
export interface SideboardComboMatch {
  match: ComboMatch;
  /** Name(s) of the sideboard card(s) this combo needs to complete. */
  sideboardCardNames: string[];
}

export interface PartitionedCombos {
  /** Complete combos using only commander(s) + mainboard cards — the only
   *  combos that should ever set a bracket floor or count toward a total. */
  mainboardComplete: ComboMatch[];
  /** Complete combos that need at least one sideboard card. Still real —
   *  the Combos panel lists them, marked with the sideboard card(s) — but
   *  they never feed the bracket, the coach, or a "combos in deck" count. */
  sideboardComplete: SideboardComboMatch[];
  /** One-away combos whose PRESENT pieces are all commander(s)/mainboard. A
   *  one-away combo that's only "close" because of a sideboard piece isn't a
   *  real one-card-away suggestion for the coach. */
  oneAway: ComboMatch[];
}

const EMPTY: PartitionedCombos = { mainboardComplete: [], sideboardComplete: [], oneAway: [] };

/**
 * Split a combo match response by zone: which complete combos actually live
 * in the mainboard + commander(s), which lean on the sideboard, and which
 * one-away combos are genuinely one mainboard-legal card away.
 *
 * `mainboardOracleIds` is commander(s) + mainboard only — never the
 * sideboard, even though the raw `data` was matched against the whole deck
 * (mainboard + sideboard) so the panel can still show sideboard-completed
 * combos.
 */
export function partitionCombosByZone(
  data: ComboMatchResponse | null | undefined,
  mainboardOracleIds: ReadonlySet<string>
): PartitionedCombos {
  if (!data) return EMPTY;

  const mainboardComplete: ComboMatch[] = [];
  const sideboardComplete: SideboardComboMatch[] = [];
  for (const match of data.inDeck) {
    const sideboardCards = match.combo.cards.filter((c) => !mainboardOracleIds.has(c.oracleId));
    if (sideboardCards.length === 0) {
      mainboardComplete.push(match);
    } else {
      sideboardComplete.push({
        match,
        sideboardCardNames: sideboardCards.map((c) => c.cardName),
      });
    }
  }

  const oneAway = data.oneAway.filter((m) =>
    m.presentOracleIds.every((id) => mainboardOracleIds.has(id))
  );

  return { mainboardComplete, sideboardComplete, oneAway };
}

/**
 * Adapt a `PartitionedCombos` back into a `ComboMatchResponse` shape (mainboard
 * view only) so it can be dropped straight into every consumer that already
 * takes a `ComboMatchResponse` — the bracket/coach/hero/nudge/badge call
 * sites don't need to change their own read of `.inDeck`/`.oneAway`, only
 * which response they're given.
 */
export function toMainboardComboData(
  data: ComboMatchResponse | null,
  partitioned: PartitionedCombos
): ComboMatchResponse | null {
  if (!data) return null;
  return { ...data, inDeck: partitioned.mainboardComplete, oneAway: partitioned.oneAway };
}
