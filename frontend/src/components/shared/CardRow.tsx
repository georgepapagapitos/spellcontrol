import type { ComponentProps, ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { Condition, EnrichedCard } from '../../types';
import type { AllocationInfo } from '../../lib/allocations';
import { FoilBadge } from '../FoilBadge';
import { DeckBadge } from '../DeckBadge';
import { BinderBadge } from '../BinderBadge';
import { RarityBadge } from './RarityBadge';
import { ManaCost } from '../ManaCost';
import { TypeIcon } from './ManaSymbol';
import { CONDITION_OPTIONS, LANGUAGE_OPTIONS } from '../PrintingPicker';
import { getCardType } from '../../lib/card-types';
import { getColorKey, COLOR_INFO } from '../../lib/colors';
import { formatMoney } from '../../lib/format-money';

/** 'damaged' abbreviates to DMG for the row chip; the rest are already short. */
export function conditionShort(condition: Condition): string {
  return condition === 'damaged' ? 'DMG' : condition.toUpperCase();
}

/**
 * Full condition word (e.g. "Lightly Played") — read off the same
 * `CONDITION_OPTIONS` list the add-time picker uses, so a chip's tooltip/
 * aria-label can never drift from the option a user actually picked.
 */
export function conditionLabel(condition: Condition): string {
  // Options are plain-string labels in practice; SelectOption widens to
  // ReactNode for menu items generally, but title/aria-label need a string.
  return (CONDITION_OPTIONS.find((o) => o.value === condition)?.label as string) ?? condition;
}

/**
 * Quiet per-copy condition chip — the short abbreviation with the full word
 * as the accessible label/tooltip. Exported so the Symbol Key can render
 * this exact chip (T36 pattern: the Key can't drift from what it explains).
 */
export function ConditionChip({ condition }: { condition: Condition }) {
  const label = conditionLabel(condition);
  return (
    <span className="card-list-condition" title={label} aria-label={label}>
      {conditionShort(condition)}
    </span>
  );
}

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
  /**
   * Unallocated copies of this card beyond the keep floor — only passed
   * while the "Tradeable surplus" filter is active. Undefined/0 renders
   * nothing (no badge clutter outside that filter state).
   */
  surplusCount?: number;
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
  /** Extra chip after the name badges — e.g. Lists' "Owned" indicator. */
  ownedBadge?: ReactNode;
}

/**
 * The single card row used by the collection table and the binder list (and a
 * candidate for shared views). Owns the `.collection-list-*` visual contract —
 * thumb, name + badges, the primary-type glyph + accessible rarity chip + set
 * code "printing-identity floor", the mana-cost column, qty and price — so the two
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
  surplusCount,
  pageNum,
  setName,
  isLastRow = false,
  selectMode = false,
  selected = false,
  pricePending = false,
  ownedBadge,
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
          {card.foil && <FoilBadge card={card} />}
          <DeckBadge allocations={allocations} />
          <BinderBadge binders={binders ?? []} />
          {ownedBadge}
        </div>
        <div className="collection-list-meta">
          <TypeIcon type={type} label={typeLabel} className="card-list-type" />
          <RarityBadge rarity={card.rarity} />
          <span className="card-list-set-code" title={setName ?? card.setName}>
            {card.setCode.toUpperCase()}
          </span>
          <span className="card-list-cn">#{card.collectorNumber}</span>
          {pageNum !== undefined && pageNum > 0 && (
            <span className="card-list-page" title={`Page ${pageNum}`}>
              p.{pageNum}
            </span>
          )}
          {/* Deviations only — NM is the unmarked norm (imports stamp nm on
              nearly every copy; an always-on chip is noise, not signal), the
              same way English never renders a language chip. */}
          {card.condition && card.condition !== 'nm' && (
            <ConditionChip condition={card.condition} />
          )}
          {card.language && card.language !== 'en' && (
            <span className="card-list-language">
              {LANGUAGE_OPTIONS.find((o) => o.value === card.language)?.label ??
                card.language.toUpperCase()}
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
        {!!surplusCount && (
          <span
            className="collection-list-surplus"
            title={`${surplusCount} unallocated ${surplusCount === 1 ? 'copy' : 'copies'} beyond your kept copy`}
          >
            {surplusCount} free
          </span>
        )}
        <div className="collection-list-qty" aria-hidden={qty <= 1}>
          {qty > 1 ? `×${qty}` : ''}
        </div>
        <div
          className="collection-list-price"
          title={pricePending ? 'Updating price…' : 'Purchase cost recorded at import'}
        >
          {pricePending ? (
            <span className="collection-list-price-pending" aria-label="Price updating">
              —
            </span>
          ) : (
            // Shared projections are server-stamped USD — pin the symbol.
            formatMoney(card.purchasePrice * qty, { currency: 'USD' })
          )}
        </div>
      </div>
    </div>
  );
}
