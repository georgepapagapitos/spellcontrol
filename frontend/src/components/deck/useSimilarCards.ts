/**
 * Sources "cards like this one" for the deck-view carousel, in two passes:
 *
 *   1. **From your collection** — owned cards that play like the focused card.
 *      Pre-filtered cheaply on the collection's own metadata (type / role / curve
 *      within the commander's identity), then the survivors are resolved to full
 *      oracle text and scored by {@link computeSimilarCards}. Owned cards lack
 *      `oracle_text` in the collection store, so this pass is async even though
 *      the candidate set is local.
 *   2. **Discovery** — the broader card pool. The focused card is classified for
 *      its synergy axes; each axis becomes a Scryfall oracle search (the same
 *      `AXIS_QUERIES` recall nets the off-meta suggester uses), and the hits are
 *      re-scored by the same similarity function. Network-backed, owned cards
 *      excluded (they're the job of pass 1).
 *
 * Both passes share one scorer, so the two lists rank by the same rules. The
 * effect is cancellable — flipping the carousel to another card abandons any
 * in-flight resolution/search. All the network/tagger glue lives here (an
 * un-gated component-tree hook); the pure scoring lives in `lib/similar-cards`.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  computeSimilarCards,
  primaryType,
  type SimilarCandidate,
  type SimilarInput,
} from '@/lib/similar-cards';
import type { ChangeOwnership } from '@/lib/deck-change';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types';
import { classifyCard } from '@/deck-builder/services/synergy/classify';
import { axisSearchQuery } from '@/deck-builder/services/synergy/oracleSearch';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';
import type { AxisSide } from '@/deck-builder/services/synergy/suggest';
import { getCardsByNames, searchCards } from '@/deck-builder/services/scryfall/client';
import { loadTaggerData, getCardRole } from '@/deck-builder/services/tagger/client';

export interface UseSimilarCardsArgs {
  /** The focused, full deck card (carries oracle text). */
  target: ScryfallCard;
  /** Names already in the deck (commanders included) — never suggested. */
  deckCardNames: readonly string[];
  /** The owned collection (one entry per physical copy). */
  collectionCards: readonly EnrichedCard[];
  /** Live, render-time ownership for a card name. */
  ownershipFor: (name: string) => ChangeOwnership;
  /** Free (unallocated) copies owned of a card name. */
  freeCountFor: (name: string) => number;
  /** Commander color identity — bounds both passes. */
  identity: string[];
  /** EDHREC inclusion % by card name (this commander), for the ranking tiebreak. */
  inclusionMap: Record<string, number>;
  /** Only do work when the carousel is open in deck view. */
  enabled: boolean;
}

export interface UseSimilarCardsResult {
  owned: SimilarCandidate[];
  discovery: SimilarCandidate[];
  loading: boolean;
}

/** Cap how many owned candidates we resolve to full cards per open (latency guard). */
const OWNED_RESOLVE_CAP = 80;
/** Cap distinct axis searches per open (each is a network round-trip). */
const DISCOVERY_QUERY_CAP = 4;
const RESULTS_PER_LIST = 6;

const EMPTY: UseSimilarCardsResult = { owned: [], discovery: [], loading: false };

