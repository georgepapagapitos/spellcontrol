import { useMemo, useState } from 'react';
import { type Deck } from '@/store/decks';
import { type DeckView } from '@/lib/deck-analysis/deck-view';
import { isCollectionScope, type AiScope } from '@/lib/ai/ai-scope';
import { buildRefinePool } from '@/lib/ai/ai-refine';
import { constrainsToCollection } from '@/deck-builder/services/deckBuilder/deckFilters';
import {
  buildSubstitutionOptions,
  type SubstituteCandidate,
} from '@/deck-builder/services/deckBuilder/substituteFinder';
import { staplesToSubstitute } from '@/lib/coach/coach-changes';
import { collectionLandsAsCards, landUpgradeCandidates } from '@/lib/coach/land-candidates';
import { useSubstituteRanking } from '@/components/deck/useSubstituteRanking';
import * as substitutesV2 from '@/deck-builder/services/substitutes/surfaces';
import type { ScryfallCard } from '@/deck-builder/types';
import { computeLandUpgrades } from '@/deck-builder/services/deckBuilder/landUpgrades';
import { useSearchCards } from '@/lib/search/use-search-cards';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { fetchFixingLands } from './deck-editor-helpers';
import type { EnrichedCard } from '@spellcontrol/binder-routing';

export function useDeckRefineData({
  collectionCards,
  view,
  deck,
  ownedNames,
  liveRoleCounts,
  commanderColorIdentity,
  deckCards,
  deckCardNames,
}: {
  collectionCards: EnrichedCard[];
  view: DeckView;
  deck: Deck;
  ownedNames: Set<string>;
  liveRoleCounts: Record<string, number> | undefined;
  commanderColorIdentity: string[];
  deckCards: ScryfallCard[];
  deckCardNames: Set<string>;
}) {
  // Owned-substitute plan ("From your collection") — derived live from the
  // persisted gap analysis + the live collection (ownership is intentionally a
  // UI-layer concern; the analysis orchestrator stays collection-agnostic).
  // For each EDHREC staple the deck wants but doesn't own, find an owned card
  // filling the same role within color identity. Pure + cheap → recompute on
  // change rather than persist.
  // One candidate per NAME, not per physical copy: the finder ranks by name
  // (role, identity, similarity are all per card, not per copy), so 11.5k
  // copies collapse to ~4.4k names — and the pool survives deck edits (E276).
  const ownedPool = useMemo(() => {
    const byName = new Map<string, SubstituteCandidate>();
    for (const c of collectionCards) {
      if (byName.has(c.name)) continue;
      byName.set(c.name, {
        name: c.name,
        colorIdentity: c.colorIdentity ?? [],
        cmc: c.cmc,
        typeLine: c.typeLine,
      });
    }
    return [...byName.values()];
  }, [collectionCards]);
  // E517: v2 re-ranks the owned alternatives once its card facts load (the Coach tab asks).
  const substitutesReady = useSubstituteRanking(view === 'tune');
  const substitutionPlan = useMemo(() => {
    if (!deck || !DECK_FORMAT_CONFIGS[deck.format].hasCommander) return null;
    const gap = deck.gapAnalysis;
    if (!gap || gap.length === 0) return null;
    // Staples worth substituting: role-bearing, not owned, in a role the deck is short on.
    const missingStaples = staplesToSubstitute(
      gap,
      ownedNames,
      liveRoleCounts ?? {},
      deck.roleTargets ?? {}
    );
    if (missingStaples.length === 0) return null;

    const deckNames = new Set(deck.cards.map((c) => c.card.name));
    const inclusionByName = new Map<string, number>(Object.entries(deck.cardInclusionMap ?? {}));
    // Options variant: each primary carries ranked owned alternatives for the
    // "N other owned options" expander (deck generation still uses the greedy
    // single-pick buildSubstitutionPlan).
    return buildSubstitutionOptions(missingStaples, ownedPool, deckNames, commanderColorIdentity, {
      inclusionByName,
      rerank: substitutesReady ? substitutesV2.ownedAlternativesReranker([...deckNames]) : null,
    });
  }, [deck, ownedNames, ownedPool, commanderColorIdentity, substitutesReady, liveRoleCounts]);

  // Strong on-color duals for the deck's colors, fetched live for the
  // "Re-analyze lands" tool's acquire rows (duals worth getting, not just ones
  // you own). Gated to 2+ color decks (minLength 2) — mono-color decks have no
  // duals to fetch; the owned-swap path still works for them. Cached 10min by
  // the search client, so re-opens are cheap. Failure is silent → owned-only.
  const identityKey = useMemo(
    () => [...commanderColorIdentity].sort().join(''),
    [commanderColorIdentity]
  );
  const { results: fetchedFixingLands } = useSearchCards(identityKey, {
    fetcher: fetchFixingLands,
    limit: 60,
    minLength: 2,
  });

  // Merit-based land upgrades — the "Re-analyze lands" tool. Scores on-color
  // candidate lands by intrinsic strength (popularity-blind, so a strong new
  // land EDHREC hasn't rated still surfaces) and proposes safe swaps for weak
  // lands in the deck. Candidate pool = the user's OWNED unused lands (apply-now)
  // + the fetched duals above (acquire). EnrichedCard is camelCase and lacks
  // produced_mana; we map owned copies to the ScryfallCard shape the engine reads
  // (producedManaColors' oracle-text fallback recovers colors) — mirroring
  // classifyOwnedCommanderPlaystyles. Fetched cards are already full ScryfallCards.
  const landUpgrades = useMemo(() => {
    const identity = new Set(commanderColorIdentity);
    if (!deck || identity.size === 0) return [];
    const owned = collectionLandsAsCards(collectionCards);
    const pool = landUpgradeCandidates(owned, fetchedFixingLands);
    return computeLandUpgrades(deckCards, identity, pool, ownedNames, deck.cardInclusionMap);
  }, [deck, commanderColorIdentity, collectionCards, deckCards, fetchedFixingLands, ownedNames]);

  /**
   * The engine's suggestions for the AI refine pass (T102 slice 4). Assembled
   * from lanes the coach ALREADY computed, so there is no new engine call and
   * the deterministic generator stays untouched.
   *
   * These are EVIDENCE, not the model's whole world — it also searches the card
   * database server-side. See `buildRefinePool` for why that changed and for
   * which of these lanes actually contain anything on a real deck.
   *
   * Owned-only builds still filter here via the same `constrainsToCollection`
   * predicate generation itself used (the fine-grained strategy survives on
   * `buildReport`, not `generationContext`, which only persists the boolean),
   * but the guarantee is enforced on the server now.
   *
   * A hand-built deck has no `buildReport`, so this alone defaults false —
   * callers OR it with the user's live `ownedOnly` toggle so the AI panel
   * still respects "owned only" on decks that were never generated.
   */
  const refineOwnedOnly = useMemo(
    () => constrainsToCollection(deck?.buildReport?.collectionStrategy ?? 'prefer'),
    [deck?.buildReport?.collectionStrategy]
  );
  /**
   * The deck's AI sources contract (T112). The player's choice wins; until
   * they make one, a deck built from the collection or mostly owned already
   * reads as "cards you own" — that default is what stops a hand-built deck
   * from being prescribed a shopping list on its very first reading. The
   * threshold is coarse on purpose: once the player touches the control the
   * answer is persisted and this derivation never runs again for the deck.
   */
  const aiScope: AiScope = useMemo(() => {
    if (deck?.aiScope) return deck.aiScope;
    if (refineOwnedOnly) return 'owned';
    const cards = deck?.cards ?? [];
    if (cards.length === 0) return 'any';
    const owned = cards.filter((c) => ownedNames.has(c.card.name)).length;
    return owned / cards.length >= 0.8 ? 'owned' : 'any';
  }, [deck?.aiScope, deck?.cards, refineOwnedOnly, ownedNames]);
  /** E274: the Coach tab's live refine reading, for the feed's "AI agrees" join. */
  const [aiAgrees, setAiAgrees] = useState<ReadonlyMap<string, string> | null>(null);
  const refinePool = useMemo(
    () =>
      deck
        ? buildRefinePool({
            gaps: deck.gapAnalysis ?? [],
            synergy: deck.synergyAnalysis?.suggestions ?? [],
            substitutes: substitutionPlan?.rows ?? [],
            hiddenGems: deck.hiddenGems ?? [],
            landUpgrades,
            deckNames: deckCardNames,
            ownedNames: isCollectionScope(aiScope) ? ownedNames : undefined,
          })
        : [],
    [deck, substitutionPlan, landUpgrades, deckCardNames, aiScope, ownedNames]
  );

  return { refinePool, aiScope, landUpgrades, setAiAgrees, substitutionPlan, aiAgrees };
}
