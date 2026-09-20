import { useMemo } from 'react';
import { ImageOff, Pin } from 'lucide-react';
import './DeckCardInspector.css';
import { ManaCost } from '../ManaCost';
import { BinderBadge, type BinderInfo } from '../BinderBadge';
import { formatMoney } from '../../lib/format-money';
import { ROLE_TITLES } from '../../lib/role-badges';
import type { CurrencyCode, Row } from './deck-display-rows';
import { allocationSummary, cardFilterRoles, frontFaceMana } from './deck-display-rows';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';

export interface DeckCardInspectorCard {
  row: Row;
  imageUrl?: string;
  /** Binders covering this row's allocated copies. Empty → no badge. */
  binders: BinderInfo[];
  /** Why the generator picked this card, when it recorded a reason. */
  synergyReasons?: string[];
}

export interface DeckCardInspectorActions {
  onMoveToSideboard?: (slotIds: string[]) => void;
  onMoveToConsidering?: (slotIds: string[]) => void;
  onRemoveCard?: (slotId: string) => void;
}

/**
 * The card inspector (2026-09-20) — a sticky column beside the deck body on a
 * wide, hover-capable screen, shared by all three view modes. It shows the card
 * the pointer last rested on (the commander until then), and it is the one
 * place in the deck view where a card can actually be READ: art, oracle text,
 * whether you own it and which binder it's in, what it does for the deck, and
 * the handful of moves you make most.
 *
 * It replaces the 2026-09-19 pinned rail, which showed name, mana, type line
 * and price — three of which the row already carried, so it cost a permanent
 * column and paid back almost nothing. The rule that came out of that: a
 * persistent panel earns its width only by showing what the row cannot.
 *
 * The row's ⋮ kebab remains the full 13-action menu. The three actions here are
 * the frequent ones; reproducing the whole menu in a 300px column is the
 * clutter this panel exists to avoid.
 *
 * Presentational apart from the pin toggle: the inspector never owns hover
 * state (that stays with `useDeckHoverPeek`, so the touch and narrow paths are
 * untouched). `pinned` freezes whatever is showing so that reading a card can't
 * be interrupted by the pointer crossing another row.
 *
 * Deliberately NOT an `aria-live` region. It follows focus as well as hover, so
 * announcing it would re-read a card's whole rules text on every Tab, over the
 * row the reader just landed on. It's a labelled landmark instead: reachable on
 * purpose, silent when it changes underneath you.
 */
export function DeckCardInspector({
  card,
  currency,
  pinned,
  onTogglePin,
  onOpen,
  actions,
}: {
  card: DeckCardInspectorCard | null;
  currency: CurrencyCode;
  pinned: boolean;
  onTogglePin: () => void;
  onOpen?: (name: string) => void;
  actions?: DeckCardInspectorActions;
}) {
  const roles = useMemo(
    () => (card ? cardFilterRoles(card.row.card).map((r) => ROLE_TITLES[r]) : []),
    [card]
  );

  if (!card) {
    return (
      <aside className="deck-card-inspector" aria-label="Card inspector">
        <div className="deck-card-inspector-empty">
          <ImageOff width={22} height={22} strokeWidth={1.75} aria-hidden />
          <span>Hover a card to see it here</span>
        </div>
      </aside>
    );
  }

  const { row } = card;
  const mana = frontFaceMana(row.card);
  const typeLine = getFrontFaceTypeLine(row.card);
  const oracle = row.card.oracle_text ?? row.card.card_faces?.[0]?.oracle_text ?? '';
  const slotIds = row.slotIds;

  return (
    <aside className="deck-card-inspector" aria-label="Card inspector">
      <div className="deck-card-inspector-art-wrap">
        <button
          type="button"
          className="deck-card-inspector-art"
          aria-label={`Open ${row.name}`}
          onClick={() => onOpen?.(row.name)}
        >
          {card.imageUrl ? (
            <img src={card.imageUrl} alt="" draggable={false} />
          ) : (
            <div className="deck-card-inspector-missing" aria-hidden>
              <ImageOff width={22} height={22} strokeWidth={1.75} />
              <span>No art</span>
            </div>
          )}
        </button>
        <button
          type="button"
          className={`deck-card-inspector-pin${pinned ? ' is-pinned' : ''}`}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${row.name}` : `Pin ${row.name}`}
          title={pinned ? 'Unpin' : 'Pin this card'}
          onClick={onTogglePin}
        >
          <Pin width={14} height={14} strokeWidth={2} aria-hidden />
        </button>
      </div>

      <div className="deck-card-inspector-head">
        <span className="deck-card-inspector-name">{row.name}</span>
        {mana && <ManaCost cost={mana} className="deck-card-inspector-mana" />}
      </div>
      {typeLine && <p className="deck-card-inspector-type">{typeLine}</p>}
      {oracle && <p className="deck-card-inspector-oracle">{oracle}</p>}

      <div className="deck-card-inspector-owned">
        <span className="deck-card-inspector-owned-text">{allocationSummary(row)}</span>
        <BinderBadge binders={card.binders} />
      </div>

      {(roles.length > 0 || (card.synergyReasons?.length ?? 0) > 0) && (
        <ul className="deck-card-inspector-chips">
          {roles.map((label) => (
            <li key={label} className="deck-card-inspector-chip">
              {label}
            </li>
          ))}
          {card.synergyReasons?.map((reason) => (
            <li key={reason} className="deck-card-inspector-chip is-synergy">
              {reason}
            </li>
          ))}
        </ul>
      )}

      {row.price > 0 && (
        <p className="deck-card-inspector-price">
          <span>{formatMoney(row.price, { currency })}</span>
          {row.qty > 1 && (
            <span className="deck-card-inspector-unit">
              {row.qty} × {formatMoney(row.price / row.qty, { currency })}
            </span>
          )}
        </p>
      )}

      {slotIds.length > 0 &&
        (actions?.onMoveToSideboard || actions?.onMoveToConsidering || actions?.onRemoveCard) && (
          <div className="deck-card-inspector-actions">
            {actions.onMoveToSideboard && (
              <button
                type="button"
                className="btn deck-card-inspector-action"
                onClick={() => actions.onMoveToSideboard?.(slotIds)}
              >
                To sideboard
              </button>
            )}
            {actions.onMoveToConsidering && (
              <button
                type="button"
                className="btn deck-card-inspector-action"
                onClick={() => actions.onMoveToConsidering?.(slotIds)}
              >
                To considering
              </button>
            )}
            {actions.onRemoveCard && (
              <button
                type="button"
                className="btn deck-card-inspector-action deck-card-inspector-remove"
                onClick={() => actions.onRemoveCard?.(slotIds[0])}
              >
                Remove one
              </button>
            )}
          </div>
        )}
    </aside>
  );
}
