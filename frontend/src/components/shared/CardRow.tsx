import type { ComponentProps, KeyboardEvent, ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { Condition, EnrichedCard } from '../../types';
import type { AllocationInfo } from '../../lib/allocations';
import { FoilBadge } from '../FoilBadge';
import { DeckBadge } from '../DeckBadge';
import { BinderBadge } from '../BinderBadge';
import { ProxyBadge } from './ProxyBadge';
import { PriceOverrideBadge } from './PriceOverrideBadge';
import { RarityBadge } from './RarityBadge';
import { ManaCost } from '../ManaCost';
import { TypeIcon } from './ManaSymbol';
import { CONDITION_OPTIONS, LANGUAGE_OPTIONS } from '../PrintingPicker';
import { getCardType } from '../../lib/card-types';
import { getColorKey, COLOR_INFO } from '../../lib/colors';
import { formatMoney } from '../../lib/format-money';
import { useCardThumb } from '../../lib/card-thumbs';

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
  /**
   * What the price slot's number means on this surface. Owned copies carry the
   * cost recorded at import (the default); a list's rows are unowned printing
   * references priced from Scryfall, so that surface says so instead.
   */
  priceTitle?: string;
  /** Extra chip after the name badges — e.g. Lists' "Owned" indicator. */
  ownedBadge?: ReactNode;
  /** Lists' inline target-price editor (E163) — undefined everywhere else. */
  targetPriceSlot?: ReactNode;
  /**
   * Suppress the price cell entirely (amount + override badge + the pending
   * shimmer). Sibling of `CardPreview`'s `hidePrice` and `SharedCardTile`'s
   * `hideValue`: a friend's collection withholds price by contract, and its
   * projection carries `purchasePrice: 0`, which would render as `$0.00`.
   */
  hidePrice?: boolean;
  /**
   * Say nothing about how many copies this row stands for. Same reason as
   * `CardGridCell`'s `hideQty` — a count is the privacy line on a friend
   * surface, and the price cell multiplies BY qty, so the two travel together.
   */
  hideQty?: boolean;
  /**
   * Table density (collection compact view at tablet+): one grid cell per
   * column — qty · name · set · # · condition · language · binder · notes ·
   * mana · price · total · menu — sized by the shared `--collection-table-cols`
   * template so every row lines up under `CardListTable`'s sticky header.
   * Price is the unit price here and Total is price × qty (the list/compact
   * rows show only the total). Condition and language show for every copy,
   * NM and English included: the column label carries the meaning, so the
   * "deviations only" rule of the flow rows doesn't apply.
   */
  table?: boolean;
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
  priceTitle = 'Purchase cost recorded at import',
  ownedBadge,
  targetPriceSlot,
  hidePrice = false,
  hideQty = false,
  table = false,
}: CardRowProps) {
  const colorKey = getColorKey(card);
  // Name-keyed CDN thumb is only a fallback, exactly as in `CardGridCell`: a
  // shared/friend projection can arrive with no image at all, and a colour
  // block where the grid shows real art reads as a broken row. No-ops (no
  // fetch) whenever the row already carries its own art.
  const nameThumb = useCardThumb(card.imageSmall ? undefined : card.name, 'small');
  const thumb = card.imageSmall ?? nameThumb;
  const type = getCardType({ typeLine: card.typeLine } as Parameters<typeof getCardType>[0]);
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  const rowClass = `collection-list-row${isLastRow ? ' is-last-row' : ''}${
    selectMode ? ' is-selectable' : ''
  }${selected ? ' is-selected' : ''}`;
  const rowInteraction = {
    role: 'button' as const,
    tabIndex: 0,
    'aria-pressed': selectMode ? selected : undefined,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
  const check = selectMode && (
    <span className="collection-list-check" data-checked={selected} aria-hidden>
      {selected && <Check width={13} height={13} strokeWidth={3} />}
    </span>
  );

  if (table) {
    const langLabel = card.language
      ? ((LANGUAGE_OPTIONS.find((o) => o.value === card.language)?.label as string) ??
        card.language.toUpperCase())
      : undefined;
    const money = (amount: number) =>
      pricePending ? (
        <span className="collection-list-price-pending" aria-label="Price updating">
          —
        </span>
      ) : (
        formatMoney(amount, { currency: 'USD' })
      );
    return (
      <div className={`${rowClass} collection-table-row`} {...rowInteraction}>
        {check}
        <div className="collection-list-qty" data-col="qty">
          {hideQty ? '' : qty}
        </div>
        <div className="collection-table-name" data-col="name">
          <TypeIcon type={type} label={typeLabel} className="card-list-type" />
          <RarityBadge rarity={card.rarity} />
          <span className="collection-list-name">
            {card.name}
            {card.foil && <FoilBadge card={card} />}
            <ProxyBadge card={card} />
            <DeckBadge allocations={allocations} />
            {ownedBadge}
          </span>
        </div>
        <div data-col="set">
          {card.setCode && (
            <span className="card-list-set-code" title={setName ?? card.setName}>
              {card.setCode.toUpperCase()}
            </span>
          )}
        </div>
        <div className="card-list-cn" data-col="cn">
          {card.collectorNumber}
        </div>
        <div data-col="cond">{card.condition && <ConditionChip condition={card.condition} />}</div>
        <div className="card-list-language" data-col="lang" title={langLabel}>
          {card.language?.toUpperCase()}
        </div>
        <div className="collection-table-binder" data-col="binder">
          <BinderBadge binders={binders ?? []} />
          {!!surplusCount && (
            <span
              className="collection-list-surplus"
              title={`${surplusCount} unallocated ${surplusCount === 1 ? 'copy' : 'copies'} beyond your kept copy`}
            >
              {surplusCount} free
            </span>
          )}
        </div>
        <div className="collection-table-notes" data-col="notes" title={card.notes}>
          {card.notes}
        </div>
        <div data-col="mana">
          {card.manaCost && <ManaCost cost={card.manaCost} className="mana-cost-row" />}
        </div>
        <div
          className="collection-list-price"
          data-col="price"
          title={pricePending ? 'Updating price…' : priceTitle}
        >
          {!hidePrice && (
            <>
              {money(card.purchasePrice)}
              <PriceOverrideBadge card={card} />
            </>
          )}
        </div>
        <div className="collection-list-price" data-col="total">
          {!hidePrice && !hideQty && money(card.purchasePrice * qty)}
        </div>
        <div className="collection-table-menu" data-col="menu">
          {menu}
        </div>
      </div>
    );
  }

  return (
    <div className={rowClass} {...rowInteraction}>
      {check}
      {thumb ? (
        <img src={thumb} alt="" loading="lazy" className="collection-list-thumb" />
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
          <ProxyBadge card={card} />
          <DeckBadge allocations={allocations} />
          <BinderBadge binders={binders ?? []} />
          {ownedBadge}
        </div>
        <div className="collection-list-meta">
          <TypeIcon type={type} label={typeLabel} className="card-list-type" />
          <RarityBadge rarity={card.rarity} />
          {/* An oracle-level projection (a friend's collection) carries no
              printing identity; rendering these anyway gives an empty set chip
              and a bare "#". */}
          {card.setCode && (
            <span className="card-list-set-code" title={setName ?? card.setName}>
              {card.setCode.toUpperCase()}
            </span>
          )}
          {card.collectorNumber && <span className="card-list-cn">#{card.collectorNumber}</span>}
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
        {!hideQty && (
          <div className="collection-list-qty" aria-hidden={qty <= 1}>
            {qty > 1 ? `×${qty}` : ''}
          </div>
        )}
        {!hidePrice && (
          <div
            className="collection-list-price"
            title={pricePending ? 'Updating price…' : priceTitle}
          >
            {pricePending ? (
              <span className="collection-list-price-pending" aria-label="Price updating">
                —
              </span>
            ) : (
              <>
                {/* Shared projections are server-stamped USD — pin the symbol. */}
                {formatMoney(card.purchasePrice * qty, { currency: 'USD' })}
                <PriceOverrideBadge card={card} />
              </>
            )}
          </div>
        )}
        {targetPriceSlot}
      </div>
    </div>
  );
}
