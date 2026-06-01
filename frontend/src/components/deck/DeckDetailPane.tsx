import { useEffect, useState } from 'react';
import {
  ExternalLink,
  Layers,
  Minus,
  Notebook,
  PanelRightClose,
  Pencil,
  Plus,
  RefreshCw,
  Scissors,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../../types';
import type { LegalityIssue } from '../../lib/deck-validation';
import type { AllocationInfo } from '../../lib/allocations';
import type { AllocationStatus } from '../../lib/allocations';
import { getSetMap, type SetMap } from '../../lib/api';
import type { BinderInfo } from '../BinderBadge';
import { CardImageFrame } from '../CardImageFrame';
import { DeckCardPreviewMeta } from './DeckCardPreviewMeta';
import './DeckDetailPane.css';

interface Props {
  /** The pinned card, enriched for image/foil/rarity/price/set/links. Null →
   *  empty state (nothing selected yet). */
  card: EnrichedCard | null;
  /** Same card as `ScryfallCard` for the deck-context block's role decode. */
  metaCard: ScryfallCard | null;
  isPartner: boolean;
  isCommander: boolean;
  status?: AllocationStatus;
  synergies?: string[];
  inclusionPct?: number;
  legality?: LegalityIssue;
  /** Other binders any copy of this card is filed in (current deck excluded by
   *  the caller is N/A here — binders aren't decks). */
  binders: BinderInfo[];
  /** Other decks holding a copy (the current deck is filtered out upstream). */
  otherDecks: AllocationInfo[];
  /** Copies of this card in the deck (drives the qty stepper). */
  qty: number;
  /** Edit-in-place callbacks — each acts on the deck without closing the pane,
   *  so you stay on the card you're tuning. Omitted when the host is read-only
   *  or the action doesn't apply. Qty/cut are additionally suppressed by the
   *  pane for the commander/partner (singletons managed elsewhere). */
  onSetQty?: (qty: number) => void;
  onCut?: () => void;
  onEditPrinting?: () => void;
  /** Collapse the whole pane (persisted by the caller). */
  onCollapse: () => void;
  /** Clear the current selection back to the empty state. */
  onClear: () => void;
}

/**
 * Desktop-only persistent card-detail pane for the deck editor: a pinned column
 * beside the deck list that shows the selected card big, with its full deck
 * context (partner/role/synergy/inclusion/legality), set, price, and links —
 * the same content the full-screen sheet shows, but always-on so you can scan
 * and inspect without an overlay covering the list you're tuning.
 *
 * Only mounted at ≥1024px (the caller gates it); tablet / phone / native keep
 * the tap→sheet flow + hover-peek untouched. The 3D image frame (foil + flip)
 * is the shared `CardImageFrame`, so the foil/holographic/flip behavior matches
 * the sheet with no duplication. Light-on-dark fixed surface to match the
 * reused `.card-preview-*` section styles (deliberately not theme-tokened).
 */
export function DeckDetailPane({
  card,
  metaCard,
  isPartner,
  isCommander,
  status,
  synergies,
  inclusionPct,
  legality,
  binders,
  otherDecks,
  qty,
  onSetQty,
  onCut,
  onEditPrinting,
  onCollapse,
  onClear,
}: Props) {
  // Set icons are shared across every pinned card; fetch once for the pane's
  // lifetime (the call is cached) rather than per selection.
  const [setMap, setSetMap] = useState<SetMap | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSetMap()
      .then((m) => {
        if (!cancelled) setSetMap(m);
      })
      .catch(() => {
        /* fall back to text-only set line */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside className="deck-detail-pane" aria-label="Card details">
      <div className="deck-detail-pane-header">
        <span className="deck-detail-pane-title">Card details</span>
        <button
          type="button"
          className="deck-detail-pane-collapse"
          onClick={onCollapse}
          aria-label="Hide card details"
          title="Hide card details"
        >
          <PanelRightClose width={18} height={18} strokeWidth={2} aria-hidden />
        </button>
      </div>
      {card && metaCard ? (
        // Key by the card so flip/load state resets cleanly when the pinned
        // selection changes — no effect-driven reset flash.
        <PaneCard
          key={card.scryfallId}
          card={card}
          metaCard={metaCard}
          isPartner={isPartner}
          isCommander={isCommander}
          status={status}
          synergies={synergies}
          inclusionPct={inclusionPct}
          legality={legality}
          binders={binders}
          otherDecks={otherDecks}
          qty={qty}
          setMap={setMap}
          onSetQty={onSetQty}
          onCut={onCut}
          onEditPrinting={onEditPrinting}
          onClear={onClear}
        />
      ) : (
        <div className="deck-detail-pane-empty">
          <p>
            Select a card to inspect it here — its synergy, legality, set, and price stay pinned
            while you scan the list.
          </p>
        </div>
      )}
    </aside>
  );
}

interface PaneCardProps {
  card: EnrichedCard;
  metaCard: ScryfallCard;
  isPartner: boolean;
  isCommander: boolean;
  status?: AllocationStatus;
  synergies?: string[];
  inclusionPct?: number;
  legality?: LegalityIssue;
  binders: BinderInfo[];
  otherDecks: AllocationInfo[];
  qty: number;
  setMap: SetMap | null;
  onSetQty?: (qty: number) => void;
  onCut?: () => void;
  onEditPrinting?: () => void;
  onClear: () => void;
}

function PaneCard({
  card,
  metaCard,
  isPartner,
  isCommander,
  status,
  synergies,
  inclusionPct,
  legality,
  binders,
  otherDecks,
  qty,
  setMap,
  onSetQty,
  onCut,
  onEditPrinting,
  onClear,
}: PaneCardProps) {
  const [flipped, setFlipped] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgErrored, setImgErrored] = useState(false);
  const setIcon = card.setCode ? setMap?.[card.setCode.toUpperCase()]?.iconSvgUri : undefined;
  const hasContext = binders.length > 0 || otherDecks.length > 0;
  // The commander/partner are singletons managed through their own controls —
  // a qty stepper or Cut here would be a footgun, so suppress them for those.
  const canQuantityEdit = !isCommander && !isPartner;
  const showQty = canQuantityEdit && !!onSetQty;
  const showCut = canQuantityEdit && !!onCut;
  const showEditRow = showQty || showCut || !!onEditPrinting;

  return (
    <div className="deck-detail-pane-card">
      <div className="deck-detail-pane-art">
        <CardImageFrame
          card={card}
          flipped={flipped}
          eager
          imgLoaded={imgLoaded}
          imgErrored={imgErrored}
          onImgLoad={() => setImgLoaded(true)}
          onImgError={() => setImgErrored(true)}
        />
      </div>

      <div className="deck-detail-pane-actions">
        {card.imageNormalBack && (
          <button
            type="button"
            className="card-preview-flip-btn"
            onClick={() => setFlipped((v) => !v)}
            aria-label={flipped ? 'Show front face' : 'Show back face'}
            title={flipped ? 'Show front face' : 'Show back face'}
          >
            <RefreshCw width={18} height={18} strokeWidth={2} aria-hidden />
            <span>Flip</span>
          </button>
        )}
        <button
          type="button"
          className="card-preview-flip-btn"
          onClick={onClear}
          aria-label="Clear selection"
          title="Clear selection"
        >
          <X width={18} height={18} strokeWidth={2} aria-hidden />
          <span>Clear</span>
        </button>
      </div>

      {showEditRow && (
        <div className="deck-detail-pane-edit">
          {showQty && (
            <div className="deck-detail-pane-qty" role="group" aria-label="Quantity in deck">
              <button
                type="button"
                className="deck-detail-pane-qty-btn"
                onClick={() => onSetQty?.(qty - 1)}
                disabled={qty <= 1}
                aria-label="Decrease quantity"
                title="Decrease quantity"
              >
                <Minus width={15} height={15} strokeWidth={2.4} aria-hidden />
              </button>
              <span className="deck-detail-pane-qty-value" aria-live="polite">
                {qty}
              </span>
              <button
                type="button"
                className="deck-detail-pane-qty-btn"
                onClick={() => onSetQty?.(qty + 1)}
                aria-label="Increase quantity"
                title="Increase quantity"
              >
                <Plus width={15} height={15} strokeWidth={2.4} aria-hidden />
              </button>
            </div>
          )}
          <div className="deck-detail-pane-edit-actions">
            {onEditPrinting && (
              <button
                type="button"
                className="deck-detail-pane-edit-btn"
                onClick={onEditPrinting}
                aria-label="Edit printing"
                title="Edit printing"
              >
                <Pencil width={15} height={15} strokeWidth={2} aria-hidden />
                <span>Printing</span>
              </button>
            )}
            {showCut && (
              <button
                type="button"
                className="deck-detail-pane-edit-btn deck-detail-pane-edit-btn--danger"
                onClick={onCut}
                aria-label={qty > 1 ? 'Remove one copy from the deck' : 'Cut from the deck'}
                title={qty > 1 ? 'Remove one copy' : 'Cut from deck'}
              >
                <Scissors width={15} height={15} strokeWidth={2} aria-hidden />
                <span>Cut</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="deck-detail-pane-body">
        <div className="card-preview-name">{card.name}</div>

        {hasContext && (
          <div className="card-preview-context">
            {binders.map((b, i) => (
              <span key={`b-${b.id}`}>
                {i > 0 && ' · '}
                <Link
                  to={`/collection/binders/${b.id}`}
                  className="card-preview-context-pill card-preview-context-pill--binder"
                  style={{ '--pill-color': b.color || 'var(--accent)' } as React.CSSProperties}
                  title={`Open binder ${b.name}`}
                >
                  <Notebook width={11} height={11} strokeWidth={2.2} aria-hidden />
                  <span>{b.name}</span>
                </Link>
              </span>
            ))}
            {binders.length > 0 && otherDecks.length > 0 && ' · '}
            {otherDecks.map((d, i) => (
              <span key={`d-${d.deckId}`}>
                {i > 0 && ' · '}
                <Link
                  to={`/decks/${d.deckId}`}
                  className="card-preview-context-pill card-preview-context-pill--deck"
                  style={{ '--pill-color': d.deckColor || 'var(--accent)' } as React.CSSProperties}
                  title={`Open deck ${d.deckName}`}
                >
                  <Layers width={11} height={11} strokeWidth={2.2} aria-hidden />
                  <span>{d.deckName}</span>
                </Link>
              </span>
            ))}
          </div>
        )}

        <DeckCardPreviewMeta
          card={metaCard}
          isPartner={isPartner}
          isCommander={isCommander}
          synergies={synergies}
          inclusionPct={inclusionPct}
          legality={legality}
          status={status}
        />

        <div className="card-preview-meta">
          <span className={`card-preview-rarity rarity-${(card.rarity || '').toLowerCase()}`}>
            {card.rarity}
          </span>
          {card.foil && <span className="card-preview-foil">foil</span>}
          {' · '}${card.purchasePrice.toFixed(2)}
        </div>

        {(card.setName || card.setCode) && (
          <div className="card-preview-set">
            {setIcon ? (
              <img src={setIcon} alt="" aria-hidden="true" className="card-preview-set-icon" />
            ) : null}
            <span>
              {card.setName || card.setCode}
              {card.setName && card.setCode ? (
                <span className="card-preview-set-code"> ({card.setCode.toUpperCase()})</span>
              ) : null}
            </span>
          </div>
        )}

        <div className="card-preview-links">
          <a
            href={`https://scryfall.com/card/${card.setCode.toLowerCase()}/${card.collectorNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            className="card-preview-ext-link"
          >
            Scryfall
            <ExternalLink
              width={12}
              height={12}
              strokeWidth={2.4}
              aria-hidden
              className="card-preview-ext-link-icon"
            />
          </a>
          <a
            href={`https://www.tcgplayer.com/search/magic/product?q=${encodeURIComponent(card.name)}&view=grid`}
            target="_blank"
            rel="noopener noreferrer"
            className="card-preview-ext-link"
          >
            TCGPlayer
            <ExternalLink
              width={12}
              height={12}
              strokeWidth={2.4}
              aria-hidden
              className="card-preview-ext-link-icon"
            />
          </a>
        </div>
      </div>
    </div>
  );
}
