import './TradeOfferList.css';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { UserAvatar } from '../UserAvatar';
import { useCardThumb } from '../../lib/card-thumbs';
import { formatMoney } from '../../lib/format-money';
import { formatRelativeTime } from '../../lib/format-time';
import { splitSideValue, useFloorPrices } from '../../lib/trade-value';
import { toast } from '../../store/toasts';
import {
  acceptTrade,
  declineTrade,
  withdrawTrade,
  TradeConflictError,
  type TradeCard,
  type TradeOffer,
} from '../../lib/trades-client';
import { useCollectionStore } from '../../store/collection';
import {
  groupOwnedForTrade,
  groupByPrinting,
  toTradeCard,
  type OwnedTradeLine,
} from '../../lib/trade-picker';
import { settleTrade } from '../../lib/use-trade-settlement';
import { resolveTradePreview } from '../../lib/trade-preview';
import { CardPreview } from '../CardPreview';
import type { EnrichedCard } from '../../types';
import { buildCardLocationIndex, type CardLocation } from '../../lib/card-locations';
import { TradeAcceptDialog, type AcceptChoice } from './TradeAcceptDialog';

const STATUS_LABEL: Record<TradeOffer['status'], string> = {
  proposed: 'Waiting',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

interface Props {
  offers: TradeOffer[];
  /** Re-fetch after any transition, so a losing race corrects itself. */
  onChanged: () => void;
  /** Opens the composer prefilled as a counter to this offer. */
  onCounter?: (offer: TradeOffer) => void;
  /**
   * Head each card with the counterparty's avatar + name, linked to their hub.
   * Off inside a friend's own hub — the page already names who you're looking
   * at, and a row of links back to the current page is noise. On in `/trades`,
   * where consecutive rows can be different people.
   */
  linkCounterparty?: boolean;
  /** Accessible name for the list. Defaults to the friend-hub wording. */
  label?: string;
}

/**
 * A list of trade offers, newest first — the thread with one friend on their
 * hub, or one status group of the `/trades` index.
 *
 * Accepting is the one action with real weight — it resolves which of the
 * viewer's physical copies are going, then settles both halves into their
 * collection immediately. Everything else is a status change.
 */
export function TradeOfferList({ offers, onChanged, onCounter, linkCounterparty, label }: Props) {
  // Grouped ONCE for the whole list rather than per card: a real collection is
  // ~11.5k rows, and every offer in a group asks the same question of it.
  const cards = useCollectionStore((s) => s.cards);
  const binderDefs = useCollectionStore((s) => s.binders);
  const ownedByKey = useMemo(() => {
    const map = new Map<string, OwnedTradeLine>();
    for (const line of groupOwnedForTrade(cards)) {
      map.set(line.oracleId || `name:${line.name.toLowerCase()}`, line);
    }
    return map;
  }, [cards]);

  /**
   * Where a settled trade's incoming cards ended up, so a row can say which
   * binder and page to file them in.
   *
   * "Settled — your collection is up to date" was true and useless: this app's
   * whole premise is PHYSICAL binders, and the thing you actually do after a
   * trade is put a handful of cards away. Binder routing already placed them
   * the moment settlement added them; this reads the answer back out.
   *
   * Built only when an offer in this list can use it — it materializes the
   * whole collection, which a list of unsettled offers must not pay for.
   */
  const locations = useMemo(() => {
    const needed = offers.some((o) => o.status === 'accepted' && o.settled && o.receive.length > 0);
    // No binders defined → nothing to file into, and the note falls back.
    return needed && binderDefs?.length ? buildCardLocationIndex(cards, binderDefs) : null;
  }, [offers, cards, binderDefs]);

  if (offers.length === 0) {
    return (
      <div className="empty-state trade-offers-empty">
        <p className="empty-state-tagline">No trades yet.</p>
        <p className="empty-state-hint">
          Propose one and it shows up here — for both of you — until it’s answered.
        </p>
      </div>
    );
  }

  return (
    <ul className="trade-offer-list" aria-label={label ?? 'Trade offers'}>
      {offers.map((offer) => (
        <li key={offer.id}>
          <TradeOfferCard
            offer={offer}
            onChanged={onChanged}
            onCounter={onCounter}
            linkCounterparty={linkCounterparty}
            ownedByKey={ownedByKey}
            locations={locations}
          />
        </li>
      ))}
    </ul>
  );
}

function TradeOfferCard({
  offer,
  onChanged,
  onCounter,
  linkCounterparty,
  ownedByKey,
  locations,
}: {
  offer: TradeOffer;
  onChanged: () => void;
  onCounter?: (offer: TradeOffer) => void;
  linkCounterparty?: boolean;
  ownedByKey: Map<string, OwnedTradeLine>;
  /** Oracle id → binder + page, built once per list; null when no row needs it. */
  locations: Map<string, CardLocation> | null;
}) {
  const [busy, setBusy] = useState(false);
  // Non-null while the viewer is choosing which copies to hand over.
  const [choosing, setChoosing] = useState<AcceptChoice[] | null>(null);
  // Non-null while the card-preview carousel is open over this offer.
  const [preview, setPreview] = useState<{ cards: EnrichedCard[]; index: number } | null>(null);
  const headingId = useId();

  /**
   * Open the carousel on the tapped card, spanning the WHOLE offer — give side
   * then get side, in reading order. A trade is one decision about a set of
   * cards, so being able to swipe from what you're giving straight into what
   * you're getting is the point; a per-chip single-card modal would make you
   * close and re-open for every card in the deal.
   */
  async function inspect(card: TradeCard) {
    const all = [...offer.give, ...offer.receive];
    const { cards, indexOf } = await resolveTradePreview(all);
    if (cards.length === 0) {
      toast.show({ message: 'Couldn’t load these cards right now.', tone: 'warn' });
      return;
    }
    // A card whose own lookup failed is not in the carousel; open at the
    // nearest slide rather than refusing, so one bad card can't block the rest.
    const at = indexOf(card);
    setPreview({ cards, index: at >= 0 ? at : 0 });
  }

  const who = offer.counterpartyDisplayName || `@${offer.counterpartyUsername}`;
  const canAnswer = offer.status === 'proposed' && !offer.mine;
  const canWithdraw = offer.status === 'proposed' && offer.mine;
  // A settled accepted trade is done; an unsettled one is mid-flight and the
  // app-level runner is about to apply it, so no manual affordance is offered.
  const showSettling = offer.status === 'accepted' && !offer.settled;

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      if (err instanceof TradeConflictError) {
        toast.show({ message: err.message, tone: 'warn' });
      } else {
        toast.show({ message: err instanceof Error ? err.message : failure, tone: 'error' });
      }
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  /**
   * Accepting has to name the exact copies this person is handing over. The
   * offer asked oracle-level (the proposer picked from an oracle-level view of
   * this collection), so we resolve against what is actually owned right now —
   * and refuse rather than send a half-resolved deal if a card is gone.
   */
  function resolveAsk(): { choices: AcceptChoice[]; missing: string[] } {
    const choices: AcceptChoice[] = [];
    const missing: string[] = [];
    for (const asked of offer.give) {
      const line = ownedByKey.get(asked.oracleId || `name:${asked.name.toLowerCase()}`);
      if (!line || line.copies.length < asked.quantity) {
        missing.push(asked.name);
        continue;
      }
      choices.push({ asked, line });
    }
    return { choices, missing };
  }

  /**
   * True when at least one asked card exists in more than one printing here —
   * i.e. when accepting is a real decision rather than a formality. Most of a
   * collection is a single printing, and making those cost an extra tap would
   * be a worse feature, so the picker is opened only when it has something to
   * ask.
   */
  const needsChoice = useMemo(() => {
    if (!canAnswer) return false;
    return offer.give.some((asked) => {
      const line = ownedByKey.get(asked.oracleId || `name:${asked.name.toLowerCase()}`);
      return !!line && groupByPrinting(line).length > 1;
    });
  }, [canAnswer, offer.give, ownedByKey]);

  async function commit(resolved: TradeCard[]) {
    await run(async () => {
      const updated = await acceptTrade(offer.id, resolved);
      // Settle straight away: they just clicked accept, so the intent is
      // unambiguous and waiting for the background runner would leave their
      // collection visibly stale.
      await settleTrade(updated);
    }, 'Failed to accept the trade.');
    setChoosing(null);
  }

  async function accept() {
    const { choices, missing } = resolveAsk();
    if (missing.length > 0) {
      toast.show({
        message: `You no longer have ${missing.join(', ')} to give. Decline and counter instead.`,
        tone: 'warn',
      });
      return;
    }
    if (needsChoice) {
      setChoosing(choices);
      return;
    }
    // Nothing to choose — the cheapest-first pick IS the only pick.
    await commit(choices.map((c) => toTradeCard(c.line, c.asked.quantity)));
  }

  return (
    <article className="trade-offer-card" aria-labelledby={headingId}>
      <header className="trade-offer-head">
        <h4 className={`trade-offer-title${linkCounterparty ? ' has-link' : ''}`} id={headingId}>
          {linkCounterparty ? (
            // The person is the anchor, not the sentence — `/trades` mixes
            // people, so the row's job is "who, and which way round".
            <Link to={`/friends/${offer.counterpartyId}`} className="trade-offer-who">
              <UserAvatar name={who} size={28} />
              <span className="trade-offer-who-text">
                <span className="trade-offer-who-name">{who}</span>
                <span className="trade-offer-who-dir">
                  {offer.mine ? 'You offered' : 'Offered you'}
                </span>
              </span>
            </Link>
          ) : offer.mine ? (
            `You offered ${who}`
          ) : (
            `${who} offered you`
          )}
        </h4>
        <span className="trade-offer-meta">
          <span
            className={`trade-offer-status is-${offer.status}`}
            data-testid={`trade-status-${offer.id}`}
          >
            {STATUS_LABEL[offer.status]}
          </span>
          <TradeOfferAge offer={offer} />
        </span>
      </header>

      <div className="trade-offer-sides">
        <TradeOfferSide label="You give" cards={offer.give} onInspect={inspect} />
        <ArrowRight className="trade-offer-arrow" width={18} height={18} aria-label="for" />
        <TradeOfferSide label="You get" cards={offer.receive} onInspect={inspect} />
      </div>

      {offer.note && <p className="trade-offer-note">“{offer.note}”</p>}

      {showSettling && (
        <p className="trade-offer-settling" role="status">
          Adding to your collection…
        </p>
      )}
      {offer.status === 'accepted' && offer.settled && (
        <SettledNote cards={offer.receive} locations={locations} />
      )}

      {(canAnswer || canWithdraw) && (
        <div className="trade-offer-actions">
          {canAnswer && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void accept()}
              >
                {/* The ellipsis is the standard promise that a further step
                    follows — this button settles a collection either way, and
                    it must not be ambiguous which of the two it is doing. */}
                {busy ? 'Working…' : needsChoice ? 'Accept…' : 'Accept'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void run(() => declineTrade(offer.id), 'Failed to decline.')}
              >
                Decline
              </button>
              {onCounter && (
                <button
                  type="button"
                  className="btn-link trade-offer-counter"
                  disabled={busy}
                  onClick={() => onCounter(offer)}
                >
                  Counter
                </button>
              )}
            </>
          )}
          {canWithdraw && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void run(() => withdrawTrade(offer.id), 'Failed to withdraw.')}
            >
              {busy ? 'Working…' : 'Withdraw'}
            </button>
          )}
        </div>
      )}

      {preview && (
        // `source="search"` is the established shape for cards the viewer does
        // not own a row for — no binder, no page, no section (see
        // InlineCardSearch). An offer's cards are exactly that: the ask side
        // isn't owned at all, and the give side is about to stop being.
        <CardPreview
          source="search"
          cards={preview.cards}
          index={preview.index}
          binderName=""
          sectionLabels={[]}
          pageNumbers={[]}
          totalPages={0}
          onIndexChange={(i) => setPreview((p) => (p ? { ...p, index: i } : p))}
          onClose={() => setPreview(null)}
        />
      )}

      {choosing && (
        <TradeAcceptDialog
          counterpartyName={who}
          choices={choosing}
          busy={busy}
          onCancel={() => setChoosing(null)}
          onConfirm={(resolved) => void commit(resolved)}
        />
      )}
    </article>
  );
}

