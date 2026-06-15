/**
 * Pure combo-matching: given a user's owned oracle IDs and (optionally) the
 * oracle IDs in the deck they're editing, bucket every combo into:
 *
 *   - inDeck             — every card present in the deck
 *   - oneAway            — exactly one card missing from the deck, all others in the deck
 *   - almostInCollection — not in deck; user owns all-but-one across the collection
 *
 * Kept here as a pure function (no DB access) so it's trivially unit-testable
 * and so the route handler can shape the input however it wants (db rows,
 * cached blobs, etc.).
 */

export interface ComboCardRef {
  oracleId: string;
  cardName: string;
  quantity: number;
}

export interface ComboPrerequisites {
  easy?: string;
  notable?: string;
}

export interface ComboInput {
  id: string;
  identity: string;
  produces: string[];
  prerequisites: ComboPrerequisites | null;
  description: string | null;
  manaNeeded: string | null;
  popularity: number;
  legalities: Record<string, string>;
  cardCount: number;
  bracket: number | null;
  bracketTag?: string | null;
  cards: ComboCardRef[];
}

export interface ComboSummary {
  id: string;
  identity: string;
  produces: string[];
  prerequisites: ComboPrerequisites | null;
  description: string | null;
  manaNeeded: string | null;
  popularity: number;
  cardCount: number;
  bracket: number | null;
  bracketTag?: string | null;
  cards: ComboCardRef[];
}

export interface ComboMatch {
  combo: ComboSummary;
  presentOracleIds: string[];
  missingOracleIds: string[];
}

export interface MatchInput {
  combos: ComboInput[];
  ownedOracleIds: Iterable<string>;
  deckOracleIds?: Iterable<string>;
  /** When set, drop combos whose `legalities[format]` is not "legal". */
  format?: string;
}

export interface MatchResult {
  inDeck: ComboMatch[];
  oneAway: ComboMatch[];
  almostInCollection: ComboMatch[];
}

const ALMOST_LIMIT = 200;

export function matchCombos(input: MatchInput): MatchResult {
  const owned = toSet(input.ownedOracleIds);
  const inDeckSet = input.deckOracleIds ? toSet(input.deckOracleIds) : null;

  const inDeck: ComboMatch[] = [];
  const oneAway: ComboMatch[] = [];
  const almostInCollection: ComboMatch[] = [];

  for (const combo of input.combos) {
    if (input.format && combo.legalities[input.format] !== 'legal') continue;
    if (combo.cards.length === 0) continue;

    const present: string[] = [];
    const missing: string[] = [];

    if (inDeckSet) {
      for (const card of combo.cards) {
        (inDeckSet.has(card.oracleId) ? present : missing).push(card.oracleId);
      }

      if (missing.length === 0) {
        inDeck.push({ combo: toSummary(combo), presentOracleIds: present, missingOracleIds: [] });
        continue;
      }

      // One card away from the deck — includes both owned (actionable via the
      // Add button) and unowned (discovery / wishlist). The frontend
      // distinguishes the two visually and offers a filter toggle.
      if (missing.length === 1) {
        oneAway.push({
          combo: toSummary(combo),
          presentOracleIds: present,
          missingOracleIds: missing,
        });
      }
      continue;
    }

    // No deck filter — bucket against the collection alone.
    for (const card of combo.cards) {
      (owned.has(card.oracleId) ? present : missing).push(card.oracleId);
    }
    if (missing.length === 0) {
      inDeck.push({ combo: toSummary(combo), presentOracleIds: present, missingOracleIds: [] });
    } else if (missing.length === 1) {
      almostInCollection.push({
        combo: toSummary(combo),
        presentOracleIds: present,
        missingOracleIds: missing,
      });
    }
  }

  // Most-popular first within each bucket so the panel's leading rows are
  // the ones the user is most likely to recognize.
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

function toSummary(combo: ComboInput): ComboSummary {
  return {
    id: combo.id,
    identity: combo.identity,
    produces: combo.produces,
    prerequisites: combo.prerequisites,
    description: combo.description,
    manaNeeded: combo.manaNeeded,
    popularity: combo.popularity,
    cardCount: combo.cardCount,
    bracket: combo.bracket,
    bracketTag: combo.bracketTag ?? null,
    cards: combo.cards,
  };
}
