import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Deck } from '@/store/decks';
import { useTaggerReady } from '@/lib/cards/use-tagger-ready';
import { getAllCardRoles } from '@/deck-builder/services/tagger/client';
import { toClockLibrary } from '@/lib/mana-sim/hand-classify';
import { speedPathOf } from '@/lib/mana-sim/speed-path';
import { useAssemblyClock } from '@/lib/mana-sim/use-assembly-clock';
import { buildSnapshot, diffSnapshots, hasChanges, type DeckSince } from '@/lib/deck/deck-since';
import {
  loadRecord,
  markSeen,
  observe,
  saveRecord,
  startSession,
  type BaselineRecord,
} from '@/lib/deck/deck-since-store';
import { useCastability } from './use-castability';

export interface DeckSinceState {
  /** What changed since the baseline. */
  since: DeckSince;
  /** When the baseline was taken, for the "Since …" label. */
  baselineAt: number;
  /** Take the deck as it stands as the new baseline. */
  dismiss: () => void;
}

/**
 * The deck's "Since" read: current snapshot against the per-device baseline.
 * The cards, role counts and bracket are known at once; castability and the
 * assembly clock land after paint, and a row for either appears only once both
 * sides have it. Nothing here blocks the page or writes to the deck.
 */
export function useDeckSince(deck: Deck | null): DeckSinceState | null {
  const taggerReady = useTaggerReady();
  const deckId = deck?.id ?? null;

  const commanders = useMemo(
    () => [deck?.commander, deck?.partnerCommander].filter((c) => c != null),
    [deck?.commander, deck?.partnerCommander]
  );
  const library = useMemo(() => (deck ? deck.cards.map((c) => c.card) : []), [deck]);
  const castability = useCastability(commanders, library);
  const clockLibrary = useMemo(
    () => (library.length > 0 ? toClockLibrary(library) : null),
    // taggerReady: ramp classification decides how fast the sim's mana grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [library, taggerReady]
  );
  const path = useMemo(() => speedPathOf(deck?.winConditions), [deck?.winConditions]);
  const { clock } = useAssemblyClock(clockLibrary, path?.assembly ?? null, {
    iterations: 1000,
    wildcards: deck?.winConditions?.tutors,
  });

  const castable = castability?.average ?? null;
  const clockTurn = clock?.typicalTurn ?? null;
  const current = useMemo(
    () => (deck ? buildSnapshot(deck, taggerReady, { castable, clockTurn }) : null),
    [deck, taggerReady, castable, clockTurn]
  );

  const held = useRef<{ id: string; rec: BaselineRecord } | null>(null);
  const [view, setView] = useState<{ id: string; rec: BaselineRecord } | null>(null);

  useEffect(() => {
    if (!deckId || !current) return;
    const open =
      held.current?.id === deckId
        ? held.current.rec
        : startSession(loadRecord(deckId), current, Date.now());
    const next = observe(open, current);
    held.current = { id: deckId, rec: next };
    saveRecord(deckId, next);
    setView(held.current);
  }, [deckId, current]);

  const dismiss = useCallback(() => {
    if (!deckId || held.current?.id !== deckId) return;
    const next = markSeen(held.current.rec);
    held.current = { id: deckId, rec: next };
    saveRecord(deckId, next);
    setView(held.current);
  }, [deckId]);

  const since = useMemo(() => {
    if (!view || view.id !== deckId) return null;
    const d = diffSnapshots(view.rec.baseline, view.rec.latest, getAllCardRoles);
    return hasChanges(d) ? d : null;
    // taggerReady: the role chips beside each card come from the tagger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, deckId, taggerReady]);

  return useMemo(
    () => (view && since ? { since, baselineAt: view.rec.baseline.at, dismiss } : null),
    [view, since, dismiss]
  );
}
