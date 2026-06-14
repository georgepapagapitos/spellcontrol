import type { ComponentProps, ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { EnrichedCard } from '../../types';
import type { AllocationInfo } from '../../lib/allocations';
import { FoilBadge } from '../FoilBadge';
import { DeckBadge } from '../DeckBadge';
import { BinderBadge } from '../BinderBadge';
import { SetSymbol } from './SetSymbol';
import { setSymbolTitle } from '../../lib/set-symbols';
import { ManaCost } from '../ManaCost';
import { TypeIcon } from './ManaSymbol';
import { getCardType } from '../../lib/card-types';
import { getColorKey, COLOR_INFO } from '../../lib/colors';
import { formatMoney } from '../../lib/format-money';

interface CardRowProps {
  card: EnrichedCard;
  /** Copies this row stands for; `×qty` shows only when >1. */
  qty: number;
  /** Deck allocations for the DeckBadge (caller resolves grouped vs single). */
  allocations: AllocationInfo[];
  /** The per-row action menu (`CardRowMenu`) — props differ per surface. */
  menu: ReactNode;
  /** Click / Enter / Space on the row (preview, or toggle in select mode). */
  onActivate: () => void;
  /** Binders covering this card — collection only; omit in binder views (context implicit). */
  binders?: ComponentProps<typeof BinderBadge>['binders'];
  /** Physical binder page chip (binder views only). */
  pageNum?: number;
  /** Set name for the symbol tooltip; defaults to `card.setName`. */
  setName?: string;
  isLastRow?: boolean;
  /** Collection bulk-select affordances. */
  selectMode?: boolean;
  selected?: boolean;
  /** While a price refresh is in flight and this card has no price yet, the
   *  price slot shows a same-size shimmer instead of a misleading $0. */
  pricePending?: boolean;
}

/**
 * The single card row used by the collection table and the binder list (and a
 * candidate for shared views). Owns the `.collection-list-*` visual contract —
 * thumb, name + badges, the rarity-tinted set symbol + primary-type glyph
 * "printing-identity floor", the mana-cost column, qty and price — so the two
 * surfaces stay consistent by construction. Interaction (preview vs. select),
 * virtualization, and the action menu stay with the caller; this is purely
 * presentational. See STYLE_GUIDE "Card row information hierarchy".
 */
export function CardRow({
  card,
  qty,
  allocations,
  menu,
  onActivate,
  binders,
  pageNum,
  setName,
  isLastRow = false,
  selectMode = false,
  selected = false,
  pricePending = false,
}: CardRowProps) {
  const colorKey = getColorKey(card);
  const type = getCardType({ typeLine: card.typeLine } as Parameters<typeof getCardType>[0]);
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  return (
    <div
      className={`collection-list-row${isLastRow ? ' is-last-row' : ''}${
        selectMode ? ' is-selectable' : ''
      }${selected ? ' is-selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={selectMode ? selected : undefined}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
    >
      {selectMode && (
        <span className="collection-list-check" data-checked={selected} aria-hidden>
          {selected && <Check width={13} height={13} strokeWidth={3} />}
        </span>
      )}
      {card.imageSmall ? (
        <img src={card.imageSmall} alt="" loading="lazy" className="collection-list-thumb" />
      ) : (
        <div
          className="collection-list-thumb collection-list-thumb-placeholder"
          style={{ background: COLOR_INFO[colorKey]?.pip }}
          aria-hidden
        />
      )}
      <div className="collection-list-main">
        <div className="collection-list-name">
          {card.name}
          {card.foil && <FoilBadge card={card} showLabel />}
          <DeckBadge allocations={allocations} />
          <BinderBadge binders={binders ?? []} />
        </div>
        <div className="collection-list-meta">
          <TypeIcon type={type} label={typeLabel} className="card-list-type" />
          <SetSymbol
            setCode={card.setCode}
            rarity={card.rarity}
            title={setSymbolTitle({
              setCode: card.setCode,
              setName: setName ?? card.setName,
              collectorNumber: card.collectorNumber,
              rarity: card.rarity,
            })}
          />
          <span className="card-list-set-code">{card.setCode.toUpperCase()}</span>
          <span className="card-list-cn">#{card.collectorNumber}</span>
          {pageNum !== undefined && pageNum > 0 && (
            <span className="card-list-page" title={`Page ${pageNum}`}>
              p.{pageNum}
            </span>
          )}
        </div>
      </div>
      {card.manaCost ? (
        <ManaCost cost={card.manaCost} className="mana-cost-row" />
      ) : (
        <span className="mana-cost-row" aria-hidden />
      )}
      <div className="collection-list-right">
        {menu}
        {qty > 1 && <div className="collection-list-qty">×{qty}</div>}
        <div
          className="collection-list-price"
          title={pricePending ? 'Updating price…' : 'Purchase cost recorded at import'}
        >
          {pricePending ? (
            <>
              <span className="collection-list-price-skeleton" aria-hidden="true" />
              <span className="visually-hidden">Updating price</span>
            </>
          ) : (
            formatMoney(card.purchasePrice * qty)
          )}
        </div>
      </div>
    </div>
  );
}
