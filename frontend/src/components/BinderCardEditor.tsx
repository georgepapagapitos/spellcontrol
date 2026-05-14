import { GripVertical } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCollectionStore } from '../store/collection';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { CardPickerSheet } from './CardPickerSheet';
import type { EnrichedCard, MaterializedBinder } from '../types';

interface Props {
  binder: MaterializedBinder;
  allCards: EnrichedCard[];
  onClose: () => void;
}

type Tab = 'cards' | 'order';

export function BinderCardEditor({ binder, allCards, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('cards');
  const [pickerOpen, setPickerOpen] = useState(false);

  const removeCardFromBinder = useCollectionStore((s) => s.removeCardFromBinder);
  const restoreExcludedCard = useCollectionStore((s) => s.restoreExcludedCard);
  const setBinderManualOrder = useCollectionStore((s) => s.setBinderManualOrder);
  const seedManualOrder = useCollectionStore((s) => s.seedManualOrder);

  useLockBodyScroll();

  // Flat ordered list of active cards in the binder.
  const activeCards = useMemo(() => binder.sections.flatMap((s) => s.cards), [binder.sections]);

  // Build a set of pinned copyIds for fast lookup.
  const pinnedSet = useMemo(
    () => new Set(binder.def.pinnedCopyIds ?? []),
    [binder.def.pinnedCopyIds]
  );

  // Resolve excluded cards from the full collection.
  const cardsByCopyId = useMemo(() => new Map(allCards.map((c) => [c.copyId, c])), [allCards]);
  const excludedCards = useMemo(() => {
    return (binder.def.excludedCopyIds ?? [])
      .map((id) => cardsByCopyId.get(id))
      .filter((c): c is EnrichedCard => c !== undefined);
  }, [binder.def.excludedCopyIds, cardsByCopyId]);

  // Local copy of the order for optimistic DnD updates.
  const [localOrder, setLocalOrder] = useState<string[]>(() => activeCards.map((c) => c.copyId));

  // Keep localOrder in sync if active cards change (card added via picker, removed, etc.)
  // by appending new arrivals at the end and dropping stale refs.
  const activeCardIds = activeCards.map((c) => c.copyId).join(',');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalOrder((prev) => {
      const activeSet = new Set(activeCards.map((c) => c.copyId));
      const filtered = prev.filter((id) => activeSet.has(id));
      const existing = new Set(filtered);
      const newIds = activeCards.map((c) => c.copyId).filter((id) => !existing.has(id));
      return filtered.length === prev.length && newIds.length === 0
        ? prev
        : [...filtered, ...newIds];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCardIds]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = localOrder.indexOf(active.id as string);
      const newIndex = localOrder.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(localOrder, oldIndex, newIndex);
      setLocalOrder(reordered);
      setBinderManualOrder(binder.def.id, reordered);
    },
    [localOrder, binder.def.id, setBinderManualOrder]
  );

  const handleRemove = useCallback(
    (copyId: string) => {
      const isRuleMatched = !pinnedSet.has(copyId);
      removeCardFromBinder(binder.def.id, copyId, isRuleMatched);
    },
    [binder.def.id, pinnedSet, removeCardFromBinder]
  );

  const handleRestore = useCallback(
    (copyId: string) => {
      restoreExcludedCard(binder.def.id, copyId);
    },
    [binder.def.id, restoreExcludedCard]
  );

  const isManualOrder = !!binder.def.manualOrder?.length;

  const handleToggleManualOrder = () => {
    if (isManualOrder) {
      setBinderManualOrder(binder.def.id, undefined);
    } else {
      const currentIds = activeCards.map((c) => c.copyId);
      seedManualOrder(binder.def.id, currentIds);
      setLocalOrder(currentIds);
    }
  };

  // Cards shown in the Order tab — use localOrder (optimistic) when manual order is on.
  const orderedCardsForDnd = useMemo(() => {
    const byId = new Map(activeCards.map((c) => [c.copyId, c]));
    return localOrder.map((id) => byId.get(id)).filter((c): c is EnrichedCard => !!c);
  }, [localOrder, activeCards]);

  const currentBoundSet = useMemo(() => new Set(activeCards.map((c) => c.copyId)), [activeCards]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit cards — ${binder.def.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Edit cards — {binder.def.name}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {binder.def.mode === 'manual' && (
          <p className="binder-card-editor-manual-hint">
            Manual mode — only pinned cards appear in this binder
          </p>
        )}

        <div className="binder-card-editor-tabs">
          <button
            type="button"
            className={`binder-card-editor-tab${tab === 'cards' ? ' active' : ''}`}
            onClick={() => setTab('cards')}
          >
            Cards{activeCards.length > 0 ? ` (${activeCards.length})` : ''}
          </button>
          <button
            type="button"
            className={`binder-card-editor-tab${tab === 'order' ? ' active' : ''}`}
            onClick={() => setTab('order')}
          >
            Order
          </button>
        </div>

        <div className="modal-body">
          {tab === 'cards' && (
            <CardsTab
              activeCards={activeCards}
              excludedCards={excludedCards}
              pinnedSet={pinnedSet}
              onRemove={handleRemove}
              onRestore={handleRestore}
            />
          )}
          {tab === 'order' && (
            <OrderTab
              isManualOrder={isManualOrder}
              orderedCards={orderedCardsForDnd}
              activeCards={activeCards}
              localOrder={localOrder}
              sensors={sensors}
              onDragEnd={handleDragEnd}
              onToggleManualOrder={handleToggleManualOrder}
            />
          )}
        </div>

        <div className="modal-footer">
          {tab === 'cards' && (
            <button type="button" className="btn" onClick={() => setPickerOpen(true)}>
              + Add cards
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={onClose}
            autoFocus={tab !== 'cards'}
          >
            Done
          </button>
        </div>
      </div>

      {pickerOpen && (
        <CardPickerSheet
          binderId={binder.def.id}
          allCards={allCards}
          currentBoundSet={currentBoundSet}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ── Cards tab ──────────────────────────────────────────────────────────────

interface CardsTabProps {
  activeCards: EnrichedCard[];
  excludedCards: EnrichedCard[];
  pinnedSet: Set<string>;
  onRemove: (copyId: string) => void;
  onRestore: (copyId: string) => void;
}

function CardsTab({ activeCards, excludedCards, pinnedSet, onRemove, onRestore }: CardsTabProps) {
  if (activeCards.length === 0 && excludedCards.length === 0) {
    return (
      <p className="binder-card-editor-empty">
        No cards yet. Click "+ Add cards" to add cards from your collection.
      </p>
    );
  }

  return (
    <>
      {activeCards.length > 0 && (
        <ul className="binder-card-editor-list">
          {activeCards.map((card) => {
            const isPinned = pinnedSet.has(card.copyId);
            return (
              <li key={card.copyId} className="binder-card-editor-row">
                <span
                  className={`binder-card-editor-status-dot rarity-${card.rarity}`}
                  aria-hidden
                />
                <span className="binder-card-editor-name">{card.name}</span>
                <span className="binder-card-editor-meta">
                  {card.setCode.toUpperCase()} #{card.collectorNumber}
                  {card.foil ? <span className="binder-card-editor-foil"> foil</span> : null}
                  {isPinned ? (
                    <span className="binder-card-editor-pinned-tag" title="Manually added">
                      {' '}
                      pinned
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="binder-card-editor-remove"
                  aria-label={`Remove ${card.name}`}
                  onClick={() => onRemove(card.copyId)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {excludedCards.length > 0 && (
        <>
          <p className="binder-card-editor-section-label">Hidden (manually excluded)</p>
          <ul className="binder-card-editor-list">
            {excludedCards.map((card) => (
              <li
                key={card.copyId}
                className="binder-card-editor-row binder-card-editor-row--excluded"
              >
                <span
                  className={`binder-card-editor-status-dot rarity-${card.rarity}`}
                  aria-hidden
                />
                <span className="binder-card-editor-name">{card.name}</span>
                <span className="binder-card-editor-meta">
                  {card.setCode.toUpperCase()} #{card.collectorNumber}
                  {card.foil ? <span className="binder-card-editor-foil"> foil</span> : null}
                </span>
                <button
                  type="button"
                  className="binder-card-editor-restore"
                  aria-label={`Restore ${card.name}`}
                  onClick={() => onRestore(card.copyId)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

// ── Order tab ──────────────────────────────────────────────────────────────

interface OrderTabProps {
  isManualOrder: boolean;
  orderedCards: EnrichedCard[];
  activeCards: EnrichedCard[];
  localOrder: string[];
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
  onToggleManualOrder: () => void;
}

function OrderTab({
  isManualOrder,
  orderedCards,
  activeCards,
  localOrder,
  sensors,
  onDragEnd,
  onToggleManualOrder,
}: OrderTabProps) {
  return (
    <>
      <div className="binder-card-editor-order-toggle">
        <label className="field-checkbox" style={{ margin: 0 }}>
          <input type="checkbox" checked={isManualOrder} onChange={onToggleManualOrder} />
          Manual order
        </label>
        {isManualOrder && (
          <span className="binder-card-editor-order-hint">
            Drag cards to rearrange. New cards are appended after your ordered list.
          </span>
        )}
        {!isManualOrder && (
          <span className="binder-card-editor-order-hint">
            Cards follow your binder's sort rules. Enable manual order to drag cards into position.
          </span>
        )}
      </div>

      {activeCards.length === 0 ? (
        <p className="binder-card-editor-empty">No cards in this binder yet.</p>
      ) : isManualOrder ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={localOrder} strategy={verticalListSortingStrategy}>
            <ul className="binder-card-editor-list">
              {orderedCards.map((card) => (
                <SortableCardRow key={card.copyId} card={card} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <ul className="binder-card-editor-list">
          {activeCards.map((card) => (
            <li key={card.copyId} className="binder-card-editor-row">
              <span className={`binder-card-editor-status-dot rarity-${card.rarity}`} aria-hidden />
              <span className="binder-card-editor-name">{card.name}</span>
              <span className="binder-card-editor-meta">
                {card.setCode.toUpperCase()} #{card.collectorNumber}
                {card.foil ? <span className="binder-card-editor-foil"> foil</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ── Sortable row ───────────────────────────────────────────────────────────

function SortableCardRow({ card }: { card: EnrichedCard }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.copyId,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`binder-card-editor-row${isDragging ? ' dragging' : ''}`}
    >
      <button
        className="binder-card-editor-drag"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical width={14} height={14} strokeWidth={1.6} aria-hidden />
      </button>
      <span className={`binder-card-editor-status-dot rarity-${card.rarity}`} aria-hidden />
      <span className="binder-card-editor-name">{card.name}</span>
      <span className="binder-card-editor-meta">
        {card.setCode.toUpperCase()} #{card.collectorNumber}
        {card.foil ? <span className="binder-card-editor-foil"> foil</span> : null}
      </span>
    </li>
  );
}
