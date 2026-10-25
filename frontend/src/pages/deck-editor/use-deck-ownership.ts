import { useCallback, useMemo } from 'react';
import { useBinderByCopyId } from '@/lib/binder/use-binder-by-copy';
import { useDecksStore, type Deck } from '@/store/decks';
import { useCubeStore } from '@/store/cube';
import type { BinderInfo } from '@/lib/binder/binder-refs';
import { filterCostPlanByOwnership } from '@/deck-builder/services/deckBuilder/costAnalyzer';
import { type ChangeOwnership } from '@/lib/coach/deck-change';
import {
  buildAllocationMap,
  classifyPrintingAvailability,
  bindableFinishesByPrinting,
  useCollectionByCopyId,
} from '@/lib/collection/allocations';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '@/types';
import type { EnrichedCard } from '@spellcontrol/binder-routing';
import { committedElsewhere } from '@/lib/deck/held-elsewhere';
import { holdsOf, type Hold } from '@/lib/coach/contention';

export function useDeckOwnership({
  collectionCards,
  deck,
}: {
  collectionCards: EnrichedCard[];
  deck: Deck;
}) {
  const decks = useDecksStore((s) => s.decks);
  const savedCubes = useCubeStore((s) => s.saved);

  const collectionById = useCollectionByCopyId();

  const ownedOracleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of collectionCards) if (c.oracleId) ids.add(c.oracleId);
    return Array.from(ids);
  }, [collectionCards]);

  // Set-form of ownedOracleIds for O(1) membership checks in combo filtering.
  const ownedOracleIdSet = useMemo(() => new Set(ownedOracleIds), [ownedOracleIds]);

  // Owned card names — lets the gap-analysis suggestions flag cards the user
  // already has in their collection.
  const ownedNames = useMemo(() => {
    const names = new Set<string>();
    for (const c of collectionCards) names.add(c.name);
    return names;
  }, [collectionCards]);

  // Allocation-aware ownership for a card name (mirrors DeckAnalysisPanel) so
  // every Tune surface agrees: 'owned' = a free/unallocated copy (or one already
  // in THIS deck) exists; 'in-other-deck' = every copy is claimed by other decks;
  // else 'unowned'. Re-derived live — never the persisted isOwned snapshot. This
  // matters because pickCollectionCopy only claims FREE copies, so a card whose
  // copies are all elsewhere can't actually be added tonight.
  const ownershipByName = useMemo(() => {
    const allocations = buildAllocationMap(decks, savedCubes);
    const byName = new Map<string, { free: number; deck: number; cube: number }>();
    for (const copy of collectionCards) {
      if (!copy.name) continue;
      const key = copy.name.toLowerCase();
      const e = byName.get(key) ?? { free: 0, deck: 0, cube: 0 };
      const claim = allocations.get(copy.copyId);
      // A copy claimed by THIS deck counts as free (we can keep it); a cube claim
      // (deckId='') never matches deck?.id, so cube copies are never "free here".
      if (!claim || claim.deckId === deck?.id) e.free += 1;
      else if (claim.ownerKind === 'cube') e.cube += 1;
      else e.deck += 1;
      byName.set(key, e);
    }
    return byName;
  }, [collectionCards, decks, savedCubes, deck?.id]);

  const ownershipFor = useCallback(
    (name: string): ChangeOwnership => {
      const e = ownershipByName.get(name.toLowerCase());
      if (!e) return 'unowned';
      if (e.free > 0) return 'owned';
      // Prefer the deck label over the cube label when copies are split — a deck
      // is the more familiar, more actionable place to pull from.
      if (e.deck > 0) return 'in-other-deck';
      if (e.cube > 0) return 'in-cube';
      return 'unowned';
    },
    [ownershipByName]
  );

  // Ownership-aware trim-cost plan (E23). Suppress cheaper-swap rows for cards the
  // user already owns and can field in this deck — you've already paid, so there's
  // no spend to trim. Only un-owned ('unowned') or all-copies-claimed-elsewhere
  // ('in-other-deck') cards keep a row. Live: re-derives from `ownershipFor` so
  // buying/selling/reallocating a copy updates the list without a re-analysis.
  const rawCostPlan = deck?.costPlan;
  const effectiveCostPlan = useMemo(
    () =>
      rawCostPlan
        ? filterCostPlanByOwnership(rawCostPlan, (name) => ownershipFor(name) === 'owned')
        : null,
    [rawCostPlan, ownershipFor]
  );

  // Free (unallocated) owned copies of a card name — drives the "N free" badge on
  // similar-card suggestions. Mirrors `ownershipFor` over the same live map.
  const freeCountFor = useCallback(
    (name: string): number => ownershipByName.get(name.toLowerCase())?.free ?? 0,
    [ownershipByName]
  );

  // Cards every copy of which sits in another deck, and what taking one costs
  // that deck (E1038 4.2). Cached per name: the role counts behind a hold are a
  // pass over the other deck, and the Cuts lane asks about each candidate.
  const holdsFor = useMemo(() => {
    const holders = committedElsewhere(
      collectionCards,
      buildAllocationMap(decks, savedCubes),
      deck?.id ?? ''
    );
    const cache = new Map<string, Hold[]>();
    return (name: string): Hold[] => {
      const key = name.toLowerCase();
      let hit = cache.get(key);
      if (!hit) {
        hit = holdsOf(name, holders.get(key), decks);
        cache.set(key, hit);
      }
      return hit;
    };
  }, [collectionCards, decks, savedCubes, deck?.id]);

  // Per-printing availability for the edit-printing picker: does the user own
  // this exact printing, and is a copy free to bind here? Same live sources as
  // ownershipFor, but keyed by scryfallId rather than name.
  const printingAllocationMap = useMemo(
    () => buildAllocationMap(decks, savedCubes),
    [decks, savedCubes]
  );
  const resolveAvailability = useCallback(
    (printing: ScryfallCard): ChangeOwnership =>
      classifyPrintingAvailability(printing.id, collectionCards, printingAllocationMap, deck?.id),
    [collectionCards, printingAllocationMap, deck?.id]
  );
  // Owned finishes per printing (one pass over the collection) so the picker
  // can show what you physically have — and constrain the finish choice —
  // instead of offering every finish Scryfall says exists.
  const ownedFinishesByPrinting = useMemo(
    () => bindableFinishesByPrinting(collectionCards, printingAllocationMap, deck?.id),
    [collectionCards, printingAllocationMap, deck?.id]
  );
  const resolveOwnedFinishes = useCallback(
    (printing: ScryfallCard): Finish[] => ownedFinishesByPrinting.get(printing.id) ?? [],
    [ownedFinishesByPrinting]
  );

  // Which binder each collection copy lives in, laid out from BinderPage's
  // own inputs, so the deck grid's badge names the binder the card is in.
  const binderByCopyId = useBinderByCopyId();

  // Re-key binderByCopyId by card name — zero extra materializeBinders calls,
  // and reuses the same canonical routing computation the review queue uses,
  // so the add-cards binder chip (E169) can never disagree with where a card
  // actually files. Feeds CardSearchPanel's Collection tab.
  const binderByCardName = useMemo(() => {
    const map = new Map<string, BinderInfo[]>();
    if (binderByCopyId.size === 0) return map;
    for (const c of collectionCards) {
      const binders = binderByCopyId.get(c.copyId);
      if (!binders) continue;
      const arr = map.get(c.name);
      if (arr) {
        for (const b of binders) if (!arr.some((x) => x.id === b.id)) arr.push(b);
      } else {
        map.set(c.name, [...binders]);
      }
    }
    return map;
  }, [binderByCopyId, collectionCards]);

  return {
    collectionById,
    ownedOracleIds,
    ownedOracleIdSet,
    printingAllocationMap,
    ownedNames,
    ownershipFor,
    holdsFor,
    binderByCardName,
    freeCountFor,
    binderByCopyId,
    effectiveCostPlan,
    resolveAvailability,
    resolveOwnedFinishes,
  };
}
