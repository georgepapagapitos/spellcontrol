import { Check } from 'lucide-react';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useCollectionStore } from '@/store/collection';
import { Sheet, type SheetHandle } from '@/components/overlays/Sheet';
import { useAllocations } from '@/lib/collection/allocations';
import {
  compileFilterGroups,
  cardMatchesAnyGroup,
  areAllGroupsEmpty,
} from '@spellcontrol/binder-routing';
import { FoilBadge } from '@/components/shared/FoilBadge';
import type { EnrichedCard } from '@/types/index';
import { Button } from '@/components/shared/Button';

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
  const allocatedKind = allocations.get(card.copyId)?.ownerKind;

  const sheetRef = useRef<SheetHandle>(null);

  // Auto-close after showing confirmation feedback.
  useEffect(() => {
    if (!addedTo) return;
    const t = setTimeout(() => sheetRef.current?.close(), 900);
    return () => clearTimeout(t);
  }, [addedTo]);

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
    <Sheet
      ref={sheetRef}
      onClose={onClose}
      label={dialogLabel}
      eyebrow={headerLabel}
      title={
        <>
          {card.name}
          {card.foil ? <FoilBadge card={card} /> : null}
        </>
      }
      footer={(close) => <Button onClick={() => close()}>Cancel</Button>}
    >
      {sorted.length === 0 ? (
        <div className="card-picker-empty" style={{ padding: 'var(--space-6) var(--space-4)' }}>
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
                  <span className="add-to-binder-mismatch">Doesn't match rules</span>
                )}
                {isAllocated && binder.hideDeckAllocated === false && !isCurrent && !isAdded && (
                  <span className="add-to-binder-mismatch">
                    {allocatedKind === 'cube' ? 'Hidden while in a cube' : 'Hidden while in a deck'}
                  </span>
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
                  <span
                    className="add-to-binder-current"
                    aria-label="Already in this binder"
                    role="img"
                  >
                    Already here
                  </span>
                ) : (
                  <Button
                    onClick={() => handlePick(binder.id)}
                    aria-label={`${
                      currentBinderId ? 'Move' : 'Add'
                    } ${card.name} to ${binder.name}`}
                    disabled={!!addedTo}
                    className="add-to-binder-btn"
                  >
                    {currentBinderId ? 'Move' : 'Add'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
