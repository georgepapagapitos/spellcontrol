import './PrintingChoices.css';
import { Minus, Plus } from 'lucide-react';
import { DeckBadge } from '../DeckBadge';
import { BinderBadge } from '../BinderBadge';
import { useAllocations, type AllocationInfo } from '../../lib/allocations';
import type { BinderRef } from '../../lib/use-binder-by-copy';
import { useCardThumb } from '../../lib/card-thumbs';
import { formatMoney } from '../../lib/format-money';
import type { PrintingGroup } from '../../lib/trade-picker';

/** "LEA · #233 · foil · NM" — the identity of one printing, compactly.
 *  The single copy: both trade dialogs render the same rows, so a second
 *  spelling of this string is a way for them to disagree. */
export function describePrinting(p: PrintingGroup): string {
  return [
    p.setCode?.toUpperCase(),
    p.collectorNumber ? `#${p.collectorNumber}` : null,
    p.finish !== 'nonfoil' ? p.finish : null,
    p.condition,
  ]
    .filter(Boolean)
    .join(' · ');
}

interface Props {
  /** The card these printings belong to — used only for control labels. */
  cardName: string;
  /** Every printing owned, cheapest first (see `groupByPrinting`). */
  groups: PrintingGroup[];
  /** How many copies of this printing are currently in the trade. */
  countOf: (group: PrintingGroup) => number;
  /**
   * Set a printing's count. Omitted → a read-only receipt: the same rows, same
   * art, no steppers. That is the accept dialog's single-printing case, where
   * there is nothing to decide but seeing exactly what leaves is the point.
   */
  onSet?: (printingKey: string, next: number) => void;
  disabled?: boolean;
  /** Accessible name for the list. */
  label: string;
  /**
   * Which binder each copy sits in, from `useBinderByCopyId`. Passed in rather
   * than read here because it materializes the whole collection — the dialog
   * pays that once, not once per printing list.
   */
  binderByCopyId?: Map<string, BinderRef[]>;
}

/**
 * The "which of my copies is leaving" chooser, shared by the trade composer and
 * the accept dialog.
 *
 * Both sides used to render their own text-only list of `LEA · #233 · foil · NM`
 * strings with their own stepper and their own CSS — two spellings of one
 * control, and neither showed the card. A printing is picked by LOOKING at it
 * (the reason `PrintingPicker` is a grid of art tiles), so every row leads with
 * the actual art of that printing, straight off the owned copy's `imageSmall` —
 * no fetch, the collection already carries it.
 *
 * Each row also says where the copy currently lives: a `DeckBadge` when it is
 * checked out to a deck or a physical cube, a `BinderBadge` when it is sitting
 * in a binder. Trading away the copy that is holding a deck together is the
 * mistake this surface exists to prevent, and the badges are the only warning
 * before it happens. Both are rendered non-interactively here — following a
 * link out of a modal would abandon the offer being composed.
 */
export function PrintingChoices({
  cardName,
  groups,
  countOf,
  onSet,
  disabled = false,
  label,
  binderByCopyId,
}: Props) {
  const allocations = useAllocations();

  return (
    <ul className="printing-choices" aria-label={label}>
      {groups.map((group) => {
        const count = countOf(group);
        const printingLabel = describePrinting(group);
        const owned = group.copies.length;

        const claims: AllocationInfo[] = [];
        const binders: BinderRef[] = [];
        for (const copy of group.copies) {
          const claim = allocations.get(copy.copyId);
          if (claim) claims.push(claim);
          for (const binder of binderByCopyId?.get(copy.copyId) ?? []) binders.push(binder);
        }

        return (
          <li
            key={group.key}
            className={count > 0 ? 'printing-choice is-chosen' : 'printing-choice'}
          >
            <PrintingArt group={group} />
            {/* Name line then meta line, the same hierarchy every card row in
                the app uses (STYLE_GUIDE § "Card row information hierarchy").
                Side by side, the identity — which printing this IS — was the
                only flexible column, so at 320px it truncated to nothing while
                the badges and price kept their width. */}
            <span className="printing-choice-main">
              <span className="printing-choice-label" title={printingLabel}>
                {printingLabel}
              </span>
              <span className="printing-choice-meta">
                <DeckBadge allocations={claims} nonInteractive />
                <BinderBadge binders={binders} nonInteractive />
                <span className="printing-choice-price">{formatMoney(group.price)}</span>
              </span>
            </span>
            {onSet ? (
              <span className="printing-choice-stepper">
                <button
                  type="button"
                  className="printing-choice-step"
                  onClick={() => onSet(group.key, count - 1)}
                  disabled={count === 0 || disabled}
                  aria-label={`One fewer ${printingLabel} ${cardName}`}
                >
                  <Minus width={14} height={14} aria-hidden />
                </button>
                <span className="printing-choice-count" aria-live="polite">
                  {count}
                  <span className="printing-choice-owned">/{owned}</span>
                </span>
                <button
                  type="button"
                  className="printing-choice-step"
                  onClick={() => onSet(group.key, count + 1)}
                  disabled={count >= owned || disabled}
                  aria-label={`One more ${printingLabel} ${cardName}`}
                >
                  <Plus width={14} height={14} aria-hidden />
                </button>
              </span>
            ) : (
              <span className="printing-choice-count">
                {count}
                <span className="printing-choice-owned">/{owned}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The printing's own art. Owned copies carry `imageSmall`/`imageNormal`, so the
 * common case needs no network at all; `useCardThumb` is the fallback for
 * legacy rows imported before those fields existed, and resolves by NAME off
 * the CDN (never the throttled Scryfall API host).
 */
function PrintingArt({ group }: { group: PrintingGroup }) {
  const copy = group.copies[0];
  const stored = copy?.imageSmall ?? copy?.imageNormal;
  const fetched = useCardThumb(stored ? undefined : copy?.name, 'small');
  const src = stored ?? fetched;
  return src ? (
    <img
      className="printing-choice-art"
      src={src}
      alt=""
      aria-hidden
      loading="lazy"
      draggable={false}
    />
  ) : (
    <span className="printing-choice-art is-placeholder" aria-hidden />
  );
}
