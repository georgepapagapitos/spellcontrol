import { Layers, Notebook, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AddToBinderSheet } from './AddToBinderSheet';
import { OverflowMenu, type OverflowMenuItem } from './OverflowMenu';
import type { EnrichedCard } from '../types';

interface Props {
  card: EnrichedCard;
  onEditCard: () => void;
  /** Re-point a single copy of this stack to a different printing. Pass only
   *  for grouped rows holding 2+ copies of one printing (so a stack can be
   *  split); omit otherwise to hide the action. */
  onSplitCopy?: () => void;
  /** Remove this row's copies from the collection. Omit to hide the action. */
  onDelete?: () => void;
  /** The binder this card is currently routed to, if any. Drives the
   *  "Move to binder" vs "Add to binder" label and the disabled row in the
   *  sheet. */
  currentBinder?: { id: string; name: string; color: string | null } | null;
}

/**
 * The per-row card-actions kebab. A thin wrapper over the shared
 * {@link OverflowMenu} (which owns portaling, viewport placement, keyboard,
 * scroll-close and the trigger style) that adds the card-specific actions and
 * the "Add to binder" sheet. `.deck-row-menu` keeps the fixed-width column
 * sizing; `card-edit-btn` keeps the ghost-kebab trigger look.
 */
export function CardRowMenu({ card, onEditCard, onSplitCopy, onDelete, currentBinder }: Props) {
  const [binderSheetOpen, setBinderSheetOpen] = useState(false);

  const items: OverflowMenuItem[] = [
    { label: 'Edit card', icon: Pencil, onClick: onEditCard },
    ...(onSplitCopy
      ? [{ label: 'Change one copy’s printing…', icon: Layers, onClick: onSplitCopy }]
      : []),
    {
      label: currentBinder ? 'Move to binder' : 'Add to binder',
      icon: Notebook,
      onClick: () => setBinderSheetOpen(true),
    },
    ...(onDelete
      ? [{ label: 'Remove from collection', icon: Trash2, danger: true, onClick: onDelete }]
      : []),
  ];

  return (
    <>
      <OverflowMenu
        className="deck-row-menu"
        triggerClassName="card-edit-btn"
        ariaLabel="Card actions"
        items={items}
        header={
          currentBinder ? (
            <div className="deck-row-menu-status" aria-live="polite">
              <span
                className="card-list-binder-badge-swatch"
                style={{ background: currentBinder.color || 'var(--accent)' }}
                aria-hidden
              />
              <span>
                In <strong>{currentBinder.name}</strong>
              </span>
            </div>
          ) : undefined
        }
      />

      {binderSheetOpen && (
        <AddToBinderSheet
          card={card}
          currentBinderId={currentBinder?.id ?? null}
          onClose={() => setBinderSheetOpen(false)}
        />
      )}
    </>
  );
}
