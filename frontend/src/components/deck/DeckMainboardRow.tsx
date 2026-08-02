// Mainboard/sideboard list-view rendering: the section wrapper
// (CategorySection) and the individual card row (DeckCardRow). Split out of
// DeckDisplay.tsx purely to shrink the file — no logic changes. Named
// DeckMainboardRow (not DeckCardRow) because components/deck/DeckCardRow.tsx
// already exists as an unrelated swap-suggestion row component — the
// `DeckCardRow` function name itself is unchanged, only the file differs.
import { useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  GripVertical,
  Handshake,
  Minus,
  MoreVertical,
  Plus,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useListFlip, prefersReducedMotion } from '@/lib/use-list-flip';
import { reorderIndexForMove } from '@/lib/deck-reorder';
import { classifyInclusion, OFFMETA_TOOLTIP } from '@/lib/inclusion-label';
import { setSymbolTitle } from '@/lib/set-symbols';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import { getMaxCopies, type LegalityIssue } from '../../lib/deck-validation';
import { getRoleBadge, type RoleKey } from '../../lib/role-badges';
import { formatMoney } from '../../lib/format-money';
import { MeterBar } from '../shared/MeterBar';
import { SetSymbol } from '../shared/SetSymbol';
import { ManaCost } from '../ManaCost';
import { FoilBadge } from '../FoilBadge';
import { InfoTip } from '../InfoTip';
import { ToolbarPopover } from '../shared/ToolbarPopover';
import { ComboBadge } from './ComboBadge';
import {
  resolveInclusionPct,
  cardFilterRoles,
  frontFaceMana,
  allocationAriaLabel,
  allocationTitle,
  frontFaceImage,
  frontFaceImageLarge,
  type Row,
  type CurrencyCode,
  type ShowPrefs,
} from './deck-display-rows';
import { SectionIcon, AllocationChip } from './deck-display-icons';
import { RoleBadge, LegalityBadge } from './deck-display-icons';

