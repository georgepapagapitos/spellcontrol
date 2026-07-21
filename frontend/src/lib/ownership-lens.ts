/**
 * Client-side ownership cross-reference for a public deck page
 * (w1-ownership-lens) — the social program's flagship differentiator: for a
 * signed-in viewer, cross-references a public deck's card list against the
 * VIEWER's own collection/binders, entirely client-side. The viewer's
 * collection/binder data never leaves their device (local-first mandate) —
 * only the deck's already-public card list is read.
 *
 * Deliberately store-free (mirrors lib/new-arrivals.ts's established
 * pattern): the caller (use-ownership-lens.ts) hands in plain arrays already
 * read from the stores, so this stays cheap to unit-test with no
 * store/IndexedDB side effects.
 */
import type { PublicDeckCard } from './shared-types';
import { materializeBinders } from './materialize';
import type { BinderDef, EnrichedCard } from '../types';
import type { BinderInfo } from '../components/BinderBadge';

export interface OwnershipLens {
  ownedCount: number;
  totalCount: number;
  /** 0-100, rounded. 0 when the deck has no cards. */
  percentOwned: number;
  /** Every distinct deck-card name the viewer doesn't own, in decklist order. */
  missingCardNames: string[];
  /** Keyed by card name — the deck payload carries no stable per-slot id
   *  (mirrors SharedCardTile/SharedCardList's own name-keyed convention). */
  perCard: Map<string, { owned: boolean; binders: BinderInfo[] }>;
}

function oracleIdOf(card: PublicDeckCard['card']): string | undefined {
  return typeof card.oracle_id === 'string' ? card.oracle_id : undefined;
}

/**
 * Cross-references `deckCards` (a public deck's mainboard) against the
 * viewer's own owned cards + binder rules. Ownership match is oracle-level (a
 * different printing of the same card still counts as owned), falling back to
 * a case-insensitive name match only when the deck card's embedded card
 * object lacks `oracle_id`.
 */
export function computeOwnershipLens(
  deckCards: PublicDeckCard[],
  viewerCards: EnrichedCard[],
  viewerBinders: BinderDef[]
): OwnershipLens {
  const byOracle = new Map<string, EnrichedCard[]>();
  const byName = new Map<string, EnrichedCard[]>();
  for (const c of viewerCards) {
    if (c.oracleId) {
      const arr = byOracle.get(c.oracleId);
      if (arr) arr.push(c);
      else byOracle.set(c.oracleId, [c]);
    }
    const key = c.name.toLowerCase();
    const arr = byName.get(key);
    if (arr) arr.push(c);
    else byName.set(key, [c]);
  }

  // copyId -> the one binder that routed it. materializeBinders routes each
  // physical copy to at most one binder — the exact same construction as
  // CardListTable.tsx's cardToBinder.
  const { binders } = materializeBinders(viewerCards, viewerBinders, { search: '' });
  const cardToBinder = new Map<string, BinderInfo>();
  for (const b of binders) {
    const info: BinderInfo = { id: b.def.id, name: b.def.name, color: b.def.color };
    for (const section of b.sections) {
      for (const c of section.cards) {
        if (!cardToBinder.has(c.copyId)) cardToBinder.set(c.copyId, info);
      }
    }
  }

  let ownedCount = 0;
  const missingCardNames: string[] = [];
  const perCard = new Map<string, { owned: boolean; binders: BinderInfo[] }>();

  for (const slot of deckCards) {
    const name = slot.card.name;
    if (perCard.has(name)) continue; // duplicate stack entries (e.g. basics) collapse to one
    const oracleId = oracleIdOf(slot.card);
    const owners = oracleId ? byOracle.get(oracleId) : byName.get(name.toLowerCase());
    if (owners && owners.length > 0) {
      ownedCount++;
      // A card can be owned in more than one binder across multiple physical
      // copies — collect every routed binder; BinderBadge dedupes by id.
      const cardBinders: BinderInfo[] = [];
      for (const copy of owners) {
        const info = cardToBinder.get(copy.copyId);
        if (info) cardBinders.push(info);
      }
      perCard.set(name, { owned: true, binders: cardBinders });
    } else {
      missingCardNames.push(name);
      perCard.set(name, { owned: false, binders: [] });
    }
  }

  const totalCount = perCard.size;
  const percentOwned = totalCount === 0 ? 0 : Math.round((ownedCount / totalCount) * 100);

  return { ownedCount, totalCount, percentOwned, missingCardNames, perCard };
}
