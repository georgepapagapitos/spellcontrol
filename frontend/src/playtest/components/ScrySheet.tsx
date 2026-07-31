import { useId, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeft, ArrowRight, Minus, Plus } from 'lucide-react';
import './ScrySheet.css';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import type { PlaytestCard, ScryMode } from '@/lib/playtest';

/** Where a peeked card currently sits in the sheet: kept on top, or sent to
 *  the mode's away destination (bottom of library / graveyard). */
type ColumnId = 'top' | 'away';

export interface ScryResolution {
  mode: ScryMode;
  top: string[];
  bottom?: string[];
  graveyard?: string[];
}

interface Props {
  library: PlaytestCard[];
  /** Mode the sheet opens on; the user can switch without reopening. */
  initialMode?: ScryMode;
  onClose(): void;
  onResolve(resolution: ScryResolution): void;
}

const MODES: ScryMode[] = ['scry', 'surveil', 'mill'];

const MODE_LABEL: Record<ScryMode, string> = {
  scry: 'Scry',
  surveil: 'Surveil',
  mill: 'Mill',
};

const MODE_HINT: Record<ScryMode, string> = {
  scry: 'Keep cards on top, or send them to the bottom of your library.',
  surveil: 'Keep cards on top, or put them into your graveyard.',
  mill: 'Cards go to your graveyard — drag any back to keep it on top.',
};

/** Away-column heading per mode. */
const AWAY_LABEL: Record<ScryMode, string> = {
  scry: 'Bottom of library',
  surveil: 'Graveyard',
  mill: 'Graveyard',
};

const MAX_PEEK = 10;

/**
 * Arena-style two-column resolution for scry / surveil / mill (E226).
 *
 * The three are one operation — look at the top N and redistribute it — so
 * they share this sheet and the reducer's single `RESOLVE_TOP` action; the
 * mode only decides the away column's destination and which side the peeked
 * cards start on. Order within each column is meaningful (top of library and
 * bottom of library are both ordered), which is why this is a drag-**sort**
 * rather than a pair of checkboxes.
 *
 * Drag is the enhancement, not the mechanism: every card also carries an
 * explicit move button, so touch and keyboard users never need a
 * cross-container drag (which dnd-kit's KeyboardSensor handles poorly).
 */