// ── Category section ──────────────────────────────────────────────────────
export function CategorySection({
  title,
  icon,
  rows,
  currency,
  showPrefs,
  onRowClick,
  onRemoveCard,
  onSetQty,
  isSingleton,
  onEditCard,
  roleFilter,
  legalityBySlot,
  onMoveToSideboard,
  onMoveToMainboard,
  onMoveToConsidering,
  onMakeCommander,
  canMakeCommander,
  onMakePartner,
  canMakePartner,
  onMoveToAnotherDeck,
  onReleaseCopy,
  onUseOwnCopy,
  headerAction,
  synergyByName,
  cardInclusionMap,
  combosByOracle,
  cardProvenance,
  target,
  selectMode,
  isRowSelected,
  onToggleRowSelected,
  dragEnabled,
  onReorder,
}: {
  title: string;
  icon: string;
  rows: Row[];
  /** Target count for this bucket's header gauge (category view only). */
  target?: number;
  currency: CurrencyCode;
  showPrefs: ShowPrefs;
  onRowClick: (name: string) => void;
  onRemoveCard?: (slotId: string) => void;
  onSetQty?: (card: ScryfallCard, qty: number, opts?: { relative?: boolean }) => void;
  /** Format's singleton-ness — gates the qty stepper (see DeckCardRow). */
  isSingleton?: boolean;
  onEditCard?: (slotId: string, card: ScryfallCard) => void;
  /** Active role filter — rows not filling it render dimmed. */
  roleFilter?: RoleKey | null;
  legalityBySlot?: Map<string, LegalityIssue>;
  onMoveToSideboard?: (slotIds: string[]) => void;
  onMoveToMainboard?: (slotIds: string[]) => void;
  /** Mainboard-only: park one or more copies of a row in Considering (E122),
   *  as an extra row-menu action alongside (not instead of) onMoveToSideboard. */
  onMoveToConsidering?: (slotIds: string[]) => void;
  onMakeCommander?: (slotId: string, card: ScryfallCard) => void;
  canMakeCommander?: (card: ScryfallCard) => boolean;
  onMakePartner?: (slotId: string, card: ScryfallCard) => void;
  canMakePartner?: (card: ScryfallCard) => boolean;
  onMoveToAnotherDeck?: (card: ScryfallCard) => void;
  onReleaseCopy?: (card: ScryfallCard) => void;
  onUseOwnCopy?: (card: ScryfallCard) => void;
  /** Optional control rendered at the end of the section header (e.g. the
   *  Commander section's "Add/Edit partner" button). */
  headerAction?: React.ReactNode;
  synergyByName?: Map<string, string[]>;
  cardInclusionMap?: Record<string, number>;
  /** Every combo each in-deck card participates in, keyed by oracle id — see
   *  the doc on DeckDisplayProps.combosByOracle. */
  combosByOracle?: Map<string, ComboMatch[]>;
  /** Per-card "why is this here" reason (S2), keyed by card name. */
  cardProvenance?: Record<string, string>;
  /** E172 multi-select — a row's checkbox replaces tap-to-preview when true. */
  selectMode?: boolean;
  isRowSelected?: (row: Row) => boolean;
  onToggleRowSelected?: (row: Row) => void;
  /** E172 manual reorder — drag handles render only when true (sort==='custom'
   *  AND list view; see DeckDisplay). Mutually exclusive with selectMode in
   *  the UI (both want the row's leading slot) — selectMode wins. */
  dragEnabled?: boolean;
  onReorder?: (slotIds: string[], sortIndex: number) => void;
}) {
  // Hooks must run unconditionally — keep them above the empty-section early
  // return (a section emptying from N→0 cards would otherwise change the hook
  // count between renders and crash).
  const listRef = useRef<HTMLUListElement | null>(null);
  const { entries, registerItem, onExitEnd } = useListFlip(rows, (r) => r.name, listRef);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [activeDragName, setActiveDragName] = useState<string | null>(null);
  // Plain closures over `rows` — re-created fresh every render (like every
  // other inline handler in this file), so they always see the current row
  // order without needing a ref kept in sync during render.
  const handleDragEnd = (e: DragEndEvent) => {
    setActiveDragName(null);
    const { active, over } = e;
    if (!over || active.id === over.id || !onReorder) return;
    const fromIndex = rows.findIndex((r) => r.name === active.id);
    const toIndex = rows.findIndex((r) => r.name === over.id);
    if (fromIndex === -1 || toIndex === -1) return;
    const sortIndex = reorderIndexForMove(rows, fromIndex, toIndex);
    onReorder(rows[fromIndex].slotIds, sortIndex);
  };
  const dragAnnouncements: Announcements = {
    onDragStart: ({ active }) => {
      const idx = rows.findIndex((r) => r.name === active.id);
      return `Picked up ${active.id}, position ${idx + 1} of ${rows.length}.`;
    },
    onDragOver: ({ active, over }) => {
      if (!over) return `${active.id} is no longer over a droppable position.`;
      const idx = rows.findIndex((r) => r.name === over.id);
      return `${active.id} moved to position ${idx + 1} of ${rows.length}.`;
    },
    onDragEnd: ({ active, over }) => {
      if (!over) return `${active.id} was not moved.`;
      const idx = rows.findIndex((r) => r.name === over.id);
      return `${active.id} dropped at position ${idx + 1} of ${rows.length}.`;
    },
    onDragCancel: ({ active }) => `Reordering ${active.id} was cancelled.`,
  };

  // A bucket with no rows still renders when it carries a target (the 0/N
  // gap story) — see groupByCategory. Type-mode buckets never set `target`,
  // so this is a no-op there — byte-identical to the pre-E124 early return.
  if (rows.length === 0 && target === undefined) return null;
  const subtotal = rows.reduce((sum, r) => sum + r.price, 0);
  const count = rows.reduce((sum, r) => sum + r.qty, 0);

  const listEl = (
    <ul className="deck-section-rows" ref={listRef}>
      {entries.map((entry) => (
        <DeckCardRow
          key={entry.key}
          row={entry.item}
          currency={currency}
          showPrefs={showPrefs}
          onClick={() => onRowClick(entry.item.name)}
          onRemoveCard={entry.leaving ? undefined : onRemoveCard}
          onSetQty={entry.leaving ? undefined : onSetQty}
          isSingleton={isSingleton}
          onEditCard={entry.leaving ? undefined : onEditCard}
          roleFilter={roleFilter}
          legalityIssue={legalityBySlot?.get(entry.item.legalitySlotKey ?? entry.item.slotIds[0])}
          onMoveToZone={entry.leaving ? undefined : (onMoveToSideboard ?? onMoveToMainboard)}
          moveZone={onMoveToSideboard ? 'sideboard' : onMoveToMainboard ? 'mainboard' : undefined}
          onMoveToConsidering={entry.leaving ? undefined : onMoveToConsidering}
          onMakeCommander={entry.leaving ? undefined : onMakeCommander}
          canMakeCommander={canMakeCommander}
          onMakePartner={entry.leaving ? undefined : onMakePartner}
          canMakePartner={canMakePartner}
          onMoveToAnotherDeck={entry.leaving ? undefined : onMoveToAnotherDeck}
          onReleaseCopy={entry.leaving ? undefined : onReleaseCopy}
          onUseOwnCopy={entry.leaving ? undefined : onUseOwnCopy}
          synergyReasons={synergyByName?.get(entry.item.card.name)}
          inclusionPct={resolveInclusionPct(cardInclusionMap, entry.item)}
          combos={
            entry.item.card.oracle_id ? combosByOracle?.get(entry.item.card.oracle_id) : undefined
          }
          provenanceReason={cardProvenance?.[entry.item.card.name]}
          entering={entry.entering}
          leaving={entry.leaving}
          leavingStyle={entry.leaving ? entry.style : undefined}
          itemRef={(el) => registerItem(entry.key, el)}
          onLeavingAnimationEnd={() => onExitEnd(entry.key)}
          selectMode={!entry.leaving && selectMode}
          selected={!entry.leaving && isRowSelected?.(entry.item)}
          onToggleSelected={
            entry.leaving || !onToggleRowSelected
              ? undefined
              : () => onToggleRowSelected(entry.item)
          }
          dragEnabled={!entry.leaving && !selectMode && dragEnabled}
        />
      ))}
    </ul>
  );

  return (
    <section className="deck-section">
      <header className="deck-section-header">
        <span className="deck-section-icon">
          <SectionIcon icon={icon} />
        </span>
        {/* A <div> (MeterBar's root) can't nest inside <h3> — phrasing content
            only — so the gauge is a sibling of the heading, both wrapped
            together as the single grid-column-occupying title cell. */}
        <div className="deck-section-title-row">
          {/* tabIndex=-1: not in tab order, but a programmatic focus target —
              the qty stepper's decrement-to-zero focus handoff falls back
              here when the row it removes has no sibling row left. */}
          <h3 className="deck-section-title" tabIndex={-1}>
            {title}{' '}
            <span className="deck-section-count">
              ({count}
              {target !== undefined ? ` / ${target}` : ''})
            </span>
          </h3>
          {target !== undefined && (
            <MeterBar
              value={count}
              max={Math.max(target, count)}
              size="sm"
              role="meter"
              label={`${title}: ${count} of ${target}`}
              className="deck-section-gauge"
            />
          )}
        </div>
        {showPrefs.price && (
          <span className="deck-section-subtotal">{formatMoney(subtotal, { currency })}</span>
        )}
        {headerAction}
      </header>
      {dragEnabled ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={{ announcements: dragAnnouncements }}
          onDragStart={(e: DragStartEvent) => setActiveDragName(String(e.active.id))}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDragName(null)}
        >
          <SortableContext items={rows.map((r) => r.name)} strategy={verticalListSortingStrategy}>
            {listEl}
          </SortableContext>
          <DragOverlay dropAnimation={prefersReducedMotion() ? null : undefined}>
            {activeDragName ? (
              <span className="deck-row-drag-overlay">{activeDragName}</span>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        listEl
      )}
    </section>
  );
}

