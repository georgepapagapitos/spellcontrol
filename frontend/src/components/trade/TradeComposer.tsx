import './TradeComposer.css';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Minus, Plus, X } from 'lucide-react';
import { Modal } from '../Modal';
import { SearchPill } from '../SearchPill';
import { buildFriendSearch } from '../../lib/friend-search';
import { getCardTags, useCardTagsReady } from '../../lib/card-tags';
import { useCollectionStore } from '../../store/collection';
import { useCardThumb } from '../../lib/card-thumbs';
import { toast } from '../../store/toasts';
import { formatMoney } from '../../lib/format-money';
import { PrintingChoices, describePrinting } from './PrintingChoices';
import { useBinderByCopyId, type BinderRef } from '../../lib/use-binder-by-copy';
import { useAllocations, computeSurplusByName } from '../../lib/allocations';
import {
  groupOwnedForTrade,
  filterOwnedLines,
  filterToSurplus,
  copiesByValue,
  groupByPrinting,
  toTradeCardFromCopies,
  toRequestedCard,
  sumCopyValue,
  type OwnedTradeLine,
  type PrintingGroup,
} from '../../lib/trade-picker';
import { useFloorPrices } from '../../lib/trade-value';
import { resolveTradePreview } from '../../lib/trade-preview';
import { TradePreviewCarousel, type TradePreviewState } from './TradePreviewCarousel';
import {
  proposeTrade,
  MAX_TRADE_LINES_PER_SIDE,
  type TradeOffer,
  type TradeCard,
} from '../../lib/trades-client';
import type { EnrichedCard } from '../../types';
import type { FriendCard } from '../../lib/cube/pool';
import type { FriendWant } from '../../lib/friends-client';

import { userMessage } from '@/lib/user-error';
/** How many picker results render before the list asks you to narrow down.
 *  A real collection is ~11.5k unique cards; the search filters the full set
 *  regardless of this cap (same contract as the friend Collection browser). */
const PICKER_LIMIT = 40;

/** Selected quantity, keyed by oracleId (or a name key for legacy copies). */
type Picked = Record<string, number>;

/**
 * The GIVE side is keyed by card, but its value is the list of `copyId`s the
 * owner actually chose — not a count. Seven printings of one card are seven
 * different objects at seven different prices; a quantity can't say which is
 * leaving the binder, and the old quantity-only model silently sent whichever
 * sorted first. `copyId` never reaches the wire (see toTradeCardFromCopies).
 */
type PickedCopies = Record<string, string[]>;

function keyOf(card: { oracleId: string; name: string }): string {
  return card.oracleId || `name:${card.name.toLowerCase()}`;
}

/**
 * Would adding `key` push a basket past the server's 40-lines-per-side cap?
 * Bumping a card already in the basket is never capped — the cap is on
 * distinct lines, not copies (copies have their own per-line ceiling of 20).
 */
