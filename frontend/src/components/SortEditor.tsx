import { GripVertical, X } from 'lucide-react';
import type { CSSProperties } from 'react';
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
import {
  SORT_FIELDS,
  MAX_SORTS,
  getImplicitTiebreakers,
  CUSTOMIZABLE_VALUE_ORDER_FIELDS,
  resolveValueOrder,
  getValueLabel,
} from '../lib/sorting';
import { SelectMenu } from './SelectMenu';
import { SortValueOrderEditor } from './SortValueOrderEditor';
import { OverflowMenu, type OverflowMenuItem } from './OverflowMenu';
import { ColorPip } from './shared/ManaSymbol';
import { useMediaQuery } from '../lib/use-media-query';
import type { SortDir, SortEntry, SortField } from '../types';
import { Button, IconButton } from '@/components/shared/Button';
import { SegmentedControl, type Option } from './shared/form';

type ValueOrders = Partial<Record<SortField, string[]>>;

interface Props {
  sorts: SortEntry[];
  valueOrders: ValueOrders;
  onSortsChange: (next: SortEntry[]) => void;
  onValueOrdersChange: (next: ValueOrders) => void;
}

/** Below this container width a row's reorder affordance is a menu, not a
 *  drag handle — a drag gesture inside a bottom sheet fights the sheet's own
 *  swipe-to-dismiss and scroll (STYLE_GUIDE § Sort chains). Matches the app's
 *  one phone-tier convention (`(max-width: 599px)`, same as `ScanFab`/
 *  `BinderView`) rather than inventing a second breakpoint. */
const NARROW = '(max-width: 599px)';

/**
 * The sort-chain editor: an ordered list of rows — field picker, direction
 * control, reorder/remove — plus optional value-order editors for
 * treatment/finish and the implicit tie-breaker sentence. Controlled, and
 * shared by the binder edit modal and the in-view sort popover/sheet so the
 * three never drift.
 *
 * Rows have JOBS, not just positions: row 1 is always **Sections** (a binder
 * needs one, so it can't be removed) and every row after it is **Inside each
 * section** — the same first-sort-makes-the-header rule the binder already
 * followed, now named instead of left implicit.
 *
 * Reorder is a drag handle with full keyboard support on a wide host (pointer
 * + `KeyboardSensor`, same as `SortValueOrderEditor`'s value chips) and a
 * named row menu — "Use for sections", "Move up", "Move down", "Remove" — on
 * a narrow one, where dragging inside a sheet would collide with the sheet's
 * own gestures. Direction is a two-option `SegmentedControl` showing BOTH
 * outcomes, long-form on a roomy host and short-form (`dirShort`) once the
 * host narrows — a container query on this component's own box, never the
 * viewport: the popover/sheet is width-capped regardless of screen size
 * (E299).
 */
export function SortEditor({ sorts, valueOrders, onSortsChange, onValueOrdersChange }: Props) {
  const narrow = useMediaQuery(NARROW);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sorts.findIndex((s) => s.field === active.id);
    const newIndex = sorts.findIndex((s) => s.field === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onSortsChange(arrayMove(sorts, oldIndex, newIndex));
  };

  return (
    <>
      {/* Container for the sort rows' layout query. The row grid's breakpoint
          has to key off THIS element's width, not the viewport's: the popover
          host is capped at 26rem no matter how wide the screen is, so a
          viewport media query was asking the wrong question and never fired
          where the constraint actually bit (E299). */}
      <div className="sort-editor">
        <div className="sort-editor-list">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sorts.map((s) => s.field)}
              strategy={verticalListSortingStrategy}
            >
              {sorts.map((s, i) => (
                <SortRow
                  key={s.field}
                  s={s}
                  i={i}
                  sorts={sorts}
                  valueOrders={valueOrders}
                  onSortsChange={onSortsChange}
                  onValueOrdersChange={onValueOrdersChange}
                  narrow={narrow}
                />
              ))}
            </SortableContext>
          </DndContext>
          {sorts.length < MAX_SORTS && (
            <Button
              onClick={() => onSortsChange([...sorts, nextDefaultSort(sorts)])}
              className="btn-add-group"
            >
              + Add sort
            </Button>
          )}
        </div>
      </div>
      <ImplicitTiebreakerHint
        sorts={sorts}
        valueOrders={valueOrders}
        onSortsChange={onSortsChange}
      />
    </>
  );
}

