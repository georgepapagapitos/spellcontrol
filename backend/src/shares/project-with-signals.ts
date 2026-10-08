import { claimedCopyIds, summarizeCardUse } from '../friends/card-use';
import { cachedPrintingsForMissingRanks, edhrecRankOf } from './edhrec-rank';
import { stampSharePrices } from './context';
import { projectCollection, type PublicCollection, type ShareOwner } from './projections';

interface Row {
  id: string;
  data: unknown;
}

/** Decks and cubes that claim the owner's copies. Present only for a viewer
 *  who may see the trade signals (the owner, an accepted friend). */
export interface ClaimRows {
  decks: Row[];
  cubes: Row[];
}

/**
 * The per-copy collection projection shared by the profile Collection tab and
 * the friend hub's `?shape=copies`, so the two can never disagree on a card.
 *
 * Every copy carries `edhrecRank`. When `claims` is given, each also carries
 * `inDeck` (this copy is sleeved in a deck or physical cube) and `spare` (the
 * owner has a free copy past the one kept; `summarizeCardUse`, the friend hub's
 * rule). Without `claims` (a stranger) neither key is emitted, so a public
 * collection never says what the owner is building. Booleans only: no deck id
 * or name leaves here. The visible-deck set passed to `summarizeCardUse` is
 * empty because it only gates `deckIds`, which this shape never reads.
 */
export function projectWithSignals(
  owner: ShareOwner,
  liveRows: Row[],
  claims: ClaimRows | null
): PublicCollection {
  const cards = liveRows.map((r) => r.data);
  stampSharePrices(cards);
  const printings = cachedPrintingsForMissingRanks(cards as Array<Record<string, unknown>>);

  const claimed = claims ? claimedCopyIds(claims.decks, claims.cubes) : null;
  const use = claims ? summarizeCardUse(liveRows, claims.decks, claims.cubes, new Set()) : null;
  // Row id by data object, so the per-copy decorator can look its copy up.
  const idOf = new Map<unknown, string>(liveRows.map((r) => [r.data, r.id]));

  return projectCollection(owner, { cards }, (raw, card) => {
    const rank = edhrecRankOf(
      raw.edhrecRank,
      typeof raw.scryfallId === 'string' ? printings.get(raw.scryfallId) : undefined
    );
    if (rank !== undefined) card.edhrecRank = rank;
    if (!claimed || !use) return;
    card.inDeck = claimed.has(idOf.get(raw) ?? '');
    card.spare = use.get(card.oracleId ?? '')?.spare ?? false;
  });
}
