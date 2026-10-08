import './TradeComposer.css';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Minus, Plus, X } from 'lucide-react';
import { Modal } from '@/components/overlays/Modal';
import { Chip } from '../shared/Chip';
import { SearchPill } from '@/components/search/SearchPill';
import { buildFriendSearch } from '@/lib/social/friend-search';
import { getCardTags, useCardTagsReady } from '@/lib/cards/card-tags';
import { useCollectionStore } from '../../store/collection';
import { useCardThumb } from '@/lib/cards/card-thumbs';
import { toast } from '../../store/toasts';
import { formatMoney } from '@/lib/collection/format-money';
import { PrintingChoices, describePrinting } from './PrintingChoices';
import { useBinderByCopyId, type BinderRef } from '@/lib/binder/use-binder-by-copy';
import { useAllocations, computeSurplusByName } from '@/lib/collection/allocations';
import {
  groupOwnedForTrade,
  filterOwnedLines,
  filterToSurplus,
  copiesByValue,
  groupByPrinting,
  toRequestedCard,
  sumCopyValue,
  type OwnedTradeLine,
  type PrintingGroup,
} from '@/lib/trade/trade-picker';
import { useFloorPrices } from '@/lib/trade/trade-value';
import { resolveTradePreview } from '@/lib/trade/trade-preview';
import {
  MAX_COPIES_PER_LINE,
  addCheapestCopy,
  askFloorValue,
  atLineCap,
  bump,
  giveTradeCards,
  giveValue as sumGiveValue,
  keyOf,
  rankGiveLines,
  removeKey,
  resolveChosen,
  resolveGivePrefill,
  setPrintingCount as setPrintingCountIn,
  totalQuantity,
  wantTradeCards,
  wantedKeysOf,
  type Picked,
  type PickedCopies,
} from '@/lib/trade/trade-basket';
import { useSendTrade } from '@/lib/trade/use-send-trade';
import { TradePreviewCarousel, type TradePreviewState } from './TradePreviewCarousel';
import {
  MAX_TRADE_LINES_PER_SIDE,
  type TradeOffer,
  type TradeCard,
} from '@/lib/trade/trades-client';
import type { FriendCard } from '../../lib/cube/pool';
import type { FriendWant } from '@/lib/social/friends-client';

import { useAwaitingFirstPull } from '@/lib/sync/use-awaiting-first-pull';
import { Button, IconButton } from '@/components/shared/Button';
/** How many picker results render before the list asks you to narrow down.
 *  A real collection is ~11.5k unique cards; the search filters the full set
 *  regardless of this cap (same contract as the friend Collection browser). */
const PICKER_LIMIT = 40;

interface Props {
  friendId: string;
  /** How to refer to the friend in copy — display name or @handle. */
  friendName: string;
  /** The friend's collection, oracle-level (never carries price or quantity). */
  friendCards: FriendCard[] | null;
  /** True while friendCards is still loading. */
  friendCardsLoading: boolean;
  /** Set when the friend's collection could not be loaded, so the "you get"
   *  side can say so instead of pretending they own nothing. */
  friendCardsError?: boolean;
  onRetryFriendCards?: () => void;
  /**
   * What the friend is looking for, oracle-level. Marks the give side so
   * "would they even want this?" stops being a guess made one card at a time.
   * `null` while loading or on failure — the give side simply goes unmarked,
   * which is what it did before this existed.
   */
  friendWants: FriendWant[] | null;
  /** Prefills the "You give" side. Resolved to the viewer's owned copies,
   *  cheapest first; a card they no longer own is skipped and named in the
   *  composer's note line. */
  initialGive?: TradeCard[];
  /** Prefills the "You get" side with these cards and quantities. */
  initialGet?: Array<{ oracleId: string; name: string; quantity: number }>;
  /**
   * Set when this composer is a counter to an incoming offer. A successful
   * send declines that offer AFTER the new one is out, so a failed send never
   * leaves the friend with nothing on the table.
   */
  counterTo?: { offerId: string; name: string };
  onClose: () => void;
  onSent: (offer: TradeOffer) => void;
}

/**
 * The trade composer: two baskets, one deal.
 *
 * "You give" is picked from the viewer's own collection, so every line carries
 * the real printing being handed over. "You get" is picked from the friend's
 * collection, which is oracle-level by design — their device stamps the
 * printings when they accept. That asymmetry is deliberate and is what makes a
 * settled trade land in both binders at the right printing.
 */
