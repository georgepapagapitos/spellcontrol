import { useMemo } from 'react';
import { useCollectionStore } from '@/store/collection';
import { useAwaitingFirstPull } from '@/lib/sync/use-awaiting-first-pull';
import { useAllocations, computeSurplusByName } from '@/lib/collection/allocations';
import { formatMoney } from '@/lib/collection/format-money';
import type { PublicCard } from '@/lib/social/shared-types';
import { groupOwnedForTrade, type OwnedTradeLine } from './trade-picker';
import {
  MAX_COPIES_PER_LINE,
  askTradeCards,
  askedOf,
  getEntryKey,
  giveTradeCards,
  giveValue as sumGiveValue,
  keyOf,
  removeKey,
  resolveChosen,
  setPrintingCount as setPrintingCountIn,
  totalQuantity,
  isPinned,
  type PickedCopies,
} from './trade-basket';
import { reconcileDraft, type DraftIssue, type TradeDraft } from './trade-draft';
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

/** One entry per printing they hold, keyed like a pinned ask (`getEntryKey`). */
function printingKeyOfTheirs(card: PublicCard): string {
  return getEntryKey({
    oracleId: card.oracleId ?? '',
    name: card.name,
    scryfallId: card.scryfallId,
    finish: card.finish,
  });
}