/**
 * What a settled trade leaves you to do.
 *
 * The cards are already in the collection — the useful remaining fact is which
 * binder and page each one goes in, which is the difference between "your data
 * is updated" and "here is what to do with the pile in your hand". Binder
 * routing placed them at settlement; this reads that back.
 *
 * Falls back to the plain confirmation whenever routing has no answer — no
 * binders defined, or every incoming card landed uncategorized. Saying nothing
 * would leave the row with no settled state at all.
 */
function SettledNote({
  cards,
  locations,
}: {
  cards: TradeCard[];
  locations: Map<string, CardLocation> | null;
}) {
  const filed = locations
    ? cards
        .map((card) => ({ card, where: card.oracleId ? locations.get(card.oracleId) : undefined }))
        .filter((row): row is { card: TradeCard; where: CardLocation } => row.where !== undefined)
    : [];

  if (filed.length === 0) {
    return (
      <p className="trade-offer-settled" role="status">
        Settled — your collection is up to date.
      </p>
    );
  }

  // A trade is usually a handful of cards, but the wire shape allows 40 lines
  // a side — named in full that is a paragraph, not a note.
  const NAMED = 3;
  const shown = filed.slice(0, NAMED);
  const rest = filed.length - shown.length;

  return (
    <p className="trade-offer-settled" role="status">
      Settled — file{' '}
      {shown.map(({ card, where }, i) => (
        <span key={card.oracleId || card.name}>
          {i > 0 && ', '}
          <strong className="trade-offer-filed-card">{card.name}</strong> in {where.binderName} p.
          {where.pageNum}
        </span>
      ))}
      {rest > 0 && `, and ${rest} more`}.
    </p>
  );
}