function SortRow({
  s,
  i,
  sorts,
  valueOrders,
  onSortsChange,
  onValueOrdersChange,
  narrow,
}: {
  s: SortEntry;
  i: number;
  sorts: SortEntry[];
  valueOrders: ValueOrders;
  onSortsChange: (next: SortEntry[]) => void;
  onValueOrdersChange: (next: ValueOrders) => void;
  narrow: boolean;
}) {
  // Always called — the sortable context is always mounted (see SortEditor),
  // and `narrow` deciding whether we render the grip's attributes/listeners
  // must not change which hooks this component calls across renders.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: s.field,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const isCustomizable = CUSTOMIZABLE_VALUE_ORDER_FIELDS.includes(s.field);
  // The picker's own label ("Release date"), not `sortEntryLabel` — that one
  // appends a ↑/↓ glyph, which a screen reader either spells out or drops,
  // and the direction is already its own control here.
  const fieldLabel = SORT_FIELDS.find((f) => f.value === s.field)?.label ?? s.field;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`sort-editor-row${isDragging ? ' is-dragging' : ''}`}
    >
      {i === 0 && <p className="sort-editor-level-label">Sections</p>}
      {i === 1 && <p className="sort-editor-level-label">Inside each section</p>}
      <div className="sort-editor-row-main">
        <span className="sort-editor-num">{i + 1}.</span>
        {!narrow && (
          <IconButton
            className="sort-editor-grip"
            {...attributes}
            {...listeners}
            label={`Reorder ${fieldLabel}, position ${i + 1} of ${sorts.length}`}
            title="Drag to reorder"
            icon={<GripVertical width={14} height={14} strokeWidth={1.8} />}
          />
        )}
        <SelectMenu
          ariaLabel={`Sort ${i + 1} field`}
          value={s.field}
          // Only fields not already in the chain (plus this row's own).
          // Sorting by the same field twice does nothing — the second
          // pass has no ties left to break — and allowing it was also
          // what stopped the field from being a usable React key.
          options={SORT_FIELDS.filter(
            (f) => f.value === s.field || !sorts.some((x) => x.field === f.value)
          ).map((f) => ({ value: f.value, label: f.label }))}
          onChange={(field) => {
            if (field === s.field) return; // re-picking your own field is a no-op
            onSortsChange(
              sorts.map((x, j) => {
                if (j !== i) return x;
                const defaultDir = SORT_FIELDS.find((f) => f.value === field)?.defaultDir ?? 'asc';
                return { field: field as SortField, dir: defaultDir };
              })
            );
          }}
        />
        <SortDirectionControl s={s} i={i} sorts={sorts} onSortsChange={onSortsChange} />
        {!narrow &&
          // The section row can't be removed — a binder needs at least one —
          // so there is nothing to render here for it, on purpose (not a
          // disabled button: STYLE_GUIDE § Sort chains).
          i !== 0 && (
            <IconButton
              className="sort-editor-remove"
              onClick={() => onSortsChange(sorts.filter((_, j) => j !== i))}
              title="Remove this sort"
              label={`Remove the ${fieldLabel} sort`}
              icon={<X width={14} height={14} strokeWidth={1.8} />}
            />
          )}
        {narrow && (
          <OverflowMenu
            className="sort-editor-row-menu"
            ariaLabel={`${fieldLabel} sort actions`}
            items={rowMenuItems({ sorts, i, fieldLabel, onSortsChange })}
          />
        )}
      </div>
      {isCustomizable && (
        <SortValueOrderEditor
          field={s.field}
          value={valueOrders[s.field]}
          onChange={(next) => {
            const copy = { ...valueOrders };
            if (next === undefined) delete copy[s.field];
            else copy[s.field] = next;
            onValueOrdersChange(copy);
          }}
        />
      )}
    </div>
  );
}

/** Every menu item names the row it acts on (STYLE_GUIDE § Verbs — Menus). */
function rowMenuItems({
  sorts,
  i,
  fieldLabel,
  onSortsChange,
}: {
  sorts: SortEntry[];
  i: number;
  fieldLabel: string;
  onSortsChange: (next: SortEntry[]) => void;
}): OverflowMenuItem[] {
  const items: OverflowMenuItem[] = [];
  if (i !== 0) {
    items.push({
      label: `Use ${fieldLabel} for sections`,
      onClick: () => onSortsChange(moveToFront(sorts, i)),
    });
  }
  items.push({
    label: `Move ${fieldLabel} up`,
    onClick: () => onSortsChange(swap(sorts, i, i - 1)),
    disabled: i === 0,
  });
  items.push({
    label: `Move ${fieldLabel} down`,
    onClick: () => onSortsChange(swap(sorts, i, i + 1)),
    disabled: i === sorts.length - 1,
  });
  if (i !== 0) {
    items.push({
      label: `Remove the ${fieldLabel} sort`,
      onClick: () => onSortsChange(sorts.filter((_, j) => j !== i)),
      danger: true,
    });
  }
  return items;
}