export function TradeComposer({
  friendId,
  friendName,
  friendCards,
  friendCardsLoading,
  friendCardsError = false,
  onRetryFriendCards,
  friendWants,
  initialGive,
  initialGet,
  counterTo,
  onClose,
  onSent,
}: Props) {
  const cards = useCollectionStore((s) => s.cards);
  const titleId = useId();
  const noteId = useId();
  // Once for the whole composer — every expanded printing row asks the same
  // question of the same collection.
  const binderByCopyId = useBinderByCopyId();
  const allocations = useAllocations();

  const ownedLines = useMemo(() => groupOwnedForTrade(cards), [cards]);
  const ownedByKey = useMemo(() => {
    const map = new Map<string, OwnedTradeLine>();
    for (const line of ownedLines) map.set(keyOf(line), line);
    return map;
  }, [ownedLines]);

  const friendByKey = useMemo(() => {
    const map = new Map<string, FriendCard>();
    for (const card of friendCards ?? []) map.set(keyOf(card), card);
    return map;
  }, [friendCards]);

  // The give side is the prefill until the owner edits it. Derived rather than
  // seeded into state so a counter opened before the collection hydrates fills
  // in once it does.
  const { prefill: givePrefill, skipped: giveSkipped } = useMemo(
    () => resolveGivePrefill(initialGive, ownedByKey),
    [initialGive, ownedByKey]
  );
  const [givingEdit, setGivingEdit] = useState<PickedCopies | null>(null);
  const giving = givingEdit ?? givePrefill;
  function setGiving(fn: (prev: PickedCopies) => PickedCopies) {
    setGivingEdit((prev) => fn(prev ?? givePrefill));
  }
  // On a device that has never cached this account the store is empty until
  // the first pull lands; "empty collection" there is a lie about the account.
  const awaitingFirstPull = useAwaitingFirstPull();
  const [wanting, setWanting] = useState<Picked>(() =>
    Object.fromEntries((initialGet ?? []).map((c) => [keyOf(c), Math.max(1, c.quantity)]))
  );
  const [giveQuery, setGiveQuery] = useState('');
  const [spareOnly, setSpareOnly] = useState(false);
  const [wantedOnly, setWantedOnly] = useState(false);
  const [wantQuery, setWantQuery] = useState('');
  const [note, setNote] = useState('');
  const { sending, send: sendTrade } = useSendTrade({ friendId, friendName, counterTo, onSent });

  // The prefilled want may not be in the fetched friend collection yet (or at
  // all, if the radar and the browser disagree) — keep a fallback so the chip
  // still renders with a name instead of vanishing.
  const wantFallback = useMemo(() => {
    const map = new Map<string, { oracleId: string; name: string }>();
    for (const card of initialGet ?? []) map.set(keyOf(card), card);
    return map;
  }, [initialGet]);

  // Copies bound to no deck and no cube, beyond the one kept copy, basics
  // excluded — the collection's own "Tradeable surplus" definition, which had
  // never reached the one screen where "what can I safely offer?" is the
  // whole question. Complements the per-printing deck/binder badges: those
  // warn that a copy is committed, this narrows the list to ones that aren't.
  const surplusByName = useMemo(
    () => computeSurplusByName(cards, allocations),
    [cards, allocations]
  );

  /**
   * The viewer's OWN lines that this friend is looking for, as `keyOf` keys.
   *
   * Resolved to the give side's keyspace once, rather than carrying two lookup
   * sets around: a want and an owned copy can each independently lack an
   * oracleId, so the match falls back to a case-insensitive name — but only
   * the owned line's key ever needs to come back out.
   */
  const wantedKeys = useMemo(
    () => wantedKeysOf(friendWants, ownedLines),
    [friendWants, ownedLines]
  );

  const giveWantsTags = /\b(otag|oracletag|function)[:=]/i.test(giveQuery);
  const giveTagsReady = useCardTagsReady(giveWantsTags);
  const giveResults = useMemo(() => {
    let pool = spareOnly ? filterToSurplus(ownedLines, surplusByName) : ownedLines;
    if (wantedOnly) pool = pool.filter((line) => wantedKeys.has(keyOf(line)));
    if (giveQuery.trim() === '') {
      // Unsearched, the list opened at "A Killer Among Us" and ran
      // alphabetically through 11.5k cards, with the useful answers behind
      // two toggles. Lead with what this friend wants, then spare copies;
      // the rest keeps collection order. A typed search keeps its own
      // ranking (name hits first).
      pool = rankGiveLines(pool, wantedKeys, surplusByName);
    }
    return filterOwnedLines(pool, giveQuery, giveTagsReady ? getCardTags : undefined).slice(
      0,
      PICKER_LIMIT
    );
  }, [ownedLines, giveQuery, giveTagsReady, spareOnly, surplusByName, wantedOnly, wantedKeys]);

  // E237: the want side used to be a bare name substring while the friend
  // BROWSER beside it already had colour chips — the composer was the weaker
  // of the two. Both now run the same Scryfall-syntax search.
  const wantWantsTags = /\b(otag|oracletag|function)[:=]/i.test(wantQuery);
  const wantTagsReady = useCardTagsReady(wantWantsTags);
  const wantSearch = useMemo(
    () => buildFriendSearch(wantQuery, wantTagsReady ? getCardTags : undefined),
    [wantQuery, wantTagsReady]
  );
  const wantResults = useMemo(() => {
    const all = friendCards ?? [];
    return all
      .filter((c) => wantSearch.match(c))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, PICKER_LIMIT);
  }, [friendCards, wantSearch]);

  // ── Card preview ────────────────────────────────────────────────────
  // The carousel is the app's single card-inspect surface, and the composer
  // was a place you picked cards you could not actually look at. Which SET it
  // walks depends on which list you tapped, so swiping always continues the
  // list you were reading:
  //   · a RESULT row  → that side's results (you are comparing candidates)
  //   · a PICKED row  → the whole deal, give then get (#1560's ruling: a trade
  //                     is one decision about a set of cards)
  const [preview, setPreview] = useState<TradePreviewState | null>(null);
  // Slide → the row that produced it, for the preview's own Add button. Built
  // from `indexOf`, never by position: `resolveTradePreview` DROPS a card it
  // can't resolve, so a positional map would aim every later action at its
  // neighbour.
  const [previewActions, setPreviewActions] = useState<(() => void)[] | null>(null);

  function closePreview() {
    setPreview(null);
    setPreviewActions(null);
  }

  /** The give side is the one place no lookup is needed: these are the
   *  viewer's OWN copies, already enriched, so the carousel opens instantly
   *  and shows the exact printing that would leave the binder. */
  function inspectGiveResult(tapped: OwnedTradeLine) {
    const slides = giveResults.map((line) => copiesByValue(line)[0]).filter(Boolean);
    if (slides.length === 0) return;
    const at = giveResults.findIndex((line) => keyOf(line) === keyOf(tapped));
    setPreview({ cards: slides, index: Math.max(0, at) });
    setPreviewActions(giveResults.map((line) => () => addGive(line)));
  }

  async function inspectWantResult(tapped: FriendCard) {
    const rows = wantResults.map((card) => toRequestedCard(card, 1));
    const { cards: slides, indexOf } = await resolveTradePreview(rows);
    if (slides.length === 0) {
      toast.show({ message: "Couldn't load these cards right now.", tone: 'warn' });
      return;
    }
    const actions: (() => void)[] = [];
    rows.forEach((row, i) => {
      const at = indexOf(row);
      if (at >= 0) actions[at] = () => addWant(keyOf(wantResults[i]));
    });
    const at = indexOf(toRequestedCard(tapped, 1));
    setPreview({ cards: slides, index: at >= 0 ? at : 0 });
    setPreviewActions(actions);
  }

  /** A picked row opens the DEAL. No action button here on purpose: the
   *  carousel spans both baskets, so a control that removed the slide you were
   *  looking at would be editing one card while you read a set. */
  async function inspectPicked(tapped: TradeCard) {
    const all = [...giveCards, ...wantCards];
    const { cards: slides, indexOf } = await resolveTradePreview(all);
    if (slides.length === 0) {
      toast.show({ message: "Couldn't load these cards right now.", tone: 'warn' });
      return;
    }
    const at = indexOf(tapped);
    setPreview({ cards: slides, index: at >= 0 ? at : 0 });
    setPreviewActions(null);
  }

  /** The server rejects a 41st line with a generic "could not read" error —
   *  say what actually happened, and what to do about it, before sending. */
  function warnLineCap() {
    toast.show({
      message: `One side holds up to ${MAX_TRADE_LINES_PER_SIDE} different cards.`,
      tone: 'warn',
    });
  }

  /** Picking a card from the results adds its CHEAPEST unchosen copy — the
   *  same safe default `copiesByValue` documents. One tap still works for the
   *  single-printing case, which is most of a collection. */
  function addGive(line: OwnedTradeLine) {
    if (atLineCap(giving, keyOf(line))) {
      warnLineCap();
      return;
    }
    setGiving((prev) => addCheapestCopy(prev, line));
  }

  /** The ask-side mirror of {@link addGive}: one more of `key`, unless it
   *  would be a 41st distinct line. Bumps of an already-picked card pass. */
  function addWant(key: string) {
    if (atLineCap(wanting, key)) {
      warnLineCap();
      return;
    }
    setWanting((prev) => bump(prev, key, 1, MAX_COPIES_PER_LINE));
  }

  /** Set how many copies OF ONE PRINTING are in the trade (see the basket's
   *  `setPrintingCount`); a line that is no longer owned has nothing to set. */
  function setPrintingCount(key: string, printingKey: string, count: number) {
    const line = ownedByKey.get(key);
    if (!line) return;
    setGiving((prev) => setPrintingCountIn(prev, line, printingKey, count));
  }

  function removeGive(key: string) {
    setGiving((prev) => removeKey(prev, key));
  }

  /** The chosen copies per picked line, resolved against what is owned NOW. */
  const chosenByKey = useMemo(() => resolveChosen(giving, ownedByKey), [giving, ownedByKey]);

  const giveCards = giveTradeCards(chosenByKey, ownedByKey);
  const wantCards = wantTradeCards(wanting, (key) => friendByKey.get(key) ?? wantFallback.get(key));

  const totalGive = totalQuantity(giveCards);
  const totalWant = totalQuantity(wantCards);
  const canSend = !sending && giveCards.length + wantCards.length > 0;

  // The "add a card" hint is for someone who has started and emptied the
  // basket, not a greeting: on open the empty Send button already says it.
  // Latched during render (the documented derive-from-props pattern).
  const [startedBasket, setStartedBasket] = useState(false);
  if (!startedBasket && giveCards.length + wantCards.length > 0) setStartedBasket(true);

  // Give side is exact — real copies, real printings, already priced.
  const giveValue = sumGiveValue(chosenByKey);

  // Ask side is a FLOOR, not a price: their collection is oracle-level, so the
  // best honest answer is the cheapest printing that exists. Any card we can't
  // price at all is counted separately rather than folded in as zero — a
  // silent 0 would understate the ask and make a bad trade look even.
  // No useMemo on the names: `wantCards` is rebuilt every render, so memoizing
  // on it preserves nothing (and the React Compiler rejects it). useFloorPrices
  // keys on the joined names, not array identity, so a fresh array is free.
  const { prices: floorPrices, pending: floorPending } = useFloorPrices(
    wantCards.map((c) => c.name)
  );
  const { value: wantValue, unpriced: wantUnpriced } = askFloorValue(wantCards, floorPrices);

  function send() {
    if (!canSend) return;
    void sendTrade({ give: giveCards, receive: wantCards, note });
  }

  // The carousel is a SIBLING of the Modal, never a child: `Modal` renders in
  // place with no portal, so nesting one inside another's children stacks two
  // scroll-locking layers. The overlay stack is module-global, so Escape and
  // still resolves to whichever is topmost.
  return (
    <>
      {/* Keeps .choice-dialog — its max-height / keyboard-inset / scroll
          behaviour is what this sheet relies on — and only widens it: two
          side-by-side baskets do not fit a 460px confirm-dialog. */}
      <Modal
        onClose={onClose}
        labelledBy={titleId}
        dismissable={!sending}
        className="choice-dialog trade-composer-panel"
      >
        <div className="game-night-dialog trade-composer">
          {/* "Trade with X", not "Propose a trade · X": the longer form wrapped
              to two lines of --text-xl on a phone and took a third of the
              first screen before a single card was visible. */}
          <h2 id={titleId} className="game-night-dialog-title">
            Trade with {friendName}
          </h2>
          <p className="game-night-dialog-hint">
            {friendName} sees the exact printings and confirms theirs when they accept.
          </p>

          {counterTo && (
            <p className="trade-composer-counter-note" role="status">
              Countering {counterTo.name}&apos;s offer. Sending this declines theirs.
              {!awaitingFirstPull && giveSkipped.length > 0 && (
                <> Left out because you no longer own enough: {giveSkipped.join(', ')}.</>
              )}
            </p>
          )}

          <div className="trade-composer-sides">
            <TradeSide
              title="You give"
              count={totalGive}
              value={formatMoney(giveValue)}
              query={giveQuery}
              onQuery={setGiveQuery}
              searchLabel="Search your collection"
              picked={giveCards.map((c) => {
                const line = ownedByKey.get(keyOf(c));
                return {
                  key: keyOf(c),
                  name: c.name,
                  quantity: c.quantity,
                  max: line?.copies.length ?? c.quantity,
                  wanted: wantedKeys.has(keyOf(c)),
                  value: formatMoney(sumCopyValue(chosenByKey.get(keyOf(c)) ?? [])),
                  give: {
                    line,
                    chosen: new Set(chosenByKey.get(keyOf(c))?.map((x) => x.copyId) ?? []),
                  },
                };
              })}
              onSetPrinting={setPrintingCount}
              binderByCopyId={binderByCopyId}
              filterSlot={
                <>
                  {surplusByName.size > 0 && (
                    <button
                      type="button"
                      className={spareOnly ? 'trade-spare-toggle is-on' : 'trade-spare-toggle'}
                      aria-pressed={spareOnly}
                      onClick={() => setSpareOnly((v) => !v)}
                    >
                      Spare copies
                      <span className="trade-spare-count">{surplusByName.size}</span>
                    </button>
                  )}
                  {/* Pairs with "Spare copies": together they answer the only
                    question that matters on this side — what can I part with
                    that they'd actually want? Hidden when nothing they want is
                    in the collection, since a toggle that empties the list is
                    a dead end, not a filter. */}
                  {wantedKeys.size > 0 && (
                    <button
                      type="button"
                      className={wantedOnly ? 'trade-spare-toggle is-on' : 'trade-spare-toggle'}
                      aria-pressed={wantedOnly}
                      onClick={() => setWantedOnly((v) => !v)}
                    >
                      {friendName} wants
                      <span className="trade-spare-count">{wantedKeys.size}</span>
                    </button>
                  )}
                </>
              }
              onRemove={removeGive}
              results={giveResults.map((line) => ({
                key: keyOf(line),
                name: line.name,
                max: line.copies.length,
                wanted: wantedKeys.has(keyOf(line)),
                detail:
                  line.copies.length > 1
                    ? `${line.copies.length} copies · from ${formatMoney(copiesByValue(line)[0]?.purchasePrice)}`
                    : formatMoney(line.copies[0]?.purchasePrice),
              }))}
              onPick={(key) => {
                const line = ownedByKey.get(key);
                if (line) addGive(line);
              }}
              onInspect={(key, from) => {
                if (from === 'picked') {
                  const card = giveCards.find((c) => keyOf(c) === key);
                  if (card) void inspectPicked(card);
                  return;
                }
                const line = ownedByKey.get(key);
                if (line) inspectGiveResult(line);
              }}
              loading={awaitingFirstPull && ownedLines.length === 0}
              loadingLabel="Getting your cards…"
              emptyResults={
                ownedLines.length === 0
                  ? 'Your collection is empty. Import or add cards first.'
                  : wantedOnly && spareOnly
                    ? `Nothing spare that ${friendName} wants matches that search. Turn off a filter to widen it.`
                    : wantedOnly
                      ? `Nothing ${friendName} wants matches that search. Turn off “${friendName} wants” to offer something else.`
                      : spareOnly
                        ? "No spare copies match that search. Turn off “Spare copies” to offer one that's in a deck."
                        : 'No cards match that search.'
              }
            />

            <TradeSide
              title="You get"
              count={totalWant}
              // "from" because it is the cheapest printing that exists, not the
              // printing they'll actually hand over — which nobody knows until
              // they accept. Overstating this as a price is the one thing a
              // fairness number must not do.
              value={
                totalWant === 0
                  ? formatMoney(0)
                  : floorPending
                    ? '…'
                    : `from ${formatMoney(wantValue)}${wantUnpriced > 0 ? ' +?' : ''}`
              }
              query={wantQuery}
              onQuery={setWantQuery}
              searchLabel={`Search ${friendName}'s collection`}
              searchNote={
                wantSearch.ignored.length > 0
                  ? `${wantSearch.ignored.join(', ')} ${wantSearch.ignored.length === 1 ? 'is' : 'are'} not searchable in a friend's collection. The rest of your search still ran.`
                  : undefined
              }
              picked={wantCards.map((c) => ({
                key: keyOf(c),
                name: c.name,
                quantity: c.quantity,
                // The friend's collection is oracle-level with no quantities, so
                // there is no true ceiling to enforce here — they confirm what
                // they can actually part with when they accept.
                max: 20,
                value: (() => {
                  const floor = floorPrices.get(c.name);
                  return floor == null ? undefined : `from ${formatMoney(floor * c.quantity)}`;
                })(),
              }))}
              onBump={(key, delta, max) => setWanting((prev) => bump(prev, key, delta, max))}
              onRemove={(key) =>
                setWanting((prev) => bump(prev, key, -(prev[key] ?? 0), MAX_COPIES_PER_LINE))
              }
              results={wantResults.map((card) => ({
                key: keyOf(card),
                name: card.name,
                max: 20,
              }))}
              onPick={addWant}
              onInspect={(key, from) => {
                if (from === 'picked') {
                  const card = wantCards.find((c) => keyOf(c) === key);
                  if (card) void inspectPicked(card);
                  return;
                }
                const card = friendByKey.get(key);
                if (card) void inspectWantResult(card);
              }}
              loading={friendCardsLoading}
              error={friendCardsError ? `Couldn't load ${friendName}'s collection.` : undefined}
              onRetry={onRetryFriendCards}
              emptyResults={
                (friendCards?.length ?? 0) === 0
                  ? `${friendName} hasn't added any cards yet.`
                  : 'No cards match that search.'
              }
            />
          </div>

          <div className="trade-composer-note">
            <label htmlFor={noteId} className="trade-composer-note-label">
              Note <span className="trade-composer-optional">(optional)</span>
            </label>
            <textarea
              id={noteId}
              className="trade-composer-note-input"
              value={note}
              maxLength={500}
              rows={2}
              placeholder="Bring these Thursday?"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="game-night-dialog-actions">
            <Button onClick={onClose} disabled={sending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={send} disabled={!canSend}>
              {sending ? 'Sending…' : 'Send offer'}
            </Button>
          </div>
          {!canSend && !sending && startedBasket && (
            <p className="trade-composer-gate" role="status">
              Add at least one card to send.
            </p>
          )}
        </div>
      </Modal>

      {preview && (
        <TradePreviewCarousel
          state={preview}
          onIndexChange={(i) => setPreview((p) => (p ? { ...p, index: i } : p))}
          onClose={closePreview}
          getActions={
            previewActions
              ? (i) => {
                  const run = previewActions[i];
                  return run
                    ? [
                        {
                          key: 'add',
                          icon: <Plus width={18} height={18} strokeWidth={2} aria-hidden />,
                          label: 'Add',
                          onClick: run,
                        },
                      ]
                    : [];
                }
              : undefined
          }
        />
      )}
    </>
  );
}