export function useSimilarCards({
  target,
  deckCardNames,
  collectionCards,
  ownershipFor,
  freeCountFor,
  identity,
  inclusionMap,
  enabled,
}: UseSimilarCardsArgs): UseSimilarCardsResult {
  const [result, setResult] = useState<UseSimilarCardsResult>(EMPTY);

  // Cheap signatures so the effect re-runs on a real input change, not identity.
  const identityKey = identity.join('');
  const deckKey = deckCardNames.length;
  const collectionKey = collectionCards.length;
  const targetName = target?.name ?? '';

  // De-duped owned names within identity, excluding the deck — pre-filtered on
  // the collection's own metadata (no fetch yet).
  const ownedPrefilter = useMemo(() => {
    if (!enabled || !target) return [] as EnrichedCard[];
    const inDeck = new Set(deckCardNames.map((n) => n.toLowerCase()));
    const allowed = new Set(identity);
    const targetType = primaryType(target.type_line);
    const targetRole = getCardRole(target.name);
    const targetCmc = target.cmc;
    const seen = new Set<string>();
    const out: EnrichedCard[] = [];
    for (const c of collectionCards) {
      if (!c.name) continue;
      const key = c.name.toLowerCase();
      if (key === targetName.toLowerCase() || inDeck.has(key) || seen.has(key)) continue;
      // Within commander identity (collection metadata is enough here).
      if (identity.length > 0 && (c.colorIdentity ?? []).some((x) => !allowed.has(x))) continue;
      // Plausibly similar on cheap signals — same type, same role, or near curve.
      const sameType = !!targetType && primaryType(c.typeLine) === targetType;
      const sameRole = !!targetRole && getCardRole(c.name) === targetRole;
      const nearCurve = c.cmc != null && targetCmc != null && Math.abs(c.cmc - targetCmc) <= 1;
      if (!sameType && !sameRole && !nearCurve) continue;
      seen.add(key);
      out.push(c);
      if (out.length >= OWNED_RESOLVE_CAP) break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, targetName, identityKey, deckKey, collectionKey]);

  useEffect(() => {
    if (!enabled || !target) return;
    let cancelled = false;

    void (async () => {
      // Clear stale results + show loading the moment the focused card changes.
      setResult({ owned: [], discovery: [], loading: true });
      await loadTaggerData().catch(() => null);
      if (cancelled) return;

      const targetRole = getCardRole(target.name);
      const targetForScore = { card: target, role: targetRole };
      const ownedNames = new Set(ownedPrefilter.map((c) => c.name.toLowerCase()));

      // ── Pass 1: owned ──
      let owned: SimilarCandidate[] = [];
      if (ownedPrefilter.length > 0) {
        const resolved = await getCardsByNames(ownedPrefilter.map((c) => c.name)).catch(
          () => new Map<string, ScryfallCard>()
        );
        if (cancelled) return;
        const pool: SimilarInput[] = [];
        for (const c of ownedPrefilter) {
          const full = resolved.get(c.name);
          if (!full) continue;
          pool.push({
            card: full,
            ownership: ownershipFor(c.name),
            freeCount: freeCountFor(c.name),
            inclusion: inclusionMap[c.name],
            role: getCardRole(c.name),
          });
        }
        owned = computeSimilarCards(targetForScore, pool, {
          identity,
          maxResults: RESULTS_PER_LIST,
        });
      }

      // ── Pass 2: discovery (axis searches over the broader pool) ──
      const synergy = classifyCard(target);
      const pairs: Array<{ axis: AxisKey; side: AxisSide }> = [
        ...synergy.producers.map((p) => ({ axis: p.axis, side: 'producer' as const })),
        ...synergy.payoffs.map((o) => ({ axis: o.axis, side: 'payoff' as const })),
      ];
      const queries: string[] = [];
      const seenQ = new Set<string>();
      for (const { axis, side } of pairs) {
        const q = axisSearchQuery(axis, side);
        if (q && !seenQ.has(q)) {
          seenQ.add(q);
          queries.push(q);
          if (queries.length >= DISCOVERY_QUERY_CAP) break;
        }
      }

      let discovery: SimilarCandidate[] = [];
      if (queries.length > 0) {
        const responses = await Promise.all(
          queries.map((q) => searchCards(q, identity, {}).catch(() => null))
        );
        if (cancelled) return;
        const inDeck = new Set(deckCardNames.map((n) => n.toLowerCase()));
        const byName = new Map<string, ScryfallCard>();
        for (const res of responses) {
          for (const hit of res?.data ?? []) {
            const key = hit.name.toLowerCase();
            if (
              key === target.name.toLowerCase() ||
              inDeck.has(key) ||
              ownedNames.has(key) ||
              byName.has(key)
            ) {
              continue;
            }
            byName.set(key, hit);
          }
        }
        const pool: SimilarInput[] = [...byName.values()].map((c) => ({
          card: c,
          ownership: ownershipFor(c.name),
          freeCount: freeCountFor(c.name),
          inclusion: inclusionMap[c.name],
          role: getCardRole(c.name),
        }));
        discovery = computeSimilarCards(targetForScore, pool, {
          identity,
          maxResults: RESULTS_PER_LIST,
        });
      }

      if (!cancelled) setResult({ owned, discovery, loading: false });
    })();

    return () => {
      cancelled = true;
    };
    // ownershipFor/freeCountFor are useCallback-stable from the page; the cheap
    // keys below capture the inputs that should re-trigger sourcing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, targetName, identityKey, deckKey, collectionKey, ownedPrefilter]);

  return enabled ? result : EMPTY;
}