function SortDirectionControl({
  s,
  i,
  sorts,
  onSortsChange,
}: {
  s: SortEntry;
  i: number;
  sorts: SortEntry[];
  onSortsChange: (next: SortEntry[]) => void;
}) {
  const field = SORT_FIELDS.find((f) => f.value === s.field);
  const dirLabels = field?.dirLabels ?? (['Ascending', 'Descending'] as [string, string]);
  const dirShort = field?.dirShort ?? dirLabels;

  const options: Option<SortDir>[] = (['asc', 'desc'] as const).map((dir, idx) => ({
    value: dir,
    ariaLabel: `Sort ${i + 1} direction: ${dirLabels[idx]}`,
    label:
      s.field === 'color' && dir === 'asc' ? (
        <span className="sort-editor-color-pips" aria-hidden>
          {(['W', 'U', 'B', 'R', 'G'] as const).map((c) => (
            <ColorPip key={c} color={c} />
          ))}
        </span>
      ) : (
        <>
          <span className="dir-label-long">{dirLabels[idx]}</span>
          <span className="dir-label-short">{dirShort[idx]}</span>
        </>
      ),
  }));

  return (
    <SegmentedControl
      ariaLabel={`Sort ${i + 1} direction`}
      value={s.dir}
      options={options}
      onChange={(dir) => onSortsChange(sorts.map((x, j) => (j === i ? { ...x, dir } : x)))}
    />
  );
}

function ImplicitTiebreakerHint({
  sorts,
  valueOrders,
  onSortsChange,
}: {
  sorts: SortEntry[];
  valueOrders: ValueOrders;
  onSortsChange: (next: SortEntry[]) => void;
}) {
  const extras = getImplicitTiebreakers(sorts);
  if (!extras.length) return null;
  const sentence = describeTiebreakerSentence(extras, valueOrders);
  const changeable = extras.filter((e) => CUSTOMIZABLE_VALUE_ORDER_FIELDS.includes(e.field));
  const canChange = changeable.length > 0 && sorts.length < MAX_SORTS;
  return (
    <p className="muted sort-editor-tiebreakers">
      {sentence}{' '}
      {canChange && (
        <Button
          variant="link"
          className="sort-editor-tiebreakers-change"
          onClick={() =>
            onSortsChange([...sorts, ...changeable.slice(0, MAX_SORTS - sorts.length)])
          }
        >
          Change
        </Button>
      )}
    </p>
  );
}

/**
 * One plain sentence instead of an engine-vocabulary list ("Then tie-broken
 * by: Treatment → Finish → Name"). A customizable field (treatment, finish)
 * reads as its two extreme values ("showcase before regular"); anything else
 * is just named ("then name").
 */
function describeTiebreakerSentence(extras: SortEntry[], valueOrders: ValueOrders): string {
  const clauses = extras.map((e) => {
    if (CUSTOMIZABLE_VALUE_ORDER_FIELDS.includes(e.field)) {
      const order = resolveValueOrder(e.field, valueOrders[e.field]);
      const labels = order.map((k) => getValueLabel(e.field, k).toLowerCase());
      const seq = e.dir === 'desc' ? [...labels].reverse() : labels;
      return `${seq[0]} before ${seq[seq.length - 1]}`;
    }
    const label = SORT_FIELDS.find((f) => f.value === e.field)?.label ?? e.field;
    return label.toLowerCase();
  });
  const last = clauses[clauses.length - 1];
  const rest = clauses.slice(0, -1);
  const body = rest.length ? `${rest.join(', ')}, then ${last}` : `then ${last}`;
  return `Copies that still tie: ${body}.`;
}

/** Swap two array elements; out-of-bounds indices return the array unchanged. */
function swap<T>(arr: T[], i: number, j: number): T[] {
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Move the element at `i` to the front, keeping everything else in order. */
function moveToFront<T>(arr: T[], i: number): T[] {
  const copy = [...arr];
  const [item] = copy.splice(i, 1);
  copy.unshift(item);
  return copy;
}

/** Pick a sort entry for a freshly-added row — the first field not already used, or 'name'. */
function nextDefaultSort(existing: SortEntry[]): SortEntry {
  for (const opt of SORT_FIELDS) {
    if (!existing.some((e) => e.field === opt.value)) {
      return { field: opt.value, dir: opt.defaultDir };
    }
  }
  return { field: 'name', dir: 'asc' };
}