/**
 * How old this offer is.
 *
 * An offer carried no time at all, so one sent an hour ago and one sent six
 * weeks ago read identically — on a page whose whole premise is a queue that
 * decays. Age is the difference between "they're waiting on me" and "this is
 * stale, decline it".
 *
 * A still-open offer is dated from when it was SENT (how long someone has been
 * waiting); a resolved one from when it was ANSWERED (`resolvedAt`, falling
 * back to `updatedAt` for rows written before that column existed) — "declined
 * 3 weeks ago" is the fact, not when the proposal happened to start.
 */
function TradeOfferAge({ offer }: { offer: TradeOffer }) {
  const open = offer.status === 'proposed';
  const stamp = open ? offer.createdAt : (offer.resolvedAt ?? offer.updatedAt);
  if (!stamp) return null;
  return (
    <time
      className="trade-offer-age"
      dateTime={new Date(stamp).toISOString()}
      // The exact moment on hover/long-press — the relative form is the
      // scannable one, but "which Thursday" is sometimes the actual question.
      title={new Date(stamp).toLocaleString()}
    >
      {formatRelativeTime(stamp)}
    </time>
  );
}

/**
 * What one side of an offer is worth.
 *
 * A side whose copies are pinned down (`scryfallId` + `finish`) is priced
 * EXACTLY from the device-local price cache — and that keeps working after the
 * cards have left the collection, because the cache is keyed by printing, not
 * by ownership. A side still oracle-level (the ask, before it's accepted) has
 * no printing to price, so it falls back to the cheapest-printing floor and is
 * labelled "from". Never renders a bare 0 for "unknown": the whole point of
 * putting a number here is that it can be trusted.
 */
