import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Deck } from '@/store/decks';
import { useTaggerReady } from '@/lib/cards/use-tagger-ready';
import { getAllCardRoles } from '@/deck-builder/services/tagger/client';
import { toClockLibrary } from '@/lib/mana-sim/hand-classify';
import { speedPathOf } from '@/lib/mana-sim/speed-path';
import { useAssemblyClock } from '@/lib/mana-sim/use-assembly-clock';
import {
  buildSnapshot,
  diffSnapshots,
  hasChanges,
  nextPool,
  reconstructDeck,
  sameCards,
  toStored,
  type DeckSince,
  type DeckSnapshot,
} from '@/lib/deck/deck-since';
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
  const prevDeck = useRef<Deck | null>(null);
  const [view, setView] = useState<{ id: string; rec: BaselineRecord } | null>(null);

  useEffect(() => {
    if (!deck || !current) return;
    const stored = toStored(current);
    const same = held.current?.id === deck.id;
    const open = same ? held.current!.rec : startSession(loadRecord(deck.id), stored, Date.now());
    const pool = nextPool(open.pool, same ? prevDeck.current : null, deck, open.baseline);
    const next = observe(open, stored, pool);
    held.current = { id: deck.id, rec: next };
    prevDeck.current = deck;
    saveRecord(deck.id, next);
    setView(held.current);
  }, [deck, current]);

  // The baseline's own numbers, recomputed with today's classifiers from the
  // card list it stored, so a delta can only come from a card that moved. The
  // stored ledger numbers (bracket, signals, clock) ride along unchanged.
  const baselineDeck = useMemo(() => {
    if (!deck || !current || !view || view.id !== deck.id) return null;
    if (sameCards(view.rec.baseline, current)) return null;
    return reconstructDeck(deck, view.rec.baseline, view.rec.pool);
  }, [deck, current, view]);
  const baseCommanders = useMemo(
    () => [baselineDeck?.commander, baselineDeck?.partnerCommander].filter((c) => c != null),
    [baselineDeck]
  );
  const baseLibrary = useMemo(
    () => (baselineDeck ? baselineDeck.cards.map((c) => c.card) : []),
    [baselineDeck]
  );
  const baseCastable = useCastability(baseCommanders, baseLibrary)?.average ?? null;

  const dismiss = useCallback(() => {
    if (!deckId || held.current?.id !== deckId) return;
    const next = markSeen(held.current.rec);
    held.current = { id: deckId, rec: next };
    saveRecord(deckId, next);
    setView(held.current);
  }, [deckId]);

  const since = useMemo(() => {
    if (!view || !current || view.id !== deck?.id) return null;
    const stored = view.rec.baseline;
    const base: DeckSnapshot = baselineDeck
      ? {
          ...stored,
          metrics: {
            ...buildSnapshot(baselineDeck, taggerReady, { castable: baseCastable }).metrics,
            ...stored.metrics,
          },
        }
      : stored;
    const d = diffSnapshots(base, current, getAllCardRoles);
    return hasChanges(d) ? d : null;
    // taggerReady: the role chips beside each card come from the tagger.
  }, [view, current, deck?.id, baselineDeck, baseCastable, taggerReady]);

  return useMemo(
    () => (view && since ? { since, baselineAt: view.rec.baseline.at, dismiss } : null),
    [view, since, dismiss]
  );
}