export function ScrySheet({ library, initialMode = 'scry', onClose, onResolve }: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  useLockBodyScroll();
  useEscapeKey(beginClose);
  const modeName = useId();

  const maxPeek = Math.min(MAX_PEEK, library.length);
  const [mode, setMode] = useState<ScryMode>(initialMode);
  const [count, setCount] = useState(() => Math.min(1, maxPeek));
  const [activeId, setActiveId] = useState<string | null>(null);

  const peeked = useMemo(() => library.slice(0, count), [library, count]);
  const byId = useMemo(() => new Map(peeked.map((c) => [c.id, c])), [peeked]);

  // Changing mode or count re-deals the columns (mill starts everything in the
  // graveyard column; scry/surveil start everything on top). Render-phase
  // derived-state reset, the same pattern OpeningHandSheet uses for its
  // drag order — a `useEffect` here would flash the stale split for a frame.
  const signature = `${mode}:${peeked.map((c) => c.id).join('|')}`;
  const dealColumns = (): Record<ColumnId, string[]> => {
    const ids = peeked.map((c) => c.id);
    return mode === 'mill' ? { top: [], away: ids } : { top: ids, away: [] };
  };
  const [columns, setColumns] = useState<Record<ColumnId, string[]>>(dealColumns);
  const [trackedSignature, setTrackedSignature] = useState(signature);
  if (trackedSignature !== signature) {
    setTrackedSignature(signature);
    setColumns(dealColumns());
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function columnOf(cols: Record<ColumnId, string[]>, id: string): ColumnId | null {
    if (cols.top.includes(id)) return 'top';
    if (cols.away.includes(id)) return 'away';
    return null;
  }

  function move(cardId: string, to: ColumnId) {
    setColumns((prev) => {
      const from: ColumnId = to === 'top' ? 'away' : 'top';
      if (!prev[from].includes(cardId)) return prev;
      return {
        ...prev,
        [from]: prev[from].filter((id) => id !== cardId),
        [to]: [...prev[to], cardId],
      };
    });
  }

  function handleDragOver(event: DragOverEvent) {
    const dragged = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;
    setColumns((prev) => {
      const from = columnOf(prev, dragged);
      const to = overId.startsWith('col:') ? (overId.slice(4) as ColumnId) : columnOf(prev, overId);
      if (!from || !to || from === to) return prev;
      const dest = prev[to].slice();
      const overIndex = dest.indexOf(overId);
      dest.splice(overIndex === -1 ? dest.length : overIndex, 0, dragged);
      return { ...prev, [from]: prev[from].filter((id) => id !== dragged), [to]: dest };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const dragged = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || overId === dragged) return;
    // Cross-column moves already happened in onDragOver; all that's left is
    // reordering within the column the card ended up in.
    setColumns((prev) => {
      const col = columnOf(prev, dragged);
      if (!col || !prev[col].includes(overId)) return prev;
      return {
        ...prev,
        [col]: arrayMove(prev[col], prev[col].indexOf(dragged), prev[col].indexOf(overId)),
      };
    });
  }

  function handleConfirm() {
    onResolve(
      mode === 'scry'
        ? { mode, top: columns.top, bottom: columns.away }
        : { mode, top: columns.top, graveyard: columns.away }
    );
    beginClose();
  }

  const confirmLabel =
    mode === 'mill' ? `Mill ${columns.away.length}` : `${MODE_LABEL[mode]} ${peeked.length}`;
  const activeCard = activeId ? byId.get(activeId) : undefined;

  return (
    <div className="card-picker-root" role="presentation" onClick={() => beginClose()}>
      <div className="card-picker-backdrop" />
      <div
        className={`card-picker-sheet playtest-scry-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="playtest-scry-title"
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 id="playtest-scry-title" className="card-picker-title">
            Top of library
          </h2>
          <fieldset className="playtest-scry-modes" aria-label="Action">
            {MODES.map((m) => (
              <label key={m} className={`playtest-scry-mode${m === mode ? ' is-active' : ''}`}>
                <input
                  type="radio"
                  name={modeName}
                  checked={m === mode}
                  onChange={() => setMode(m)}
                />
                <span>{MODE_LABEL[m]}</span>
              </label>
            ))}
          </fieldset>
          <div className="playtest-scry-count">
            <button
              type="button"
              className="playtest-scry-step"
              onClick={() => setCount((c) => Math.max(1, c - 1))}
              disabled={count <= 1}
              aria-label="Look at one fewer card"
            >
              <Minus width={16} height={16} aria-hidden />
            </button>
            <span className="playtest-scry-count__value" aria-live="polite">
              {peeked.length} card{peeked.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              className="playtest-scry-step"
              onClick={() => setCount((c) => Math.min(maxPeek, c + 1))}
              disabled={count >= maxPeek}
              aria-label="Look at one more card"
            >
              <Plus width={16} height={16} aria-hidden />
            </button>
          </div>
          <p className="playtest-scry-hint">{MODE_HINT[mode]}</p>
        </div>

        {peeked.length === 0 ? (
          <p className="playtest-scry-empty">Your library is empty.</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <div className="playtest-scry-columns">
              <ScryColumn
                id="top"
                heading="Top of library"
                sub="First card drawn is at the top"
                ids={columns.top}
                byId={byId}
                moveLabel={`Move to ${AWAY_LABEL[mode].toLowerCase()}`}
                moveIcon="right"
                onMove={(cardId) => move(cardId, 'away')}
              />
              <ScryColumn
                id="away"
                heading={AWAY_LABEL[mode]}
                sub={mode === 'scry' ? 'Goes under your library, in this order' : undefined}
                ids={columns.away}
                byId={byId}
                moveLabel="Move to top of library"
                moveIcon="left"
                onMove={(cardId) => move(cardId, 'top')}
              />
            </div>
            <DragOverlay dropAnimation={null}>
              {activeCard && <ScryCardFace card={activeCard} dragging />}
            </DragOverlay>
          </DndContext>
        )}

        <div className="card-picker-footer">
          <button type="button" className="btn" onClick={() => beginClose()}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={peeked.length === 0}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ColumnProps {
  id: ColumnId;
  heading: string;
  sub?: string;
  ids: string[];
  byId: Map<string, PlaytestCard>;
  moveLabel: string;
  moveIcon: 'left' | 'right';
  onMove(cardId: string): void;
}

function ScryColumn({ id, heading, sub, ids, byId, moveLabel, moveIcon, onMove }: ColumnProps) {
  // Droppable in its own right so an emptied column can still receive a drop —
  // a SortableContext with no items has nothing to collide with.
  const { setNodeRef, isOver } = useDroppable({ id: `col:${id}` });
  return (
    <section className={`playtest-scry-column${isOver ? ' is-over' : ''}`}>
      <h3 className="playtest-scry-column__heading">{heading}</h3>
      {sub && <p className="playtest-scry-column__sub">{sub}</p>}
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="playtest-scry-list" aria-label={heading}>
          {ids.length === 0 && (
            <li className="playtest-scry-list__empty" aria-hidden>
              Drop cards here
            </li>
          )}
          {ids.map((cardId, index) => {
            const card = byId.get(cardId);
            if (!card) return null;
            return (
              <SortableScryCard
                key={cardId}
                card={card}
                position={index + 1}
                total={ids.length}
                columnLabel={heading}
                moveLabel={moveLabel}
                moveIcon={moveIcon}
                onMove={onMove}
              />
            );
          })}
        </ul>
      </SortableContext>
    </section>
  );
}

interface SortableCardProps {
  card: PlaytestCard;
  position: number;
  total: number;
  columnLabel: string;
  moveLabel: string;
  moveIcon: 'left' | 'right';
  onMove(cardId: string): void;
}

function SortableScryCard({
  card,
  position,
  total,
  columnLabel,
  moveLabel,
  moveIcon,
  onMove,
}: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });
  return (
    <li
      ref={setNodeRef}
      className={`playtest-scry-card${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div
        className="playtest-scry-card__grip"
        {...attributes}
        {...listeners}
        aria-label={`${card.name} — ${columnLabel}, position ${position} of ${total}`}
      >
        <ScryCardFace card={card} />
      </div>
      <button
        type="button"
        className="playtest-scry-card__move"
        onClick={() => onMove(card.id)}
        aria-label={`${card.name}: ${moveLabel}`}
      >
        {moveIcon === 'right' ? (
          <ArrowRight width={16} height={16} aria-hidden />
        ) : (
          <ArrowLeft width={16} height={16} aria-hidden />
        )}
      </button>
    </li>
  );
}

function ScryCardFace({ card, dragging }: { card: PlaytestCard; dragging?: boolean }) {
  const [imgError, setImgError] = useState(false);
  return (
    <div className={`playtest-scry-face${dragging ? ' is-dragging-overlay' : ''}`}>
      {card.imageUrl && !imgError ? (
        <img
          src={card.imageUrl}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="playtest-scry-face__placeholder">{card.name}</span>
      )}
      <span className="playtest-scry-face__name">{card.name}</span>
    </div>
  );
}
