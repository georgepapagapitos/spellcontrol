import './TradeOfferList.css';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { UserAvatar } from '../UserAvatar';
import { useCardThumb } from '../../lib/card-thumbs';
import { formatMoney } from '../../lib/format-money';
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
import { groupOwnedForTrade, toTradeCard } from '../../lib/trade-picker';
import { settleTrade } from '../../lib/use-trade-settlement';

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
}: {
  offer: TradeOffer;
  onChanged: () => void;
  onCounter?: (offer: TradeOffer) => void;
  linkCounterparty?: boolean;
}) {
  const cards = useCollectionStore((s) => s.cards);
  const [busy, setBusy] = useState(false);
  const headingId = useId();

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
  async function accept() {
    const owned = groupOwnedForTrade(cards);
    const byKey = new Map(owned.map((l) => [l.oracleId || `name:${l.name.toLowerCase()}`, l]));
    const resolved: TradeCard[] = [];
    const missing: string[] = [];

    for (const asked of offer.give) {
      const line = byKey.get(asked.oracleId || `name:${asked.name.toLowerCase()}`);
      if (!line || line.copies.length < asked.quantity) {
        missing.push(asked.name);
        continue;
      }
      resolved.push(toTradeCard(line, asked.quantity));
    }

    if (missing.length > 0) {
      toast.show({
        message: `You no longer have ${missing.join(', ')} to give. Decline and counter instead.`,
        tone: 'warn',
      });
      return;
    }

    await run(async () => {
      const updated = await acceptTrade(offer.id, resolved);
      // Settle straight away: they just clicked accept, so the intent is
      // unambiguous and waiting for the background runner would leave their
      // collection visibly stale.
      await settleTrade(updated);
    }, 'Failed to accept the trade.');
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
        <span
          className={`trade-offer-status is-${offer.status}`}
          data-testid={`trade-status-${offer.id}`}
        >
          {STATUS_LABEL[offer.status]}
        </span>
      </header>

      <div className="trade-offer-sides">
        <TradeOfferSide label="You give" cards={offer.give} />
        <ArrowRight className="trade-offer-arrow" width={18} height={18} aria-label="for" />
        <TradeOfferSide label="You get" cards={offer.receive} />
      </div>

      {offer.note && <p className="trade-offer-note">“{offer.note}”</p>}

      {showSettling && (
        <p className="trade-offer-settling" role="status">
          Adding to your collection…
        </p>
      )}
      {offer.status === 'accepted' && offer.settled && (
        <p className="trade-offer-settled" role="status">
          Settled — your collection is up to date.
        </p>
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
                {busy ? 'Working…' : 'Accept'}
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
    </article>
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

function TradeOfferSide({ label, cards }: { label: string; cards: TradeCard[] }) {
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
            <li key={card.oracleId || card.name} className="trade-offer-chip">
              <OfferChipThumb name={card.name} />
              <span className="trade-offer-chip-name" title={card.name}>
                {card.name}
                {card.quantity > 1 && (
                  <span className="trade-offer-chip-qty"> ×{card.quantity}</span>
                )}
              </span>
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