function atLineCap(picked: Record<string, unknown>, key: string): boolean {
  return !(key in picked) && Object.keys(picked).length >= MAX_TRADE_LINES_PER_SIDE;
}

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
  /** Prefills the ask — used when opening from a trade-radar card. */
  initialWant?: { oracleId: string; name: string };
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
  initialWant,
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

  const [giving, setGiving] = useState<PickedCopies>({});
  const [wanting, setWanting] = useState<Picked>(() =>
    initialWant ? { [keyOf(initialWant)]: 1 } : {}
  );
  const [giveQuery, setGiveQuery] = useState('');
  const [spareOnly, setSpareOnly] = useState(false);
  const [wantedOnly, setWantedOnly] = useState(false);
  const [wantQuery, setWantQuery] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  // The prefilled want may not be in the fetched friend collection yet (or at
  // all, if the radar and the browser disagree) — keep a fallback so the chip
  // still renders with a name instead of vanishing.
  const wantFallback = useMemo(() => {
    const map = new Map<string, { oracleId: string; name: string }>();
    if (initialWant) map.set(keyOf(initialWant), initialWant);
    return map;
  }, [initialWant]);

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
  const wantedKeys = useMemo(() => {
    if (!friendWants || friendWants.length === 0) return new Set<string>();
    const byOracle = new Set<string>();
    const byName = new Set<string>();
    for (const want of friendWants) {
      if (want.oracleId) byOracle.add(want.oracleId);
      byName.add(want.name.toLowerCase());
    }
    const keys = new Set<string>();
    for (const line of ownedLines) {
      if ((line.oracleId && byOracle.has(line.oracleId)) || byName.has(line.name.toLowerCase())) {
        keys.add(keyOf(line));
      }
    }
    return keys;
  }, [friendWants, ownedLines]);

  const giveWantsTags = /\b(otag|oracletag|function)[:=]/i.test(giveQuery);
  const giveTagsReady = useCardTagsReady(giveWantsTags);
  const giveResults = useMemo(() => {
    let pool = spareOnly ? filterToSurplus(ownedLines, surplusByName) : ownedLines;
    if (wantedOnly) pool = pool.filter((line) => wantedKeys.has(keyOf(line)));
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
      message: `A trade side maxes out at ${MAX_TRADE_LINES_PER_SIDE} different cards — remove one to add another.`,
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
    setGiving((prev) => {
      const chosen = new Set(prev[keyOf(line)] ?? []);
      const next = copiesByValue(line).find((c) => !chosen.has(c.copyId));
      if (!next) return prev;
      return { ...prev, [keyOf(line)]: [...chosen, next.copyId] };
    });
  }

  /** The ask-side mirror of {@link addGive}: one more of `key`, unless it
   *  would be a 41st distinct line. Bumps of an already-picked card pass. */
  function addWant(key: string) {
    if (atLineCap(wanting, key)) {
      warnLineCap();
      return;
    }
    bump(setWanting, key, 1, 20);
  }

  /**
   * Set how many copies OF ONE PRINTING are in the trade. Selection is still
   * stored as copyIds — the wire shape and settlement both work in printings,
   * and identical copies are interchangeable — so this just swaps in the first
   * `count` of that group and leaves every other printing's picks alone.
   */
  function setPrintingCount(key: string, printingKey: string, count: number) {
    const line = ownedByKey.get(key);
    if (!line) return;
    const groups = groupByPrinting(line);
    const group = groups.find((g) => g.key === printingKey);
    if (!group) return;
    const groupIds = new Set(group.copies.map((c) => c.copyId));
    setGiving((prev) => {
      const kept = (prev[key] ?? []).filter((id) => !groupIds.has(id));
      const added = group.copies.slice(0, Math.max(0, Math.min(count, group.copies.length)));
      const next = [...kept, ...added.map((c) => c.copyId)];
      if (next.length === 0) {
        const without = { ...prev };
        delete without[key];
        return without;
      }
      return { ...prev, [key]: next };
    });
  }

  function removeGive(key: string) {
    setGiving((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function bump(
    setter: (fn: (prev: Picked) => Picked) => void,
    key: string,
    delta: number,
    max: number
  ) {
    setter((prev) => {
      const next = { ...prev };
      const value = (next[key] ?? 0) + delta;
      if (value <= 0) delete next[key];
      else next[key] = Math.min(value, max);
      return next;
    });
  }

  /** The chosen copies per picked line, resolved against what is owned NOW —
   *  a copy edited or deleted in another tab simply drops out. */
  const chosenByKey = useMemo(() => {
    const map = new Map<string, EnrichedCard[]>();
    for (const [key, copyIds] of Object.entries(giving)) {
      const line = ownedByKey.get(key);
      if (!line) continue;
      const ids = new Set(copyIds);
      const chosen = line.copies.filter((c) => ids.has(c.copyId));
      if (chosen.length > 0) map.set(key, chosen);
    }
    return map;
  }, [giving, ownedByKey]);

  const giveCards = [...chosenByKey.entries()]
    .map(([key, chosen]) => {
      const line = ownedByKey.get(key);
      return line ? toTradeCardFromCopies(line, chosen) : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null && c.quantity > 0);

  const wantCards = Object.entries(wanting)
    .map(([key, qty]) => {
      const card = friendByKey.get(key) ?? wantFallback.get(key);
      return card ? toRequestedCard(card, qty) : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null && c.quantity > 0);

  const totalGive = giveCards.reduce((n, c) => n + c.quantity, 0);
  const totalWant = wantCards.reduce((n, c) => n + c.quantity, 0);
  const canSend = !sending && giveCards.length + wantCards.length > 0;

  // Give side is exact — real copies, real printings, already priced.
  const giveValue = [...chosenByKey.values()].reduce((sum, c) => sum + sumCopyValue(c), 0);

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
  const wantValue = wantCards.reduce((sum, c) => {
    const floor = floorPrices.get(c.name);
    return sum + (floor ?? 0) * c.quantity;
  }, 0);
  const wantUnpriced = wantCards.filter((c) => (floorPrices.get(c.name) ?? null) === null).length;

  async function send() {
    if (!canSend) return;
    setSending(true);
    try {
      const offer = await proposeTrade({
        recipientId: friendId,
        give: giveCards,
        receive: wantCards,
        note: note.trim(),
      });
      toast.show({ message: `Trade sent to ${friendName}.`, tone: 'success' });
      onSent(offer);
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't send the trade. Try again."),
        tone: 'error',
      });
      setSending(false);
    }
  }

  // The carousel is a SIBLING of the Modal, never a child: `Modal` renders in
  // place with no portal, so nesting one inside another's children stacks two
  // scroll-locking layers. The overlay stack is module-global, so Escape and
  // Android back still resolve to whichever is topmost.
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
          <h2 id={titleId} className="game-night-dialog-title">
            Propose a trade — {friendName}
          </h2>
          <p className="game-night-dialog-hint">
            Pick what changes hands. {friendName} sees the exact printings you're offering, and
            confirms which of theirs they're giving when they accept.
          </p>

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
              emptyResults={
                ownedLines.length === 0
                  ? 'Your collection is empty — import or add cards first.'
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
                  ? `${wantSearch.ignored.join(', ')} ${wantSearch.ignored.length === 1 ? 'is' : 'are'} not searchable in a friend's collection — the rest of your search still applied.`
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
                  return floor == null ? '—' : `from ${formatMoney(floor * c.quantity)}`;
                })(),
              }))}
              onBump={(key, delta, max) => bump(setWanting, key, delta, max)}
              onRemove={(key) => bump(setWanting, key, -(wanting[key] ?? 0), 20)}
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
            <button type="button" className="btn" onClick={onClose} disabled={sending}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void send()}
              disabled={!canSend}
            >
              {sending ? 'Sending…' : 'Send offer'}
            </button>
          </div>
          {!canSend && !sending && (
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
                          icon: <Plus width={18} height={18} strokeWidth={2.4} aria-hidden />,
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
  error?: string;
  onRetry?: () => void;
}) {
  const headingId = useId();
  return (
    <section className="trade-side" aria-labelledby={headingId}>
      <h3 className="trade-side-title" id={headingId}>
        {title}
        {count > 0 && <span className="game-night-count">{count}</span>}
        {value && (
          <span className="trade-side-value" data-testid={`trade-side-value-${title}`}>
            {value}
          </span>
        )}
      </h3>

      {picked.length > 0 && (
        <ul className="trade-side-picked" aria-label={`${title} — chosen cards`}>
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
            <button type="button" className="btn-link" onClick={onRetry}>
              Try again
            </button>
          )}
        </p>
      ) : loading ? (
        <div className="trade-side-skeleton" aria-label={`Loading ${title}`} aria-busy="true" />
      ) : results.length === 0 ? (
        <p className="trade-side-note" role="status">
          {emptyResults}
        </p>
      ) : (
        <ul className="trade-side-results" aria-label={`${title} — pick a card`}>
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
  return <span className="trade-wanted-badge">Wanted</span>;
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
              aria-label={`Choose which printing of ${row.name} to trade — ${totalChosen} of ${totalOwned} copies selected`}
            >
              <span aria-hidden>
                {totalChosen}/{totalOwned}
              </span>
              <ChevronDown
                width={14}
                height={14}
                aria-hidden
                className={open ? 'trade-chevron is-open' : 'trade-chevron'}
              />
            </button>
          )
        ) : (
          <span className="trade-stepper">
            <button
              type="button"
              className="trade-stepper-btn"
              onClick={() => onBump?.(row.key, -1, row.max)}
              aria-label={`One fewer ${row.name}`}
            >
              <Minus width={14} height={14} aria-hidden />
            </button>
            <span className="trade-stepper-value" aria-live="polite">
              {row.quantity ?? 0}
            </span>
            <button
              type="button"
              className="trade-stepper-btn"
              onClick={() => onBump?.(row.key, 1, row.max)}
              disabled={(row.quantity ?? 0) >= row.max}
              aria-label={`One more ${row.name}`}
            >
              <Plus width={14} height={14} aria-hidden />
            </button>
          </span>
        )}

        <button
          type="button"
          className="trade-picked-remove"
          onClick={() => onRemove(row.key)}
          aria-label={`Remove ${row.name} from the trade`}
        >
          <X width={14} height={14} aria-hidden />
        </button>
      </div>

      {canChoose && open && (
        <div className="trade-picked-printings" id={listId}>
          <PrintingChoices
            cardName={row.name}
            groups={groups}
            countOf={countIn}
            onSet={(printingKey, next) => onSetPrinting?.(row.key, printingKey, next)}
            binderByCopyId={binderByCopyId}
            label={`${row.name} — your printings`}
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
