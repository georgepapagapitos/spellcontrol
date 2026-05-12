import { useEffect, useMemo, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useAllocations } from '../lib/allocations';
import { compileFilterGroups, cardMatchesAnyGroup, areAllGroupsEmpty } from '../lib/rules';
import { useEscapeKey } from '../lib/use-escape-key';
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
  useEscapeKey(onClose);

  // Auto-close after showing confirmation feedback.
  useEffect(() => {
    if (!addedTo) return;
    const t = setTimeout(onClose, 900);
    return () => clearTimeout(t);
  }, [addedTo, onClose]);

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
        onClose();
      }}
      role="presentation"
    >
      <div
        className="card-picker-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={dialogLabel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <p className="add-to-binder-label">{headerLabel}</p>
          <p className="add-to-binder-card-name">
            {card.name}
            {card.foil ? <span className="card-picker-foil"> foil</span> : null}
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
                      <CheckIcon /> {currentBinderId ? 'Moved' : 'Added'}
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
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.2rem' }}
    >
      <path d="M3 8l4 4 6-6" />
    </svg>
  );
}
