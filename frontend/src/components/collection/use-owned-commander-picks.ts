import { useEffect, useMemo, useState } from 'react';
import { fetchCommanderData } from '@/deck-builder/services/edhrec/client';
import { rankOwnedCommanders, type OwnedCommanderPicks } from '@/lib/deck/owned-commander-picks';
import { useCollectionStore } from '@/store/collection';
import type { EnrichedCard } from '@/types/index';

export type PicksState = { status: 'loading' } | OwnedCommanderPicks;

/** Scores the player's owned commanders for the post-import moment. `retry` re-runs after an error. */
export function useOwnedCommanderPicks(cards: EnrichedCard[]): {
  state: PicksState;
  retry: () => void;
} {
  const importHistory = useCollectionStore((s) => s.importHistory);
  const recency = useMemo(
    () => new Map(importHistory.map((h) => [h.id, h.addedAt])),
    [importHistory]
  );
  const [attempt, setAttempt] = useState(0);
  // The result is stored under the inputs it answered, so a changed collection
  // or a retry reads as loading until its own result lands.
  const [done, setDone] = useState<{
    cards: EnrichedCard[];
    attempt: number;
    r: OwnedCommanderPicks;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void rankOwnedCommanders(
      cards,
      async (name) => (await fetchCommanderData(name)).cardlists.allNonLand,
      recency,
      () => cancelled
    ).then((result) => {
      if (!cancelled) setDone({ cards, attempt, r: result });
    });
    return () => {
      cancelled = true;
    };
  }, [cards, recency, attempt]);

  const state: PicksState =
    done && done.cards === cards && done.attempt === attempt ? done.r : { status: 'loading' };
  return { state, retry: () => setAttempt((n) => n + 1) };
}