function DeckCardRow({
  row,
  currency,
  showPrefs,
  onClick,
  onRemoveCard,
  onSetQty,
  isSingleton,
  onEditCard,
  roleFilter,
  legalityIssue,
  onMoveToZone,
  moveZone,
  onMoveToConsidering,
  onMakeCommander,
  canMakeCommander,
  onMakePartner,
  canMakePartner,
  onMoveToAnotherDeck,
  onReleaseCopy,
  onUseOwnCopy,
  synergyReasons,
  inclusionPct,
  combos,
  provenanceReason,
  entering,
  leaving,
  leavingStyle,
  itemRef,
  onLeavingAnimationEnd,
  selectMode,
  selected,
  onToggleSelected,
  dragEnabled,
}: {
  row: Row;
  currency: CurrencyCode;
  showPrefs: ShowPrefs;
  onClick: () => void;
  onRemoveCard?: (slotId: string) => void;
  onSetQty?: (card: ScryfallCard, qty: number, opts?: { relative?: boolean }) => void;
  /** Format's singleton-ness — gates the +/− stepper via getMaxCopies. */
  isSingleton?: boolean;
  onEditCard?: (slotId: string, card: ScryfallCard) => void;
  /** Active role filter — this row dims when it doesn't fill the role. */
  roleFilter?: RoleKey | null;
  legalityIssue?: LegalityIssue;
  /** Move the given copies to the other zone. One copy, or the row's whole stack. */
  onMoveToZone?: (slotIds: string[]) => void;
  /** The destination zone — names the move menu items. */
  moveZone?: 'sideboard' | 'mainboard';
  /** Mainboard-only extra move action: park copies in Considering (E122),
   *  alongside (never replacing) the onMoveToZone/moveZone pair above. */
  onMoveToConsidering?: (slotIds: string[]) => void;
  onMakeCommander?: (slotId: string, card: ScryfallCard) => void;
  canMakeCommander?: (card: ScryfallCard) => boolean;
  onMakePartner?: (slotId: string, card: ScryfallCard) => void;
  canMakePartner?: (card: ScryfallCard) => boolean;
  onMoveToAnotherDeck?: (card: ScryfallCard) => void;
  onReleaseCopy?: (card: ScryfallCard) => void;
  onUseOwnCopy?: (card: ScryfallCard) => void;
  synergyReasons?: string[];
  /** EDHREC inclusion rate (0–100) for this card; renders a subtle chip when set. */
  inclusionPct?: number;
  /** Every combo this row's card participates in (in-deck or one-away) —
   *  drives the inline "CB"/"CB2" badge. Undefined/empty renders nothing. */
  combos?: ComboMatch[];
  /** Per-card "why is this here" reason (S2) — folded into whichever of the
   *  synergy/inclusion tooltips above renders for this row. Undefined for
   *  manual adds and decks generated before this shipped. */
  provenanceReason?: string;
  /** True on the commit this key first appears — drives the enter keyframe. */
  entering?: boolean;
  /** True when this row is a ghost playing its leave animation. */
  leaving?: boolean;
  /** Inline style pinning the ghost at its last in-flow top offset (absolute). */
  leavingStyle?: React.CSSProperties;
  /** Callback ref forwarded to the root <li> for FLIP measurement. */
  itemRef?: (el: HTMLLIElement | null) => void;
  /** Called on animationend to drop the ghost. */
  onLeavingAnimationEnd?: () => void;
  /** E172 multi-select — when true, tap/Enter/Space toggles selection instead
   *  of opening the card preview, and a checkbox renders in the leading slot. */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
  /** E172 manual reorder — renders the drag handle (pointer + keyboard) in
   *  the leading slot. Never true at the same time as selectMode. */
  dragEnabled?: boolean;
}) {
  const roleBadge = showPrefs.roles ? getRoleBadge(row.card) : null;
  const mana = showPrefs.mana ? frontFaceMana(row.card) : undefined;
  const canRemove = !!onRemoveCard && row.slotIds.length > 0;
  const canEditQty = !!onSetQty && row.slotIds.length > 0;
  // Stepper only earns its place when a second copy is actually legal — on a
  // singleton nonbasic it's pure UI noise (Commander/Brawl/PDH). Basics and
  // any "any number" card (getMaxCopies) still get it everywhere.
  const maxCopies = getMaxCopies(row.card, isSingleton ?? true);
  const atCap = row.qty >= maxCopies;
  const showStepper = canEditQty && maxCopies > 1;
  const [editingQty, setEditingQty] = useState(false);
  // Only stacks that actually span >1 printing get an expand affordance — a
  // uniform "Mountain ×22" has nothing to reveal.
  const multiPrinting = row.printings.length > 1;
  const [expanded, setExpanded] = useState(false);
  const subListId = `printings-${row.slotIds[0] ?? row.name}`;

  const handleRemoveOne = (e: React.MouseEvent | React.KeyboardEvent, close: () => void) => {
    e.stopPropagation();
    close();
    if (canRemove) onRemoveCard!(row.slotIds[row.slotIds.length - 1]);
  };
  const handleRemoveAll = (e: React.MouseEvent, close: () => void) => {
    e.stopPropagation();
    close();
    // Prefer the bulk path so the host can show one undo toast for the whole batch.
    if (canEditQty) onSetQty!(row.card, 0);
    else if (canRemove) {
      for (const slotId of [...row.slotIds].reverse()) onRemoveCard!(slotId);
    }
  };
  const startEditQty = (e: React.MouseEvent) => {
    if (!canEditQty) return;
    e.stopPropagation();
    setEditingQty(true);
  };
  const commitQty = (raw: string) => {
    setEditingQty(false);
    if (!canEditQty) return;
    const parsed = Math.floor(Number(raw));
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(0, Math.min(99, parsed));
    if (clamped !== row.qty) onSetQty!(row.card, clamped);
  };

  // ── Manual reorder (E172) ─────────────────────────────────────────────
  // Always called (rules of hooks) — CategorySection always wraps its list
  // in a DndContext/SortableContext, `dragEnabled` just gates whether the
  // handle renders (so a section not in 'custom' sort mode has an inert,
  // harmless sortable context, not a missing one). Deliberately does NOT
  // apply `transform`/`transition` to the row's own style — that's
  // `useListFlip`'s job (it already animates row position via imperative
  // DOM writes on this exact node for add/remove/reorder), and having two
  // systems fight over the same inline `transform` would produce visible
  // jank. The live drag visual is the floating DragOverlay clone instead;
  // this row just dims while it's the one being dragged.
  const sortable = useSortable({ id: row.name });
  const rowIsDragging = dragEnabled && sortable.isDragging;

  // ── +/− stepper ────────────────────────────────────────────────────────
  // liRef backs the decrement-to-zero focus handoff below; itemRef is the
  // FLIP measurement callback the host already passes — both need the node.
  const liRef = useRef<HTMLLIElement | null>(null);
  const setLiRef = (el: HTMLLIElement | null) => {
    liRef.current = el;
    itemRef?.(el);
    sortable.setNodeRef(el);
  };
  // Local in-flight guard (defense in depth): the relative-delta call below
  // is what actually prevents a dropped update on a rapid double-tap (it
  // never reads the stale `row.qty` closure), but disabling the buttons for
  // one frame after a tap also blocks a literal duplicate event (some
  // touchscreens fire click twice for one tap) from applying twice.
  const [stepBusy, setStepBusy] = useState(false);
  // On the tap that takes qty to 0, the row unmounts after its leave
  // animation — move focus to a sibling row's own control (or the section
  // header if this was the last row) now, before the browser can drop focus
  // to <body> once the node disappears.
  const focusOffRowBeforeRemoval = () => {
    const li = liRef.current;
    if (!li) return;
    const list = li.closest('.deck-section-rows');
    const siblingRows = list ? Array.from(list.querySelectorAll<HTMLElement>('.deck-row')) : [];
    const idx = siblingRows.indexOf(li);
    const target = siblingRows[idx + 1] ?? siblingRows[idx - 1];
    const control = target?.querySelector<HTMLElement>('.deck-row-qty-step, .deck-row-qty-edit');
    (
      control ??
      target ??
      li.closest('.deck-section')?.querySelector<HTMLElement>('.deck-section-title')
    )?.focus();
  };
  const step = (delta: number) => {
    if (!onSetQty || stepBusy) return;
    if (delta < 0 && row.qty <= 1) focusOffRowBeforeRemoval();
    setStepBusy(true);
    onSetQty(row.card, delta, { relative: true });
    requestAnimationFrame(() => setStepBusy(false));
  };

  // Role-filter lens: non-matching rows dim in place (layout preserved) so the
  // matching cards pop and the eye can jump between them.
  const roleDimmed = !!roleFilter && !cardFilterRoles(row.card).includes(roleFilter);

  const rowClass =
    `deck-row` +
    (entering ? ' is-entering' : '') +
    (leaving ? ' is-leaving' : '') +
    (roleDimmed ? ' is-role-dimmed' : '') +
    (multiPrinting && expanded ? ' is-expanded' : '') +
    (selectMode ? ' is-selectable' : '') +
    (selected ? ' is-selected' : '') +
    (rowIsDragging ? ' is-dragging' : '');

  // Select mode reroutes the whole-row tap/Enter/Space from "open preview"
  // to "toggle selection" — the row's existing click/keyboard contract,
  // just pointed at a different handler, so nothing about the carousel or
  // the row's own buttons (which already stopPropagation) needs to change.
  const rowActivate = selectMode && onToggleSelected ? onToggleSelected : onClick;

  // Shared between the plain and stepper-flanked layouts below so the two
  // never drift — the number itself is the live region (aria-atomic so a
  // screen reader reads the new count whole, not digit-by-digit).
  const qtyChip = (
    <button
      type="button"
      className={`deck-row-qty deck-row-qty-edit${row.status !== 'allocated' ? ' deck-row-qty-missing' : ''}`}
      aria-label={allocationAriaLabel(row, { editable: true })}
      title={allocationTitle(row, { editable: true })}
      onClick={startEditQty}
    >
      <span aria-live="polite" aria-atomic="true">
        {row.qty}
      </span>
    </button>
  );

  return (
    <>
      <li
        className={rowClass}
        data-peek-name={row.name}
        onClick={leaving ? undefined : rowActivate}
        role={leaving ? undefined : 'button'}
        tabIndex={leaving ? -1 : 0}
        aria-hidden={leaving ? true : undefined}
        aria-pressed={!leaving && selectMode ? !!selected : undefined}
        aria-label={
          !leaving && selectMode
            ? `${row.name}${selected ? ', selected' : ', not selected'}`
            : undefined
        }
        ref={setLiRef}
        style={leavingStyle}
        onAnimationEnd={leaving ? onLeavingAnimationEnd : undefined}
        onKeyDown={
          leaving
            ? undefined
            : (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  rowActivate();
                }
              }
        }
      >
        {selectMode && (
          <span className="deck-row-select-check" data-checked={!!selected} aria-hidden>
            {selected && <Check width={13} height={13} strokeWidth={3} />}
          </span>
        )}
        {!selectMode && dragEnabled && (
          <button
            type="button"
            className="deck-row-drag-handle"
            aria-label={`Reorder ${row.name}. Press space to pick up, arrow keys to move, space to drop.`}
            onClick={(e) => e.stopPropagation()}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical width={14} height={14} strokeWidth={2} aria-hidden />
          </button>
        )}
        {canEditQty && editingQty ? (
          <input
            type="number"
            min={0}
            max={99}
            autoFocus
            defaultValue={row.qty}
            className={`deck-row-qty-input${row.status !== 'allocated' ? ' deck-row-qty-missing' : ''}`}
            aria-label={`Quantity of ${row.name} in deck`}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitQty(e.currentTarget.value);
              if (e.key === 'Escape') setEditingQty(false);
            }}
            onBlur={(e) => commitQty(e.target.value)}
          />
        ) : canEditQty && showStepper ? (
          <span className="deck-row-qty-group">
            <button
              type="button"
              className="deck-row-qty-step deck-row-qty-step-minus"
              aria-label={`Remove one copy of ${row.name}`}
              disabled={stepBusy}
              onClick={(e) => {
                e.stopPropagation();
                step(-1);
              }}
            >
              <Minus width={11} height={11} strokeWidth={2.6} aria-hidden />
            </button>
            {qtyChip}
            <button
              type="button"
              className="deck-row-qty-step deck-row-qty-step-plus"
              aria-label={`Add one copy of ${row.name}`}
              disabled={stepBusy || atCap}
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
            >
              <Plus width={11} height={11} strokeWidth={2.6} aria-hidden />
            </button>
          </span>
        ) : canEditQty ? (
          qtyChip
        ) : (
          <span
            className={`deck-row-qty${row.status !== 'allocated' ? ' deck-row-qty-missing' : ''}`}
            aria-label={allocationAriaLabel(row, { editable: false })}
            title={allocationTitle(row, { editable: false })}
          >
            {row.qty}
          </span>
        )}
        {showPrefs.roles &&
          (roleBadge ? (
            <RoleBadge card={row.card} variant="row" />
          ) : (
            <span className="deck-row-role-badge deck-row-role-empty" aria-hidden />
          ))}
        <span className="deck-row-name" title={row.card.type_line}>
          <span className="deck-row-name-text" title={row.name}>
            {row.name}
          </span>
          {multiPrinting && (
            <button
              type="button"
              className="deck-row-printings-toggle"
              aria-expanded={expanded}
              aria-controls={subListId}
              aria-label={
                expanded
                  ? `Collapse ${row.name} printings`
                  : `Show ${row.printings.length} printings of ${row.name}`
              }
              title={
                expanded
                  ? `Collapse ${row.name} printings`
                  : `Show ${row.printings.length} printings of ${row.name}`
              }
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
            >
              <span className="deck-row-printings-count">{row.printings.length} printings</span>
              <ChevronDown
                className="deck-row-printings-chevron"
                width={12}
                height={12}
                strokeWidth={2.4}
                aria-hidden
              />
            </button>
          )}
          {row.isPartner && (
            <span className="deck-row-partner-tag" title="Partner commander">
              <Handshake width={12} height={12} strokeWidth={2.4} aria-hidden />
              <span className="deck-row-partner-label">Partner</span>
            </span>
          )}
          {legalityIssue && <LegalityBadge issue={legalityIssue} className="deck-row-illegal" />}
          {row.foil && <FoilBadge card={row} />}
          {row.card.oracle_id && <ComboBadge oracleId={row.card.oracle_id} matches={combos} />}
          {/* User tags (E171) — always visible when set (never hover-gated,
              unlike the system-derived hints below): a card's own tags are
              user-authored content, and staying visible is exactly what
              makes overlap between tag groups legible in "Group by tag". A
              card with no tags renders nothing here — no clutter for anyone
              who hasn't touched the feature. Editing lives in the card
              preview panel (the single per-card view), not here. */}
          {row.tags.length > 0 && (
            <span className="deck-row-tags" aria-label={`Tags: ${row.tags.join(', ')}`}>
              {row.tags.map((t) => (
                <span key={t} className="deck-row-tag-chip">
                  {t}
                </span>
              ))}
            </span>
          )}
          {/* Secondary metadata (which deck holds the copy, synergy, EDHREC %).
              On hover-capable pointers it's hidden at rest so the card name reads
              fully in the dense multi-column desktop layout, and revealed on row
              hover/focus; on touch (no hover) it stays inline — those rows are
              full-width. Allocation status is still conveyed at rest via the
              dimmed qty cell (deck-row-qty-missing) and the deck-level banner. */}
          <span className="deck-row-hovermeta">
            <AllocationChip row={row} />
            {/* S2: per-card pick provenance folds into whichever of these two
                tooltips already renders for this row, as an extra "Why it's
                here" line — no new always-visible badge, no layout shift, and
                a row with no provenance (manual add, older deck) shows the
                tooltip exactly as before. */}
            {synergyReasons && synergyReasons.length > 0 && (
              <span
                className="deck-row-synergy"
                title={`Synergy with your commander:\n• ${synergyReasons.join('\n• ')}${provenanceReason ? `\n\nWhy it's here: ${provenanceReason}` : ''}`}
                aria-label={`Synergy: ${synergyReasons.join('; ')}`}
              >
                <span className="deck-row-synergy-icon" aria-hidden>
                  ✦
                </span>
              </span>
            )}
            {/* `inclusionPct` is already resolved by `resolveInclusionPct` — nothing
                when the deck has no EDHREC data at all (or this is a basic land),
                otherwise a real number where 0/missing render "Off-meta" rather
                than going silently blank. */}
            {typeof inclusionPct === 'number' &&
              (() => {
                const info = classifyInclusion(inclusionPct);
                return info.kind === 'pct' ? (
                  <span
                    className="deck-row-inclusion"
                    title={`${info.pct}% of EDHREC decks with this commander run this card${provenanceReason ? `\n\nWhy it's here: ${provenanceReason}` : ''}`}
                    aria-label={`EDHREC inclusion ${info.pct} percent`}
                  >
                    {info.pct}%
                  </span>
                ) : (
                  <span
                    className="deck-row-inclusion is-offmeta"
                    title={
                      provenanceReason
                        ? `${OFFMETA_TOOLTIP}\n\nWhy it's here: ${provenanceReason}`
                        : OFFMETA_TOOLTIP
                    }
                  >
                    Off-meta
                  </span>
                );
              })()}
            {/* E120: alt-generator modes (oracle-role/art-theme/historical/PDH —
                Scryfall-driven, no EDHREC data) can record a provenance reason
                for a card that has NEITHER a synergy pill nor an inclusion
                chip, leaving that reason with nowhere to surface. This third
                affordance renders only in that gap — a quiet ⓘ using the
                shared InfoTip (portal, hover/focus/tap, Esc/scroll dismiss) —
                so it adds zero visual noise on a standard EDHREC deck where
                the two chips above already carry the "Why it's here" line. */}
            {provenanceReason &&
              !(synergyReasons && synergyReasons.length > 0) &&
              typeof inclusionPct !== 'number' && (
                <span className="deck-row-provenance">
                  <InfoTip
                    label={`why ${row.name} is in this deck`}
                    ariaLabel={`Why ${row.name} is in this deck`}
                    className="deck-row-provenance-trigger"
                    text={`Why it's here: ${provenanceReason}`}
                  />
                </span>
              )}
          </span>
        </span>
        {showPrefs.mana &&
          (mana ? (
            <ManaCost cost={mana} className="mana-cost-row" />
          ) : (
            <span className="mana-cost-row" aria-hidden />
          ))}
        {showPrefs.price &&
          (row.price > 0 ? (
            <span
              className="deck-row-price"
              title={
                row.qty > 1 ? `${formatMoney(row.price / row.qty, { currency })} each` : undefined
              }
            >
              {formatMoney(row.price, { currency })}
            </span>
          ) : (
            // Unknown/zero price — keep the cell so the menu column stays
            // aligned across rows (mirrors the empty mana-cost placeholder).
            <span className="deck-row-price" aria-hidden />
          ))}
        <ToolbarPopover
          wrapperClassName="deck-row-menu"
          triggerClassName="deck-row-menu-trigger"
          triggerAriaLabel="Card actions"
          haspopup="menu"
          panelClassName="deck-row-menu-popover toolbar-popover-panel--fixed"
          panelRole="menu"
          panelAriaLabel={`Actions for ${row.name}`}
          triggerContent={
            <MoreVertical
              className="deck-row-menu-icon"
              width={14}
              height={14}
              strokeWidth={2}
              aria-hidden
            />
          }
        >
          {(close) => (
            <>
              {onEditCard && row.slotIds.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onEditCard(row.slotIds[0], row.card);
                  }}
                >
                  Edit printing
                </button>
              )}
              {canEditQty && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  // Same ceiling as the "+" stepper (getMaxCopies) — the two
                  // add affordances agree by construction, not by convention.
                  disabled={atCap}
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onSetQty!(row.card, row.qty + 1);
                  }}
                >
                  Add another copy
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="deck-row-menu-item"
                disabled={!canRemove}
                onClick={(e) => handleRemoveOne(e, close)}
              >
                {row.qty > 1 ? 'Remove one copy' : 'Remove from deck'}
              </button>
              {row.qty > 1 && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  disabled={!canRemove && !canEditQty}
                  onClick={(e) => handleRemoveAll(e, close)}
                >
                  Remove all {row.qty} copies
                </button>
              )}
              {onMoveToZone && moveZone && row.slotIds.length > 0 && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="deck-row-menu-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      close();
                      onMoveToZone([row.slotIds[0]]);
                    }}
                  >
                    {row.qty > 1 ? `Move one copy to ${moveZone}` : `Move to ${moveZone}`}
                  </button>
                  {row.qty > 1 && (
                    <button
                      type="button"
                      role="menuitem"
                      className="deck-row-menu-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        close();
                        onMoveToZone(row.slotIds);
                      }}
                    >
                      Move all {row.qty} copies to {moveZone}
                    </button>
                  )}
                </>
              )}
              {onMoveToConsidering && row.slotIds.length > 0 && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="deck-row-menu-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      close();
                      onMoveToConsidering([row.slotIds[0]]);
                    }}
                  >
                    {row.qty > 1 ? 'Move one copy to considering' : 'Move to considering'}
                  </button>
                  {row.qty > 1 && (
                    <button
                      type="button"
                      role="menuitem"
                      className="deck-row-menu-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        close();
                        onMoveToConsidering(row.slotIds);
                      }}
                    >
                      Move all {row.qty} copies to considering
                    </button>
                  )}
                </>
              )}
              {onUseOwnCopy && row.claimedElsewhereQty > 0 && row.slotIds.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onUseOwnCopy(row.card);
                  }}
                >
                  Use my copy
                </button>
              )}
              {onMoveToAnotherDeck && !row.isPartner && row.slotIds.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onMoveToAnotherDeck(row.card);
                  }}
                >
                  Move to another deck…
                </button>
              )}
              {onReleaseCopy && row.allocatedQty > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onReleaseCopy(row.card);
                  }}
                >
                  Release copy
                </button>
              )}
              {onMakeCommander && canMakeCommander?.(row.card) && row.slotIds.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onMakeCommander(row.slotIds[0], row.card);
                  }}
                >
                  Make commander
                </button>
              )}
              {onMakePartner && canMakePartner?.(row.card) && row.slotIds.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  className="deck-row-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onMakePartner(row.slotIds[0], row.card);
                  }}
                >
                  Make partner
                </button>
              )}
            </>
          )}
        </ToolbarPopover>
      </li>
      {multiPrinting && expanded && !leaving && (
        <li className="deck-row-printings-wrap">
          <ul id={subListId} className="deck-row-printings-list">
            {/* Informational rows — they surface the distinct printings the
                stack hides. Changing a printing stays on the aggregated row's
                "Edit printing" / "Use my copy" menu (a per-printing carousel
                deep-link is the deferred follow-up). */}
            {row.printings.map((p) => (
              <li
                key={p.key}
                className="deck-printing-sub"
                data-peek-name={row.name}
                data-peek-img={frontFaceImageLarge(p.card) ?? frontFaceImage(p.card)}
              >
                {/* Per-printing count, in the same left column as the row's
                    aggregate qty — so it reads as a breakdown (7 + 7 + 8 = 22). */}
                <span className="deck-printing-sub-qty">{p.qty}</span>
                <span className="deck-printing-sub-indent" aria-hidden />
                <span className="deck-printing-sub-id">
                  <SetSymbol
                    className="deck-printing-sub-symbol"
                    setCode={p.setCode}
                    rarity={p.rarity}
                    title={setSymbolTitle({
                      setCode: p.setCode,
                      setName: p.setName,
                      collectorNumber: p.collectorNumber,
                      rarity: p.rarity,
                    })}
                  />
                  <span className="deck-printing-sub-set">
                    {(p.setCode || '—').toUpperCase()}
                    {p.collectorNumber && (
                      <span className="deck-printing-sub-cn"> · #{p.collectorNumber}</span>
                    )}
                  </span>
                  {p.foil && (
                    <span
                      className="deck-printing-sub-foil"
                      title={p.finish === 'etched' ? 'Etched foil' : 'Foil'}
                    >
                      {p.finish === 'etched' ? 'Etched' : 'Foil'}
                    </span>
                  )}
                </span>
                <span className="deck-printing-sub-spacer" />
                {p.price > 0 && (
                  <span className="deck-printing-sub-price">
                    {formatMoney(p.price, { currency })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </li>
      )}
    </>
  );
}