interface SideRow {
  key: string;
  name: string;
  quantity?: number;
  max: number;
  detail?: string;
  /** Give side only: this card is on the friend's want list. */
  wanted?: boolean;
  /** Row subtotal, pre-formatted (the side owns currency/estimate wording). */
  value?: string;
  /**
   * Give side only: the owned line and which of its copies are in the trade.
   * Absent on the ask side, where there is no printing to choose — that is the
   * privacy asymmetry, not an omission. `line` itself can be undefined when a
   * copy was edited away in another tab; the row then has nothing to expand.
   */
  give?: { line?: OwnedTradeLine; chosen: Set<string> };
}

/** One basket: a search, the cards already in it, and the pickable results. */
function TradeSide({
  title,
  count,
  value,
  query,
  onQuery,
  searchLabel,
  searchNote,
  picked,
  onBump,
  onSetPrinting,
  binderByCopyId,
  filterSlot,
  onRemove,
  onPick,
  onInspect,
  results,
  emptyResults,
  loading = false,
  loadingLabel,
  error,
  onRetry,
}: {
  title: string;
  count: number;
  value?: string;
  query: string;
  onQuery: (next: string) => void;
  searchLabel: string;
  /** Honest degrade note under the pill — e.g. clauses this side can't answer. */
  searchNote?: string;
  picked: SideRow[];
  onBump?: (key: string, delta: number, max: number) => void;
  onSetPrinting?: (key: string, printingKey: string, count: number) => void;
  /** Give side only — where each owned copy currently lives. */
  binderByCopyId?: Map<string, BinderRef[]>;
  /** Optional control rendered beside the search pill — the give side's
   *  "Spare copies" narrowing. Absent on the ask side, which has no notion of
   *  what a friend can spare. */
  filterSlot?: ReactNode;
  onRemove: (key: string) => void;
  onPick: (key: string) => void;
  /** Open the card-preview carousel from a row's thumbnail. The thumb is the
   *  preview affordance everywhere a row's own click is already a verb — see
   *  AddCardSearchPanel, which this mirrors. */
  onInspect: (key: string, from: 'result' | 'picked') => void;
  results: SideRow[];
  emptyResults: string;
  loading?: boolean;
  /** Accessible name for the loading skeleton; defaults to "Loading <title>". */
  loadingLabel?: string;
  error?: string;
  onRetry?: () => void;
}) {
  const headingId = useId();
  return (
    <section className="trade-side" aria-labelledby={headingId}>
      <h3 className="trade-side-title" id={headingId}>
        {title}
        {count > 0 && <span className="trade-composer-count">{count}</span>}
        {value && (
          <span className="trade-side-value" data-testid={`trade-side-value-${title}`}>
            {value}
          </span>
        )}
      </h3>

      {picked.length > 0 && (
        <ul className="trade-side-picked" aria-label={`${title}: chosen cards`}>
          {picked.map((row) => (
            <PickedRow
              key={row.key}
              row={row}
              onBump={onBump}
              onSetPrinting={onSetPrinting}
              binderByCopyId={binderByCopyId}
              onInspect={() => onInspect(row.key, 'picked')}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}

      <SearchPill
        value={query}
        onChange={onQuery}
        placeholder={searchLabel}
        ariaLabel={searchLabel}
        className="trade-side-search"
      />

      {filterSlot && <div className="trade-side-filters">{filterSlot}</div>}

      {searchNote && (
        <p className="trade-side-note" role="status">
          {searchNote}
        </p>
      )}

      {error ? (
        <p className="trade-side-note" role="alert">
          {error}{' '}
          {onRetry && (
            <Button variant="link" onClick={onRetry}>
              Retry
            </Button>
          )}
        </p>
      ) : loading ? (
        <div
          className="trade-side-skeleton"
          aria-label={loadingLabel ?? `Loading ${title}`}
          role="status"
          aria-busy="true"
        />
      ) : results.length === 0 ? (
        <p className="trade-side-note" role="status">
          {emptyResults}
        </p>
      ) : (
        <ul className="trade-side-results" aria-label={`${title}: pick a card`}>
          {results.map((row) => (
            // Two sibling buttons, not one row-wide button with a nested one
            // (invalid HTML). The split is deliberately UNEVEN: this picker is
            // tapped repeatedly over ~11.5k cards, so the add target keeps the
            // name, detail and "+" — only the thumbnail is carved out for the
            // preview.
            <li key={row.key} className="trade-result-row">
              <button
                type="button"
                className="trade-thumb-btn"
                aria-label={`Preview ${row.name}`}
                title="Preview card"
                onClick={() => onInspect(row.key, 'result')}
              >
                <TradeCardThumb name={row.name} />
              </button>
              <button
                type="button"
                className="trade-result-pick"
                aria-label={`Add ${row.name}`}
                onClick={() => onPick(row.key)}
              >
                <span className="trade-picked-info">
                  <span className="trade-picked-name-row">
                    <span className="trade-picked-name" title={row.name}>
                      {row.name}
                    </span>
                    {row.wanted && <WantedBadge />}
                  </span>
                  {row.detail && <span className="trade-picked-detail">{row.detail}</span>}
                </span>
                <Plus width={16} height={16} aria-hidden className="trade-result-add" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * "Wanted" — this card is on the friend's want list.
 *
 * Never colour alone: the word carries the meaning, so it survives a
 * colour-blind reader and a screen reader alike (`aria-hidden` would drop the
 * one signal a give row can't otherwise express).
 */
function WantedBadge() {
  return (
    <Chip className="trade-wanted-badge" tone="accent">
      Wanted
    </Chip>
  );
}

/**
 * One card already in the basket.
 *
 * Two shapes, because the two sides genuinely differ: the ask side is a
 * quantity of an oracle card (a stepper), the give side is a set of specific
 * physical objects (a copy list). Collapsed, a give row shows what's going and
 * what it's worth; the disclosure only appears when there is actually a choice
 * to make — most of a collection is one printing, and offering that shouldn't
 * cost an extra tap.
 */
function PickedRow({
  row,
  onBump,
  onSetPrinting,
  binderByCopyId,
  onInspect,
  onRemove,
}: {
  row: SideRow;
  onBump?: (key: string, delta: number, max: number) => void;
  onSetPrinting?: (key: string, printingKey: string, count: number) => void;
  /** Give side only — where each owned copy currently lives. */
  binderByCopyId?: Map<string, BinderRef[]>;
  onInspect: () => void;
  onRemove: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  // Not memoized: this is one card's copies, and it only runs for a row the
  // user actually put in the basket.
  const groups = row.give?.line ? groupByPrinting(row.give.line) : [];
  const chosen = row.give?.chosen;
  const countIn = (group: PrintingGroup) =>
    chosen ? group.copies.filter((copy) => chosen.has(copy.copyId)).length : 0;
  const inTrade = groups.filter((g) => countIn(g) > 0);
  const totalChosen = groups.reduce((n, g) => n + countIn(g), 0);
  const totalOwned = groups.reduce((n, g) => n + g.copies.length, 0);
  // Nothing to choose between when there is only one printing — the control
  // would be a tap that changes nothing.
  const canChoose = groups.length > 1 && !!onSetPrinting;

  return (
    <li className="trade-picked-row-wrap">
      <div className="trade-picked-row">
        {/* Nothing else on this row claimed the thumbnail — the chevron,
            stepper and × are all to the right — so the preview is purely
            additive here. */}
        <button
          type="button"
          className="trade-thumb-btn"
          aria-label={`Preview ${row.name}`}
          title="Preview card"
          onClick={onInspect}
        >
          <TradeCardThumb name={row.name} />
        </button>
        <span className="trade-picked-info">
          <span className="trade-picked-name-row">
            <span className="trade-picked-name" title={row.name}>
              {row.name}
            </span>
            {row.wanted && <WantedBadge />}
          </span>
          {/* WHICH printing is leaving — the thing a quantity alone can never
              say, and the reason this row exists. */}
          {inTrade.length > 0 && (
            <span className="trade-picked-detail">
              {inTrade
                .map((g) => {
                  const n = countIn(g);
                  return n > 1 ? `${describePrinting(g)} ×${n}` : describePrinting(g);
                })
                .join(' + ')}
            </span>
          )}
          {row.detail && <span className="trade-picked-detail">{row.detail}</span>}
        </span>

        {row.value && <span className="trade-picked-value">{row.value}</span>}

        {row.give ? (
          canChoose && (
            <button
              type="button"
              className="trade-picked-choose"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls={listId}
              aria-label={`Choose which printing of ${row.name} to trade, ${totalChosen} of ${totalOwned} copies selected`}
            >
              <span aria-hidden>
                {totalChosen}/{totalOwned}
              </span>
              <ChevronDown
                width={14}
                height={14}
                strokeWidth={1.8}
                aria-hidden
                className={open ? 'trade-chevron is-open' : 'trade-chevron'}
              />
            </button>
          )
        ) : (
          <span className="trade-stepper">
            <IconButton
              className="trade-stepper-btn"
              onClick={() => onBump?.(row.key, -1, row.max)}
              label={`One fewer ${row.name}`}
              icon={<Minus width={14} height={14} strokeWidth={1.8} />}
            />
            <span className="trade-stepper-value" aria-live="polite">
              {row.quantity ?? 0}
            </span>
            <IconButton
              className="trade-stepper-btn"
              onClick={() => onBump?.(row.key, 1, row.max)}
              disabled={(row.quantity ?? 0) >= row.max}
              label={`One more ${row.name}`}
              icon={<Plus width={14} height={14} strokeWidth={1.8} />}
            />
          </span>
        )}

        <IconButton
          className="trade-picked-remove"
          onClick={() => onRemove(row.key)}
          label={`Remove ${row.name} from the trade`}
          icon={<X width={14} height={14} strokeWidth={1.8} />}
        />
      </div>

      {canChoose && open && (
        <div className="trade-picked-printings" id={listId}>
          <PrintingChoices
            cardName={row.name}
            groups={groups}
            countOf={countIn}
            onSet={(printingKey, next) => onSetPrinting?.(row.key, printingKey, next)}
            binderByCopyId={binderByCopyId}
            label={`${row.name}: your printings`}
          />
        </div>
      )}
    </li>
  );
}

/** Thumbnail resolved from the card NAME via the CDN — never the throttled
 *  Scryfall API (same contract as RadarCardTile). */
function TradeCardThumb({ name }: { name: string }) {
  const thumb = useCardThumb(name, 'small');
  return thumb ? (
    <img className="trade-thumb" src={thumb} alt="" aria-hidden loading="lazy" draggable={false} />
  ) : (
    <span className="trade-thumb is-placeholder" aria-hidden />
  );
}
