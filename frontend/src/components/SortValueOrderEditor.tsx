import { RotateCcw } from 'lucide-react';
import { useCallback, useMemo } from 'react';
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
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SortField } from '../types';
import { getDefaultValueOrder, getValueLabel, resolveValueOrder } from '../lib/sorting';

interface Props {
  field: SortField;
  /** Current override (canonical keys). Undefined means "use default". */
  value: string[] | undefined;
  onChange: (next: string[] | undefined) => void;
}

/**
 * Reorderable list of canonical value keys for a sort field (e.g. Treatment,
 * Finish). Uses dnd-kit so pointer, touch, and keyboard (Tab → Space → arrows
 * → Space) all work for free with screen-reader announcements.
 */
export function SortValueOrderEditor({ field, value, onChange }: Props) {
  const order = useMemo(() => resolveValueOrder(field, value), [field, value]);
  const isCustomized = useMemo(() => {
    const defaults = getDefaultValueOrder(field);
    return order.length !== defaults.length || order.some((k, i) => k !== defaults[i]);
  }, [field, order]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = order.indexOf(active.id as string);
      const newIndex = order.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      onChange(arrayMove(order, oldIndex, newIndex));
    },
    [order, onChange]
  );

  return (
    <div className="sort-value-order-editor">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={horizontalListSortingStrategy}>
          <ol className="sort-value-order-list" aria-label={`${field} order — drag to reorder`}>
            {order.map((key, i) => (
              <SortableValueChip key={key} id={key} index={i} label={getValueLabel(field, key)} />
            ))}
            {isCustomized && (
              <li className="sort-value-order-list-action">
                <button
                  type="button"
                  className="sort-value-order-reset"
                  onClick={() => onChange(undefined)}
                  title="Reset to default order"
                  aria-label="Reset to default order"
                >
                  <RotateCcw width={14} height={14} strokeWidth={2} aria-hidden />
                </button>
              </li>
            )}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableValueChip({ id, index, label }: { id: string; index: number; label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
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
      className={`sort-value-order-chip${isDragging ? ' dragging' : ''}`}
      {...attributes}
      {...listeners}
      aria-label={`${label} — position ${index + 1}. Use space to grab, arrow keys to move, space to drop.`}
    >
      <span className="sort-value-order-num">{index + 1}</span>
      <span className="sort-value-order-label">{label}</span>
    </li>
  );
}