function useSideValue(cards: TradeCard[]): string {
  const { exact, needFloor } = useMemo(() => splitSideValue(cards), [cards]);
  const names = useMemo(() => needFloor.map((c) => c.name), [needFloor]);
  const { prices: floors, pending } = useFloorPrices(names);

  if (names.length === 0) return formatMoney(exact);
  if (pending) return '…';

  const floor = needFloor.reduce((sum, c) => sum + (floors.get(c.name) ?? 0) * c.quantity, 0);
  const anyUnknown = names.some((n) => (floors.get(n) ?? null) === null);
  // "+?" when something could not be priced at all — better an admitted gap
  // than a total that quietly omits a card.
  return `from ${formatMoney(exact + floor)}${anyUnknown ? ' +?' : ''}`;
}

function TradeOfferSide({
  label,
  cards,
  onInspect,
}: {
  label: string;
  cards: TradeCard[];
  onInspect: (card: TradeCard) => void;
}) {
  const headingId = useId();
  const value = useSideValue(cards);
  return (
    <div className="trade-offer-side">
      {/* headingId stays on the label text alone — the value must not leak into
          the card list's accessible name ("$40.00 You give"). */}
      <p className="trade-offer-side-label">
        <span id={headingId}>{label}</span>
        <span className="trade-offer-side-value">{value}</span>
      </p>
      {cards.length === 0 ? (
        <p className="trade-offer-side-nothing">Nothing</p>
      ) : (
        <ul className="trade-offer-side-cards" aria-labelledby={headingId}>
          {cards.map((card) => (
            <li key={card.oracleId || card.name}>
              {/* A chip is a card, and every other card in the app opens the
                  preview carousel when you tap it. This was the one that
                  didn't — you could read a name and a 20px thumbnail and had
                  no way to actually LOOK at what you were being offered. */}
              <button
                type="button"
                className="trade-offer-chip"
                onClick={() => onInspect(card)}
                aria-label={`Preview ${card.name}`}
              >
                <OfferChipThumb name={card.name} />
                <span className="trade-offer-chip-name" title={card.name}>
                  {card.name}
                  {card.quantity > 1 && (
                    <span className="trade-offer-chip-qty"> ×{card.quantity}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OfferChipThumb({ name }: { name: string }) {
  const thumb = useCardThumb(name, 'small');
  return thumb ? (
    <img
      className="trade-offer-chip-thumb"
      src={thumb}
      alt=""
      aria-hidden
      loading="lazy"
      draggable={false}
    />
  ) : (
    <span className="trade-offer-chip-thumb is-placeholder" aria-hidden />
  );
}
