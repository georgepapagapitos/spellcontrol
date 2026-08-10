import './TradeComposer.css';
import { useId, useMemo, useState } from 'react';
import { ChevronDown, Minus, Plus, X } from 'lucide-react';
import { Modal } from '../Modal';
import { SearchPill } from '../SearchPill';
import { buildFriendSearch } from '../../lib/friend-search';
import { getCardTags, useCardTagsReady } from '../../lib/card-tags';
import { useCollectionStore } from '../../store/collection';
import { useCardThumb } from '../../lib/card-thumbs';
import { toast } from '../../store/toasts';
import { formatMoney } from '../../lib/format-money';
import {
  groupOwnedForTrade,
  filterOwnedLines,
  copiesByValue,
  groupByPrinting,
  toTradeCardFromCopies,
  toRequestedCard,
  sumCopyValue,
  type OwnedTradeLine,
} from '../../lib/trade-picker';
import { useFloorPrices } from '../../lib/trade-value';
import { proposeTrade, type TradeOffer } from '../../lib/trades-client';
import type { EnrichedCard } from '../../types';
import type { FriendCard } from '../../lib/cube/pool';

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

/** "LEA · #233 · foil · NM" — the identity of one printing, compactly. */
function describePrinting(p: {
  setCode: string;
  collectorNumber: string;
  finish: string;
  condition?: string;
}): string {
  return [
    p.setCode?.toUpperCase(),
    p.collectorNumber ? `#${p.collectorNumber}` : null,
    p.finish !== 'nonfoil' ? p.finish : null,
    p.condition,
  ]
    .filter(Boolean)
    .join(' · ');
}

