import { bracketLabel } from '@spellcontrol/deck-metrics';
import { useCallback, useRef, useState } from 'react';
import { fetchCommanderData, isPoolTooThin } from '@/deck-builder/services/edhrec/client';
import { getGameChangerNames } from '@/deck-builder/services/scryfall/client';
import type { TargetBracket } from '@/deck-builder/types';
import { computeReadiness, type ReadinessScore } from '@/lib/deck/commander-readiness';

export type ReadinessMap = Map<string, ReadinessScore | 'loading'>;
const EMPTY: ReadinessMap = new Map();

interface Options {
  canScore: boolean;
  /** Lowercased names of every card the player owns. */
  ownedCardNames: Set<string>;
  /** Lowercased owned name to the decks holding every copy of it. */
  heldBy: ReadonlyMap<string, string[]>;
  /** Target Commander bracket, or null for EDHREC's all-brackets page. */
  bracket: number | null;
}

/**
 * Per-commander "how much of its deck you own" scores for the finder, fetched
 * on demand (one EDHREC page each, which the client throttles and caches).
 *
 * The scores belong to the bracket they were cut for: each bracket keeps its
 * own map, so changing the bracket reads fresh scores and changing back is
 * instant.
 * Under a bracket, EDHREC's page for that bracket is the pool; a commander
 * with too few decks there falls back to the all-brackets page (flagged on the
 * score), and Game Changers the bracket bars are cut either way.
 */
export function useCommanderReadiness({ canScore, ownedCardNames, heldBy, bracket }: Options): {
  readiness: ReadinessMap;
  ensureReadiness: (name: string) => Promise<void>;
} {
  const scope = String(bracket ?? 'all');
  const [maps, setMaps] = useState<ReadonlyMap<string, ReadinessMap>>(new Map());
  // What each scope has fetched or is fetching; touched only inside callbacks.
  const books = useRef(new Map<string, { done: Set<string>; inflight: Set<string> }>());

  const put = useCallback((forScope: string, key: string, value: ReadinessScore | 'loading') => {
    setMaps((prev) => {
      const map = new Map(prev.get(forScope) ?? EMPTY);
      map.set(key, value);
      return new Map(prev).set(forScope, map);
    });
  }, []);

  const ensureReadiness = useCallback(
    async (name: string): Promise<void> => {
      if (!canScore) return;
      const key = name.toLowerCase();
      let book = books.current.get(scope);
      if (!book) {
        book = { done: new Set(), inflight: new Set() };
        books.current.set(scope, book);
      }
      if (book.done.has(key) || book.inflight.has(key)) return;
      const forScope = scope;
      const { done: doneSet, inflight: inflightSet } = book;
      inflightSet.add(key);
      put(forScope, key, 'loading');
      let score: ReadinessScore;
      try {
        const target = bracket ? (bracket as TargetBracket) : undefined;
        let data = await fetchCommanderData(name, undefined, target);
        let broadFallback = false;
        if (target && isPoolTooThin(data)) {
          data = await fetchCommanderData(name);
          broadFallback = true;
        }
        const gameChangers = bracket ? await getGameChangerNames() : undefined;
        score = computeReadiness(data.cardlists.allNonLand, ownedCardNames, {
          bracket,
          gameChangers,
          heldBy,
          sampleDecks: data.stats.numDecks,
          broadFallback,
        });
      } catch {
        score = computeReadiness([], ownedCardNames);
      }
      doneSet.add(key);
      inflightSet.delete(key);
      put(forScope, key, score);
    },
    [canScore, ownedCardNames, heldBy, bracket, scope, put]
  );

  return { readiness: maps.get(scope) ?? EMPTY, ensureReadiness };
}

const BRACKET_KEY = 'commander-search-bracket';

export const BRACKET_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Any' },
  ...[1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} · ${bracketLabel(n)}` })),
];

/** The target bracket, remembered between visits; null is "Any". */
export function useBracketPref(): [number | null, (next: number | null) => void] {
  const [bracket, setBracketState] = useState<number | null>(() => {
    try {
      const saved = Number(localStorage.getItem(BRACKET_KEY));
      return saved >= 1 && saved <= 5 ? saved : null;
    } catch {
      return null;
    }
  });
  const setBracket = (next: number | null) => {
    setBracketState(next);
    try {
      localStorage.setItem(BRACKET_KEY, next === null ? '' : String(next));
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
  };
  return [bracket, setBracket];
}
