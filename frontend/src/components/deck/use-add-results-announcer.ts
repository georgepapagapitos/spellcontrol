import { useEffect, useRef } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  rowAnnouncement,
  rowStatuses,
  settledAnnouncement,
  useLiveAnnouncer,
  useSettleTimer,
} from '@/lib/search/row-announcement';

type AddAt = (index: number) => Promise<void> | void;

/** A result list hands the panel its visible cards and how to add one;
 *  `ready` false while it is still loading, so its count isn't spoken yet. */
export type PublishVisible = (cards: ScryfallCard[], addAt: AddAt, ready?: boolean) => void;

/**
 * The Add cards panel's screen-reader side (E1008): which list is on screen,
 * what its rows say, and when the panel speaks.
 *
 * The tab's result list publishes its visible cards here (`publishVisible`),
 * so the panel's arrow and Enter handlers work whichever tab is open. A new
 * result set (`resetKey` changes: a typed query, a tab or sort switch, and the
 * first load) is spoken once it settles: the count and the highlighted row in
 * one message (`settledAnnouncement`). Every publish while it waits restarts
 * the timer, so a typed word is spoken once; the user's own arrow, Home/End
 * or add takes over (`takeOver`) and drops it, so it never talks over the row
 * the user just moved to.
 */
export function useAddResultsAnnouncer(activeIndex: number, resetKey: string) {
  const { message, announce: speak } = useLiveAnnouncer();
  const { schedule, cancel } = useSettleTimer();
  const visibleResultsRef = useRef<ScryfallCard[]>([]);
  const addCurrentRef = useRef<AddAt | null>(null);
  // False while the active tab's list is still loading (Scryfall's debounce
  // and fetch, Suggestions' deck analysis): its count isn't the answer yet.
  const visibleReadyRef = useRef(false);
  const awaitingSettle = useRef(true);
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  });

  /** What the row at `index` says, read off the rendered row and its badges. */
  const describeRow = (index: number, total: number, edge?: 'first' | 'last'): string | null => {
    const row = document.getElementById(`card-search-result-${index}`);
    const rowName = row?.dataset.resultName;
    if (!row || !rowName) return null;
    return rowAnnouncement({
      name: rowName,
      statuses: rowStatuses(row),
      index,
      total,
      atCopyLimit: row.dataset.atLimit !== undefined,
      edge,
    });
  };

  const settle = () =>
    schedule(() => {
      // Still loading: the publish that ends the load schedules it again.
      if (!visibleReadyRef.current) return;
      awaitingSettle.current = false;
      const total = visibleResultsRef.current.length;
      speak(settledAnnouncement(total, describeRow(activeIndexRef.current, total)));
    });

  const publishVisible: PublishVisible = (cards, addAt, ready = true) => {
    visibleResultsRef.current = cards;
    addCurrentRef.current = addAt;
    visibleReadyRef.current = ready;
    if (awaitingSettle.current) settle();
  };

  /** The user's own move speaks for itself. A move on a list still loading
   *  leaves the wait on, so the set that lands is still spoken. */
  const takeOver = () => {
    cancel();
    if (visibleReadyRef.current) awaitingSettle.current = false;
  };

  /** A result row's own message ("Added Sol Ring"), which takes over too. */
  const announceFromRow = (msg: string) => {
    takeOver();
    speak(msg);
  };

  useEffect(() => {
    awaitingSettle.current = true;
    settle();
    // settle reads refs only; re-running on its identity would fire per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  return {
    message,
    speak,
    describeRow,
    publishVisible,
    takeOver,
    announceFromRow,
    visibleResultsRef,
    addCurrentRef,
  };
}
