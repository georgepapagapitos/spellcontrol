import { Check } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useSheetExit } from '../lib/use-sheet-exit';
import { useAllocations } from '../lib/allocations';
import { compileFilterGroups, cardMatchesAnyGroup, areAllGroupsEmpty } from '../lib/rules';
import { useEscapeKey } from '../lib/use-escape-key';
import { FoilBadge } from './FoilBadge';
import type { EnrichedCard } from '../types';

interface Props {
  card: EnrichedCard;
  /** If set, the card is already routed to this binder. Picking another
   *  binder triggers a "move": remove from current (unpin or exclude),
   *  then pin to the destination. */
  currentBinderId?: string | null;
  onClose: () => void;
}

export function AddToBinderSheet({ card, currentBinderId, onClose }: Props) {
  const binders = useCollectionStore((s) => s.binders);
  const pinCardToBinder = useCollectionStore((s) => s.pinCardToBinder);
  const removeCardFromBinder = useCollectionStore((s) => s.removeCardFromBinder);
  const [addedTo, setAddedTo] = useState<string | null>(null);
  const allocations = useAllocations();
  const isAllocated = allocations.has(card.copyId);

  useLockBodyScroll();

  // Below 1024px this is a bottom sheet with a slide-up entry, so every
  // dismiss path (backdrop, Escape, Cancel, the post-pick auto-close) plays
  // the symmetric `binder-sheet-slide-out` before unmount. On desktop it's
  // a centered panel with `animation: none` — exits stay instant there,
  // symmetric with its entry.
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  const dismiss = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) onClose();
    else beginClose();
  }, [beginClose, onClose]);
  useEscapeKey(dismiss);

  // Auto-close after showing confirmation feedback.
  useEffect(() => {
    if (!addedTo) return;
    const t = setTimeout(dismiss, 900);
    return () => clearTimeout(t);
  }, [addedTo, dismiss]);

  const sorted = [...binders].sort((a, b) => a.position - b.position);

  const compiledByBinder = useMemo(
    () => new Map(binders.map((b) => [b.id, compileFilterGroups(b.filterGroups)])),
    [binders]
  );

  const cardMatchesBinder = (binderId: string): boolean => {
    const binder = binders.find((b) => b.id === binderId);
    if (!binder || binder.mode === 'manual') return true;
    if (areAllGroupsEmpty(binder.filterGroups)) return true;
    const compiled = compiledByBinder.get(binderId);
    return compiled ? cardMatchesAnyGroup(card, compiled) : true;
  };

  const handlePick = (binderId: string) => {
    if (binderId === currentBinderId) return;
    if (currentBinderId) {
      const current = binders.find((b) => b.id === currentBinderId);
      const wasPinned = !!current?.pinnedCopyIds?.includes(card.copyId);
      // If not in pinnedCopyIds, the card landed in this binder via rule
      // routing, so we need to exclude rather than unpin.
      removeCardFromBinder(currentBinderId, card.copyId, !wasPinned);
    }
    pinCardToBinder(binderId, card.copyId);
    setAddedTo(binderId);
  };

  const headerLabel = currentBinderId ? 'Moving' : 'Adding';
  const dialogLabel = currentBinderId ? 'Move to binder' : 'Add to binder';

  return (
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        dismiss();
      }}
      role="presentation"
    >
      <div
        className={`card-picker-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={dialogLabel}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <p className="add-to-binder-label">{headerLabel}</p>
          <p className="add-to-binder-card-name">
            {card.name}
            {card.foil ? <FoilBadge card={card} /> : null}
          </p>
        </div>

        {sorted.length === 0 ? (
          <div className="card-picker-empty" style={{ padding: '2rem 1rem' }}>
            No binders yet. Create a binder first.
          </div>
        ) : (
          <ul className="card-picker-list" role="list">
            {sorted.map((binder) => {
              const isAdded = addedTo === binder.id;
              const isCurrent = binder.id === currentBinderId;
              const matches = cardMatchesBinder(binder.id);
              const isManual = binder.mode === 'manual';
              return (
                <li key={binder.id} className="add-to-binder-row">
                  <span
                    className="add-to-binder-swatch"
                    style={{ background: binder.color ?? 'var(--accent)' }}
                    aria-hidden
                  />
                  <span className="add-to-binder-name">
                    {binder.name}
                    {isManual && <span className="add-to-binder-mode-hint">Manual</span>}
                  </span>
                  {!matches && !isCurrent && !isAdded && (
                    <span className="add-to-binder-mismatch">Does not match rules</span>
                  )}
                  {isAllocated && binder.hideDeckAllocated === false && !isCurrent && !isAdded && (
                    <span className="add-to-binder-mismatch">Hidden while in a deck</span>
                  )}
                  {isAdded ? (
                    <span className="add-to-binder-added" aria-live="polite">
                      <Check
                        width={12}
                        height={12}
                        strokeWidth={2}
                        aria-hidden
                        style={{
                          display: 'inline',
                          verticalAlign: 'middle',
                          marginRight: '0.2rem',
                        }}
                      />{' '}
                      {currentBinderId ? 'Moved' : 'Added'}
                    </span>
                  ) : isCurrent ? (
                    <span className="add-to-binder-current" aria-label="Already in this binder">
                      Already here
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn add-to-binder-btn"
                      onClick={() => handlePick(binder.id)}
                      aria-label={`${
                        currentBinderId ? 'Move' : 'Add'
                      } ${card.name} to ${binder.name}`}
                      disabled={!!addedTo}
                    >
                      {currentBinderId ? 'Move' : 'Add'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="card-picker-footer">
          <button type="button" className="btn btn-primary" onClick={() => dismiss()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
