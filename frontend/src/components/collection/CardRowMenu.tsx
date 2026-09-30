import { Layers, Notebook, Pencil, Tags, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AddToBinderSheet } from '@/components/binder/AddToBinderSheet';
import { CardOtagsSheet } from '@/components/card/CardOtagsSheet';
import { OverflowMenu, type OverflowMenuItem } from '@/components/overlays/OverflowMenu';
import type { EnrichedCard } from '@/types/index';

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
  /** `row` (default) is the list/table kebab; `tile` is a grid tile's corner
   *  ⋮; `pocket` is a binder page pocket's. Same items every way: only where
   *  it sits and what a right-click on it belongs to differ. */
  variant?: 'row' | 'tile' | 'pocket';
  /** Set while this card is one of two or more selected: a right-click opens
   *  the selection's actions (OverflowMenu `selection`). */
  selection?: { title: string; items: OverflowMenuItem[] } | null;
}

/** Wrapper class, trigger class and right-click host per placement. */
const PLACEMENT = {
  row: { menu: 'deck-row-menu', trigger: 'card-edit-btn', host: '.collection-list-row' },
  tile: {
    menu: 'collection-grid-menu',
    trigger: 'collection-grid-menu-btn',
    host: '.collection-grid-cell',
  },
  pocket: { menu: 'slot-menu', trigger: 'collection-grid-menu-btn', host: '.slot-cell' },
} as const;

/**
 * The per-row card-actions kebab. A thin wrapper over the shared
 * {@link OverflowMenu} (which owns portaling, viewport placement, keyboard,
 * scroll-close and the trigger style) that adds the card-specific actions and
 * the "Add to binder" sheet. `.deck-row-menu` keeps the fixed-width column
 * sizing; `card-edit-btn` keeps the ghost-kebab trigger look.
 */
export function CardRowMenu({
  card,
  onEditCard,
  onSplitCopy,
  onDelete,
  currentBinder,
  variant = 'row',
  selection,
}: Props) {
  const [binderSheetOpen, setBinderSheetOpen] = useState(false);
  const [otagsSheetOpen, setOtagsSheetOpen] = useState(false);

  const items: OverflowMenuItem[] = [
    { label: 'Edit card', icon: Pencil, onClick: onEditCard },
    ...(onSplitCopy
      ? [{ label: "Change one copy's printing…", icon: Layers, onClick: onSplitCopy }]
      : []),
    {
      label: currentBinder ? 'Move to binder' : 'Add to binder',
      icon: Notebook,
      onClick: () => setBinderSheetOpen(true),
    },
    { label: 'View card tags', icon: Tags, onClick: () => setOtagsSheetOpen(true) },
    ...(onDelete
      ? [{ label: 'Remove from collection', icon: Trash2, danger: true, onClick: onDelete }]
      : []),
  ];

  return (
    <>
      <OverflowMenu
        className={PLACEMENT[variant].menu}
        triggerClassName={PLACEMENT[variant].trigger}
        ariaLabel={variant === 'row' ? 'Card actions' : `Actions for ${card.name}`}
        contextHost={PLACEMENT[variant].host}
        selection={selection}
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

      {otagsSheetOpen && <CardOtagsSheet card={card} onClose={() => setOtagsSheetOpen(false)} />}
    </>
  );
}