/** Copies they hold of each PRINTING. Null = not readable. */
export function countTheirPrintings(
  cards: readonly PublicCard[] | null
): Map<string, number> | null {
  if (!cards) return null;
  const counts = new Map<string, number>();
  for (const card of cards) {
    const key = printingKeyOfTheirs(card);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** One of their copies per printing, for the art, set and price an ask names. */
export function theirPrintings(cards: readonly PublicCard[] | null): Map<string, PublicCard> {
  const byKey = new Map<string, PublicCard>();
  for (const card of cards ?? []) {
    const key = printingKeyOfTheirs(card);
    if (!byKey.has(key)) byKey.set(key, card);
  }
  return byKey;
}

/**
 * The cheapest priced printing of each card among THEIR copies, by `keyOf`.
 * Their payload carries market `purchasePrice` per printing, so an ask can be
 * priced from the very cards it names; a card with no priced copy is absent.
 */
export function theirFloorPrices(cards: readonly PublicCard[] | null): Map<string, number> {
  const floors = new Map<string, number>();
  for (const card of cards ?? []) {
    if (!(card.purchasePrice > 0)) continue;
    const key = keyOf({ oracleId: card.oracleId ?? '', name: card.name });
    const have = floors.get(key);
    if (have === undefined || card.purchasePrice < have) floors.set(key, card.purchasePrice);
  }
  return floors;
}

export interface ReviewGetLine {
  key: string;
  oracleId: string;
  name: string;
  /** The line as the card preview wants it: this entry's own printing, if it names one. */
  card: TradeCard;
  quantity: number;
  /** What they actually have, capped at 20; 0 when the card is gone. */
  max: number;
  /** Their real count, or null when their collection can't be read. */
  theirCount: number | null;
  gone: boolean;
  /** Cheapest printing that exists, or null when unknown. Any-printing asks only. */
  floor: number | null;
  /** The printing this ask names, or null when any printing will do. */
  printing: {
    setCode: string;
    collectorNumber: string;
    finish: string;
    imageSmall?: string;
    /** Their price for this printing, per copy; null when it has none. */
    price: number | null;
  } | null;
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
  const claimed = useMemo(() => new Set(allocations.keys()), [allocations]);
  const surplusByName = useMemo(
    () => computeSurplusByName(cards, allocations),
    [cards, allocations]
  );

  // On a device that has never cached this account the store is empty until
  // the first pull lands. Reconciling the give side then would drop every
  // line as "no longer owned", so it is left alone until the cards arrive.
  const giveLoading = awaitingFirstPull && ownedLines.length === 0;

  const theirCounts = useMemo(() => countTheirCopies(theirCards), [theirCards]);
  const theirPrintingCounts = useMemo(() => countTheirPrintings(theirCards), [theirCards]);
  const theirPrintingRows = useMemo(() => theirPrintings(theirCards), [theirCards]);

  const reconciled = useMemo(() => {
    if (!stored) return null;
    const result = reconcileDraft(stored, theirCounts, ownedLines, theirPrintingCounts);
    if (giveLoading)
      return { draft: { ...result.draft, give: stored.give }, issues: result.issues };
    return result;
  }, [stored, theirCounts, theirPrintingCounts, ownedLines, giveLoading]);

  const draft: TradeDraft | null = reconciled?.draft ?? null;
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
  // Their own copies price an any-printing ask first; the Scryfall floor lookup
  // is only for a card none of their copies has a price for. A pinned ask is
  // priced from the printing itself and never needs a floor.
  const ownFloors = useMemo(() => theirFloorPrices(theirCards), [theirCards]);
  const unpriced = getEntries.filter(([, l]) => !isPinned(l) && !ownFloors.has(keyOf(l)));
  const { prices: lookedUp, pending: lookupPending } = useFloorPrices(
    unpriced.map(([, l]) => l.name)
  );
  const floorPending = unpriced.length > 0 && lookupPending;
  const floorPrices = new Map(lookedUp);
  for (const [, line] of getEntries) {
    const own = ownFloors.get(keyOf(line));
    if (own !== undefined) floorPrices.set(line.name, own);
  }

  const getLines: ReviewGetLine[] = getEntries.map(([key, line]) => {
    const pinned = isPinned(line);
    const theirCount = pinned
      ? theirPrintingCounts
        ? (theirPrintingCounts.get(key) ?? 0)
        : null
      : theirCounts
        ? (theirCounts.get(keyOf(line)) ?? 0)
        : null;
    const gone = goneKeys.has(key);
    // The 20 is per card, and the card's other entries use some of it.
    const room = MAX_COPIES_PER_LINE - (askedOf(draft?.get ?? {}, line) - line.quantity);
    const row = pinned ? theirPrintingRows.get(key) : undefined;
    return {
      key,
      oracleId: line.oracleId,
      name: line.name,
      card: {
        oracleId: line.oracleId,
        name: line.name,
        quantity: line.quantity,
        copies: isPinned(line)
          ? Array.from({ length: line.quantity }, () => ({
              scryfallId: line.scryfallId,
              finish: line.finish,
            }))
          : [],
      },
      quantity: line.quantity,
      max: gone ? 0 : Math.min(room, theirCount ?? MAX_COPIES_PER_LINE),
      theirCount,
      gone,
      floor: pinned ? null : (floorPrices.get(line.name) ?? null),
      printing: pinned
        ? {
            setCode: row?.setCode ?? '',
            collectorNumber: row?.collectorNumber ?? '',
            finish: line.finish,
            imageSmall: row?.imageSmall ?? row?.imageNormal,
            price: row && row.purchasePrice > 0 ? row.purchasePrice : null,
          }
        : null,
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
  const wantCards: TradeCard[] = askTradeCards(draft?.get ?? {});

  const getCount = totalQuantity(wantCards);
  const giveCount = totalQuantity(giveCards);
  // A give line whose cards are still on their way counts for the tray too.
  const giveLineCount = giveLoading ? giveLines.length : giveCards.length;

  const giveTotal = sumGiveValue(chosenByKey);
  // A pinned ask is worth exactly its printing's price; an any-printing ask is
  // only a floor ("from"). A line with no price at all is counted, never zero.
  let wantExact = 0;
  let wantFloor = 0;
  let wantUnpriced = 0;
  let anyFloor = false;
  for (const line of getLines) {
    if (line.gone) continue;
    if (line.printing) {
      if (line.printing.price === null) wantUnpriced += 1;
      else wantExact += line.printing.price * line.quantity;
    } else if (line.floor === null) {
      wantUnpriced += 1;
    } else {
      anyFloor = true;
      wantFloor += line.floor * line.quantity;
    }
  }
  const wantTotal = wantExact + wantFloor;

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
            text:
              anyFloor || wantUnpriced > 0
                ? `from ${formatMoney(wantTotal)}${wantUnpriced > 0 ? ' +?' : ''}`
                : formatMoney(wantTotal),
            amount: wantUnpriced > 0 ? null : wantTotal,
            estimate: anyFloor || wantUnpriced > 0,
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

  function commit(next: TradeDraft) {
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
    const next = setPrintingCountIn(giving, line, printingKey, count, claimed);
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
