import { useMemo } from 'react';
import { useCollectionStore } from '@/store/collection';
import { useAwaitingFirstPull } from '@/lib/sync/use-awaiting-first-pull';
import { useAllocations, computeSurplusByName } from '@/lib/collection/allocations';
import { formatMoney } from '@/lib/collection/format-money';
import type { PublicCard } from '@/lib/social/shared-types';
import { groupOwnedForTrade, type OwnedTradeLine } from './trade-picker';
import {
  MAX_COPIES_PER_LINE,
  askFloorValue,
  giveTradeCards,
  giveValue as sumGiveValue,
  keyOf,
  removeKey,
  resolveChosen,
  setPrintingCount as setPrintingCountIn,
  totalQuantity,
  wantTradeCards,
  type PickedCopies,
} from './trade-basket';
import { reconcileDraft, type DraftIssue, type TradeDraftV1 } from './trade-draft';
import { describeNet, describeNetShort, useFloorPrices, type SideValue } from './trade-value';
import { MAX_TRADE_LINES_PER_SIDE, type TradeCard } from './trades-client';
import { useTradeDraft } from './use-trade-draft';

/** Copies of each card the friend has, by `keyOf`. Null = not readable. */
export function countTheirCopies(cards: readonly PublicCard[] | null): Map<string, number> | null {
  if (!cards) return null;
  const counts = new Map<string, number>();
  for (const card of cards) {
    const key = keyOf({ oracleId: card.oracleId ?? '', name: card.name });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export interface ReviewGetLine {
  key: string;
  name: string;
  quantity: number;
  /** What they actually have, capped at 20; 0 when the card is gone. */
  max: number;
  /** Their real count, or null when their collection can't be read. */
  theirCount: number | null;
  gone: boolean;
  /** Cheapest printing that exists, or null when unknown. */
  floor: number | null;
}

export interface ReviewGiveLine {
  key: string;
  name: string;
  /** Undefined when the copy left the collection in another tab. */
  line: OwnedTradeLine | undefined;
  chosenIds: ReadonlySet<string>;
  /** Spare / in-deck / only-copy, already worded; empty when nothing to say. */
  note: string;
  /** True when `note` warns that a chosen copy is committed to a deck. */
  inDeck: boolean;
  wanted: boolean;
}

/**
 * Everything the trade review surfaces (tray, sheet, dock) read from one
 * saved draft: the draft reconciled against fresh data, its lines, its value
 * and net, and every edit as a function that writes the draft back.
 *
 * Edits are applied to the RECONCILED draft, so a quantity clamped on reopen
 * stays clamped once the owner touches anything. Reconciling is derived on
 * every render rather than written back: the reconcile notices stay visible
 * until the owner acts, and nothing can loop through the store.
 */
export function useTradeReview(opts: {
  friendId: string;
  friendName: string;
  /** Their cards copy by copy; null while loading or when private. */
  theirCards: readonly PublicCard[] | null;
  /** What the friend is looking for, to mark the give side. */
  friendWants?: ReadonlyArray<{ oracleId?: string | null; name: string }> | null;
}) {
  const { friendId, friendName, theirCards, friendWants = null } = opts;
  const { draft: stored, save, clear } = useTradeDraft(friendId);
  const cards = useCollectionStore((s) => s.cards);
  const allocations = useAllocations();
  const awaitingFirstPull = useAwaitingFirstPull();

  const ownedLines = useMemo(() => groupOwnedForTrade(cards), [cards]);
  const ownedByKey = useMemo(() => {
    const map = new Map<string, OwnedTradeLine>();
    for (const line of ownedLines) map.set(keyOf(line), line);
    return map;
  }, [ownedLines]);
  const surplusByName = useMemo(
    () => computeSurplusByName(cards, allocations),
    [cards, allocations]
  );

  // On a device that has never cached this account the store is empty until
  // the first pull lands. Reconciling the give side then would drop every
  // line as "no longer owned", so it is left alone until the cards arrive.
  const giveLoading = awaitingFirstPull && ownedLines.length === 0;

  const theirCounts = useMemo(() => countTheirCopies(theirCards), [theirCards]);

  const reconciled = useMemo(() => {
    if (!stored) return null;
    const result = reconcileDraft(stored, theirCounts, ownedLines);
    if (giveLoading)
      return { draft: { ...result.draft, give: stored.give }, issues: result.issues };
    return result;
  }, [stored, theirCounts, ownedLines, giveLoading]);

  const draft: TradeDraftV1 | null = reconciled?.draft ?? null;
  const issues: DraftIssue[] = useMemo(() => reconciled?.issues ?? [], [reconciled]);

  /** Give lines the draft had that this device no longer owns. */
  const droppedGive = useMemo(() => {
    if (!stored || !draft || giveLoading) return [];
    return Object.entries(stored.give)
      .filter(([key]) => !(key in draft.give))
      .map(([, line]) => line.name);
  }, [stored, draft, giveLoading]);

  const wantedNames = useMemo(() => {
    const oracle = new Set<string>();
    const names = new Set<string>();
    for (const w of friendWants ?? []) {
      if (w.oracleId) oracle.add(w.oracleId);
      names.add(w.name.toLowerCase());
    }
    return { oracle, names };
  }, [friendWants]);

  const goneKeys = useMemo(
    () => new Set(issues.filter((i) => i.kind === 'gone').map((i) => i.key)),
    [issues]
  );

  const getEntries = Object.entries(draft?.get ?? {});
  const { prices: floorPrices, pending: floorPending } = useFloorPrices(
    getEntries.map(([, l]) => l.name)
  );

  const getLines: ReviewGetLine[] = getEntries.map(([key, line]) => {
    const theirCount = theirCounts ? (theirCounts.get(key) ?? 0) : null;
    const gone = goneKeys.has(key);
    return {
      key,
      name: line.name,
      quantity: line.quantity,
      max: gone ? 0 : Math.min(MAX_COPIES_PER_LINE, theirCount ?? MAX_COPIES_PER_LINE),
      theirCount,
      gone,
      floor: floorPrices.get(line.name) ?? null,
    };
  });

  const giving: PickedCopies = Object.fromEntries(
    Object.entries(draft?.give ?? {}).map(([key, l]) => [key, l.copyIds])
  );
  const chosenByKey = resolveChosen(giving, ownedByKey);

  const giveLines: ReviewGiveLine[] = Object.entries(draft?.give ?? {}).map(([key, l]) => {
    const line = ownedByKey.get(key);
    const chosenIds = new Set(l.copyIds);
    const chosen = line?.copies.filter((c) => chosenIds.has(c.copyId)) ?? [];
    const decks = new Set<string>();
    let lastDeck = '';
    for (const copy of chosen) {
      const claim = allocations.get(copy.copyId);
      if (claim) {
        decks.add(claim.ownerId);
        lastDeck = claim.ownerName;
      }
    }
    let note = '';
    if (decks.size === 1) note = `In ${lastDeck}`;
    else if (decks.size > 1) note = `In ${decks.size} decks`;
    else if ((surplusByName.get(l.name) ?? 0) > 0) note = `${surplusByName.get(l.name)} spare`;
    else if (line && line.copies.length === 1) note = 'Only copy';
    const wanted =
      (!!line?.oracleId && wantedNames.oracle.has(line.oracleId)) ||
      wantedNames.names.has(l.name.toLowerCase());
    return { key, name: l.name, line, chosenIds, note, inDeck: decks.size > 0, wanted };
  });

  const giveCards: TradeCard[] = giveTradeCards(chosenByKey, ownedByKey);
  const wantCards: TradeCard[] = wantTradeCards(
    Object.fromEntries(Object.entries(draft?.get ?? {}).map(([k, l]) => [k, l.quantity])),
    (key) => (draft?.get[key] ? { oracleId: key, name: draft.get[key].name } : undefined)
  );

  const getCount = totalQuantity(wantCards);
  const giveCount = totalQuantity(giveCards);
  // A give line whose cards are still on their way counts for the tray too.
  const giveLineCount = giveLoading ? giveLines.length : giveCards.length;

  const giveTotal = sumGiveValue(chosenByKey);
  const { value: wantFloor, unpriced: wantUnpriced } = askFloorValue(wantCards, floorPrices);

  const giveSide: SideValue = {
    text: giveCards.length === 0 ? '' : formatMoney(giveTotal),
    amount: giveLoading && giveLines.length > 0 ? null : giveTotal,
    estimate: false,
  };
  const getSide: SideValue =
    wantCards.length === 0
      ? { text: '', amount: 0, estimate: false }
      : floorPending
        ? { text: '…', amount: null, estimate: true }
        : {
            text: `from ${formatMoney(wantFloor)}${wantUnpriced > 0 ? ' +?' : ''}`,
            amount: wantUnpriced > 0 ? null : wantFloor,
            estimate: true,
          };

  // A net needs something on both sides; one-sided asks and gifts have no
  // subtraction to state.
  const bothSides = wantCards.length > 0 && giveCards.length > 0;
  const net = bothSides ? describeNet(giveSide, getSide) : null;
  const netShort = bothSides ? describeNetShort(giveSide, getSide) : null;

  const hasGone = goneKeys.size > 0;
  const lineCapReached =
    getLines.length >= MAX_TRADE_LINES_PER_SIDE || giveLines.length >= MAX_TRADE_LINES_PER_SIDE;

  /** Why Send is off, in words; null when it is on. */
  const blockedReason: string | null = !draft
    ? 'Add a card to send.'
    : hasGone
      ? `Remove the cards ${friendName} no longer has to send.`
      : giveLoading
        ? 'Getting your cards before this can be sent.'
        : wantCards.length + giveCards.length === 0
          ? 'Add a card to send.'
          : null;

  function commit(next: TradeDraftV1) {
    save(next);
  }

  function setGetQuantity(key: string, quantity: number) {
    if (!draft || !draft.get[key]) return;
    const line = getLines.find((l) => l.key === key);
    const max = line ? Math.max(1, line.max) : MAX_COPIES_PER_LINE;
    const q = Math.max(1, Math.min(quantity, max));
    commit({ ...draft, get: { ...draft.get, [key]: { ...draft.get[key], quantity: q } } });
  }

  function removeGet(key: string) {
    if (!draft) return;
    commit({ ...draft, get: removeKey(draft.get, key) });
  }

  function removeGive(key: string) {
    if (!draft) return;
    commit({ ...draft, give: removeKey(draft.give, key) });
  }

  function setPrinting(key: string, printingKey: string, count: number) {
    if (!draft || !draft.give[key]) return;
    const line = ownedByKey.get(key);
    if (!line) return;
    const next = setPrintingCountIn(giving, line, printingKey, count);
    const copyIds = next[key];
    commit({
      ...draft,
      give: copyIds
        ? { ...draft.give, [key]: { ...draft.give[key], copyIds } }
        : removeKey(draft.give, key),
    });
  }

  function setNote(note: string) {
    if (!draft) return;
    commit({ ...draft, note });
  }

  return {
    draft,
    issues,
    droppedGive,
    getLines,
    giveLines,
    giveCards,
    wantCards,
    ownedByKey,
    giveLoading,
    getCount,
    giveCount,
    getLineCount: getLines.length,
    giveLineCount,
    getSide,
    giveSide,
    net,
    netShort,
    hasGone,
    lineCapReached,
    blockedReason,
    clear,
    setGetQuantity,
    removeGet,
    removeGive,
    setPrinting,
    setNote,
    friendName,
  };
}

export type TradeReviewModel = ReturnType<typeof useTradeReview>;
