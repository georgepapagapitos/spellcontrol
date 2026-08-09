import './TradeComposer.css';
import { useId, useMemo, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { Modal } from '../Modal';
import { SearchPill } from '../SearchPill';
import { useCollectionStore } from '../../store/collection';
import { useCardThumb } from '../../lib/card-thumbs';
import { toast } from '../../store/toasts';
import {
  groupOwnedForTrade,
  filterOwnedLines,
  toTradeCard,
  toRequestedCard,
  type OwnedTradeLine,
} from '../../lib/trade-picker';
import { proposeTrade, type TradeOffer } from '../../lib/trades-client';
import type { FriendCard } from '../../lib/cube/pool';

/** How many picker results render before the list asks you to narrow down.
 *  A real collection is ~11.5k unique cards; the search filters the full set
 *  regardless of this cap (same contract as the friend Collection browser). */
const PICKER_LIMIT = 40;

/** Selected quantity, keyed by oracleId (or a name key for legacy copies). */
type Picked = Record<string, number>;

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

  const [giving, setGiving] = useState<Picked>({});
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

  const wantResults = useMemo(() => {
    const q = wantQuery.trim().toLowerCase();
    const all = friendCards ?? [];
    const matched = q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all;
    return [...matched].sort((a, b) => a.name.localeCompare(b.name)).slice(0, PICKER_LIMIT);
  }, [friendCards, wantQuery]);

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

  const giveCards = Object.entries(giving)
    .map(([key, qty]) => {
      const line = ownedByKey.get(key);
      return line ? toTradeCard(line, qty) : null;
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
            query={giveQuery}
            onQuery={setGiveQuery}
            searchLabel="Search your collection"
            picked={giveCards.map((c) => ({
              key: keyOf(c),
              name: c.name,
              quantity: c.quantity,
              max: ownedByKey.get(keyOf(c))?.copies.length ?? c.quantity,
              detail: describePrintings(ownedByKey.get(keyOf(c)), c.quantity),
            }))}
            onBump={(key, delta, max) => bump(setGiving, key, delta, max)}
            results={giveResults.map((line) => ({
              key: keyOf(line),
              name: line.name,
              max: line.copies.length,
              detail: line.copies.length > 1 ? `${line.copies.length} copies` : undefined,
            }))}
            emptyResults={
              ownedLines.length === 0
                ? 'Your collection is empty — import or add cards first.'
                : 'No cards match that search.'
            }
          />

          <TradeSide
            title="You get"
            count={totalWant}
            query={wantQuery}
            onQuery={setWantQuery}
            searchLabel={`Search ${friendName}’s collection`}
            picked={wantCards.map((c) => ({
              key: keyOf(c),
              name: c.name,
              quantity: c.quantity,
              // The friend's collection is oracle-level with no quantities, so
              // there is no true ceiling to enforce here — they confirm what
              // they can actually part with when they accept.
              max: 20,
              detail: undefined,
            }))}
            onBump={(key, delta, max) => bump(setWanting, key, delta, max)}
            results={wantResults.map((card) => ({
              key: keyOf(card),
              name: card.name,
              max: 20,
              detail: undefined,
            }))}
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

/** "Kaladesh · foil" style summary of which physical copies are going, so the
 *  owner can see the printing leaving before they send it. */
function describePrintings(line: OwnedTradeLine | undefined, quantity: number): string | undefined {
  if (!line) return undefined;
  const going = line.copies.slice(0, quantity);
  if (going.length === 0) return undefined;
  const parts = going.map((c) =>
    [c.setCode?.toUpperCase(), c.finish !== 'nonfoil' ? c.finish : null].filter(Boolean).join(' ')
  );
  return [...new Set(parts)].join(', ');
}

interface SideRow {
  key: string;
  name: string;
  quantity?: number;
  max: number;
  detail?: string;
}

/** One basket: a search, the cards already in it, and the pickable results. */
function TradeSide({
  title,
  count,
  query,
  onQuery,
  searchLabel,
  picked,
  onBump,
  results,
  emptyResults,
  loading = false,
  error,
  onRetry,
}: {
  title: string;
  count: number;
  query: string;
  onQuery: (next: string) => void;
  searchLabel: string;
  picked: SideRow[];
  onBump: (key: string, delta: number, max: number) => void;
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
      </h3>

      {picked.length > 0 && (
        <ul className="trade-side-picked" aria-label={`${title} — chosen cards`}>
          {picked.map((row) => (
            <li key={row.key} className="trade-picked-row">
              <TradeCardThumb name={row.name} />
              <span className="trade-picked-info">
                <span className="trade-picked-name" title={row.name}>
                  {row.name}
                </span>
                {row.detail && <span className="trade-picked-detail">{row.detail}</span>}
              </span>
              <span className="trade-stepper">
                <button
                  type="button"
                  className="trade-stepper-btn"
                  onClick={() => onBump(row.key, -1, row.max)}
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
                  onClick={() => onBump(row.key, 1, row.max)}
                  disabled={(row.quantity ?? 0) >= row.max}
                  aria-label={`One more ${row.name}`}
                >
                  <Plus width={14} height={14} aria-hidden />
                </button>
              </span>
              <button
                type="button"
                className="trade-picked-remove"
                onClick={() => onBump(row.key, -(row.quantity ?? 0), row.max)}
                aria-label={`Remove ${row.name} from the trade`}
              >
                <X width={14} height={14} aria-hidden />
              </button>
            </li>
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
              <button
                type="button"
                className="trade-result-row"
                onClick={() => onBump(row.key, 1, row.max)}
              >
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