function keyOf(card: { oracleId: string; name: string }): string {
  return card.oracleId || `name:${card.name.toLowerCase()}`;
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
  initialWant,
  onClose,
  onSent,
}: Props) {
  const cards = useCollectionStore((s) => s.cards);
  const titleId = useId();
  const noteId = useId();

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

  const giveResults = useMemo(
    () => filterOwnedLines(ownedLines, giveQuery).slice(0, PICKER_LIMIT),
    [ownedLines, giveQuery]
  );

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

  /** Picking a card from the results adds its CHEAPEST unchosen copy — the
   *  same safe default `copiesByValue` documents. One tap still works for the
   *  single-printing case, which is most of a collection. */
  function addGive(line: OwnedTradeLine) {
    setGiving((prev) => {
      const chosen = new Set(prev[keyOf(line)] ?? []);
      const next = copiesByValue(line).find((c) => !chosen.has(c.copyId));
      if (!next) return prev;
      return { ...prev, [keyOf(line)]: [...chosen, next.copyId] };
    });
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
        message: err instanceof Error ? err.message : 'Failed to send the trade.',
        tone: 'error',
      });
      setSending(false);
    }
  }

  return (
    // Keeps .choice-dialog — its max-height / keyboard-inset / scroll
    // behaviour is what this sheet relies on — and only widens it: two
    // side-by-side baskets do not fit a 460px confirm-dialog.
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
          Pick what changes hands. {friendName} sees the exact printings you’re offering, and
          confirms which of theirs they’re giving when they accept.
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
              const chosen = new Set(chosenByKey.get(keyOf(c))?.map((x) => x.copyId) ?? []);
              return {
                key: keyOf(c),
                name: c.name,
                quantity: c.quantity,
                max: line?.copies.length ?? c.quantity,
                value: formatMoney(sumCopyValue(chosenByKey.get(keyOf(c)) ?? [])),
                printings: (line ? groupByPrinting(line) : []).map((group) => ({
                  key: group.key,
                  label: describePrinting(group),
                  price: formatMoney(group.price),
                  owned: group.copies.length,
                  chosen: group.copies.filter((copy) => chosen.has(copy.copyId)).length,
                })),
              };
            })}
            onSetPrinting={setPrintingCount}
            onRemove={removeGive}
            results={giveResults.map((line) => ({
              key: keyOf(line),
              name: line.name,
              max: line.copies.length,
              detail:
                line.copies.length > 1
                  ? `${line.copies.length} copies · from ${formatMoney(copiesByValue(line)[0]?.purchasePrice)}`
                  : formatMoney(line.copies[0]?.purchasePrice),
            }))}
            onPick={(key) => {
              const line = ownedByKey.get(key);
              if (line) addGive(line);
            }}
            emptyResults={
              ownedLines.length === 0
                ? 'Your collection is empty — import or add cards first.'
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
            searchLabel={`Search ${friendName}’s collection`}
            searchNote={
              wantSearch.ignored.length > 0
                ? `${wantSearch.ignored.join(', ')} ${wantSearch.ignored.length === 1 ? 'is' : 'are'} not searchable in a friend’s collection — the rest of your search still applied.`
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
            onPick={(key) => bump(setWanting, key, 1, 20)}
            loading={friendCardsLoading}
            error={friendCardsError ? `Couldn’t load ${friendName}’s collection.` : undefined}
            onRetry={onRetryFriendCards}
            emptyResults={
              (friendCards?.length ?? 0) === 0
                ? `${friendName} hasn’t added any cards yet.`
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
  );
}

/** One printing the owner holds, and how many of it are in the trade. */
interface PrintingChoice {
  key: string;
  /** "LEA · #233 · foil · NM" */
  label: string;
  price: string;
  owned: number;
  chosen: number;
}

interface SideRow {
  key: string;
  name: string;
  quantity?: number;
  max: number;
  detail?: string;
  /** Row subtotal, pre-formatted (the side owns currency/estimate wording). */
  value?: string;
  /** Give side only: every printing owned, cheapest first. Absent on the ask
   *  side, where there is no printing to choose — that is the privacy
   *  asymmetry, not an omission. */
  printings?: PrintingChoice[];
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
  onRemove,
  onPick,
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
  onRemove: (key: string) => void;
  onPick: (key: string) => void;
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
            <li key={row.key}>
              <button type="button" className="trade-result-row" onClick={() => onPick(row.key)}>
                <TradeCardThumb name={row.name} />
                <span className="trade-picked-info">
                  <span className="trade-picked-name" title={row.name}>
                    {row.name}
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
  onRemove,
}: {
  row: SideRow;
  onBump?: (key: string, delta: number, max: number) => void;
  onSetPrinting?: (key: string, printingKey: string, count: number) => void;
  onRemove: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const printings = row.printings ?? [];
  const inTrade = printings.filter((p) => p.chosen > 0);
  const totalChosen = printings.reduce((n, p) => n + p.chosen, 0);
  const totalOwned = printings.reduce((n, p) => n + p.owned, 0);
  // Nothing to choose between when there is only one printing — the control
  // would be a tap that changes nothing.
  const canChoose = printings.length > 1 && !!onSetPrinting;

  return (
    <li className="trade-picked-row-wrap">
      <div className="trade-picked-row">
        <TradeCardThumb name={row.name} />
        <span className="trade-picked-info">
          <span className="trade-picked-name" title={row.name}>
            {row.name}
          </span>
          {/* WHICH printing is leaving — the thing a quantity alone can never
              say, and the reason this row exists. */}
          {inTrade.length > 0 && (
            <span className="trade-picked-detail">
              {inTrade.map((p) => (p.chosen > 1 ? `${p.label} ×${p.chosen}` : p.label)).join(' + ')}
            </span>
          )}
          {row.detail && <span className="trade-picked-detail">{row.detail}</span>}
        </span>

        {row.value && <span className="trade-picked-value">{row.value}</span>}

        {row.printings ? (
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
        <ul className="trade-copy-list" id={listId} aria-label={`${row.name} — your printings`}>
          {printings.map((printing) => (
            <li key={printing.key} className="trade-copy-row">
              <span className="trade-copy-label">{printing.label}</span>
              <span className="trade-copy-price">{printing.price}</span>
              <span className="trade-stepper">
                <button
                  type="button"
                  className="trade-stepper-btn"
                  onClick={() => onSetPrinting?.(row.key, printing.key, printing.chosen - 1)}
                  disabled={printing.chosen === 0}
                  aria-label={`One fewer ${printing.label} ${row.name}`}
                >
                  <Minus width={14} height={14} aria-hidden />
                </button>
                <span className="trade-stepper-value" aria-live="polite">
                  {printing.chosen}
                  <span className="trade-copy-owned">/{printing.owned}</span>
                </span>
                <button
                  type="button"
                  className="trade-stepper-btn"
                  onClick={() => onSetPrinting?.(row.key, printing.key, printing.chosen + 1)}
                  disabled={printing.chosen >= printing.owned}
                  aria-label={`One more ${printing.label} ${row.name}`}
                >
                  <Plus width={14} height={14} aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
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
