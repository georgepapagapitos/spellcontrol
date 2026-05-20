import type { ComboMatch, ComboMatchResponse, ComboSummary } from '@/types/combos';
import { getAllCombos } from './db';
import type { OfflineCombo } from './types';

/**
 * Local port of backend `combos/match.ts:matchCombos()` — identical bucketing
 * logic so the offline UI sees the same shape it would over the wire.
 */
const ALMOST_LIMIT = 200;

export async function matchCombosLocal(opts: {
  ownedOracleIds: Iterable<string>;
  deckOracleIds?: Iterable<string>;
  format?: string;
}): Promise<ComboMatchResponse> {
  const all = await getAllCombos();
  const owned = toSet(opts.ownedOracleIds);
  const inDeckSet = opts.deckOracleIds ? toSet(opts.deckOracleIds) : null;

  const inDeck: ComboMatch[] = [];
  const oneAway: ComboMatch[] = [];
  const almostInCollection: ComboMatch[] = [];

  for (const combo of all) {
    if (opts.format && combo.legalities[opts.format] !== 'legal') continue;
    if (combo.cards.length === 0) continue;

    const present: string[] = [];
    const missing: string[] = [];

    if (inDeckSet) {
      for (const card of combo.cards) {
        (inDeckSet.has(card.oracleId) ? present : missing).push(card.oracleId);
      }
      if (missing.length === 0) {
        inDeck.push({
          combo: toSummary(combo),
          presentOracleIds: present,
          missingOracleIds: [],
        });
        continue;
      }
      if (missing.length === 1) {
        oneAway.push({
          combo: toSummary(combo),
          presentOracleIds: present,
          missingOracleIds: missing,
        });
      }
      continue;
    }

    for (const card of combo.cards) {
      (owned.has(card.oracleId) ? present : missing).push(card.oracleId);
    }
    if (missing.length === 0) {
      inDeck.push({
        combo: toSummary(combo),
        presentOracleIds: present,
        missingOracleIds: [],
      });
    } else if (missing.length === 1) {
      almostInCollection.push({
        combo: toSummary(combo),
        presentOracleIds: present,
        missingOracleIds: missing,
      });
    }
  }

  const byPopularity = (a: ComboMatch, b: ComboMatch) => b.combo.popularity - a.combo.popularity;
  inDeck.sort(byPopularity);
  oneAway.sort(byPopularity);
  almostInCollection.sort(byPopularity);

  return {
    inDeck,
    oneAway,
    almostInCollection: almostInCollection.slice(0, ALMOST_LIMIT),
  };
}

function toSet(ids: Iterable<string>): Set<string> {
  return ids instanceof Set ? ids : new Set(ids);
}

function toSummary(c: OfflineCombo): ComboSummary {
  return {
    id: c.id,
    identity: c.identity,
    produces: c.produces,
    prerequisites: c.prerequisites,
    description: c.description,
    manaNeeded: c.manaNeeded,
    popularity: c.popularity,
    cardCount: c.cardCount,
    bracket: c.bracket,
    cards: c.cards.map((cc) => ({
      oracleId: cc.oracleId,
      cardName: cc.cardName,
      quantity: cc.quantity,
    })),
  };
}
