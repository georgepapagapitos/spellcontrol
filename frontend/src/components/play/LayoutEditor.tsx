import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useMemo, useState } from 'react';
import type { GameLayout, GameState } from '../../lib/game-state';
import type { BoardLayout } from '../../lib/board-layouts';
import {
  encodeCustomLayout,
  isCustomLayout,
  layoutsForCount,
  resolveLayout,
} from '../../lib/board-layouts';
import {
  applyPlacement,
  deriveSeam,
  occupancyOf,
  rangeFree,
  rangeFreeRows,
  type Placement,
} from '../../lib/custom-layout';
import { paletteForIndex } from '../../lib/seat-palette';
import { FacingArrow } from './FacingArrow';

// ── Layout picker (board arrangement) ────────────────────────────────────

export function LayoutPicker({
  total,
  current,
  shared,
  onPick,
  onCustomize,
}: {
  total: number;
  current: GameLayout;
  shared: boolean;
  onPick: (layout: GameLayout) => void;
  onCustomize: () => void;
}) {
  const options = layoutsForCount(total);
  const customActive = isCustomLayout(current);
  return (
    <div className="layout-picker" role="group" aria-label="Board layout">
      <div className="layout-picker-grid">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`layout-option ${current === opt.id ? 'is-selected' : ''}`}
            aria-label={`Layout ${opt.id}`}
            aria-pressed={current === opt.id}
            onClick={() => onPick(opt.id)}
          >
            <LayoutPreview layout={opt} shared={shared} />
          </button>
        ))}
        <button
          type="button"
          className={`layout-option layout-option-custom ${customActive ? 'is-selected' : ''}`}
          aria-pressed={customActive}
          onClick={onCustomize}
        >
          {customActive ? (
            <LayoutPreview layout={resolveLayout(total, current)} shared={shared} />
          ) : (
            <span className="layout-option-custom-glyph" aria-hidden="true">
              ⊞
            </span>
          )}
          <span className="layout-option-custom-label">
            {customActive ? 'Custom · edit' : 'Custom…'}
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Mini board preview rendered from the same BoardLayout the real board
 * uses, so the thumbnail can never disagree with the rendered seats. The
 * preview takes the layout's natural aspect ratio (cols × rows) so a 2×2
 * pod renders as a square, a 4×1 line as a wide bar, a 1×2 facing as a
 * tall stack. Each seat shows a facing arrow (its rotation) so the
 * arrangement — and which way each player reads — is legible at a glance.
 */
function LayoutPreview({ layout, shared }: { layout: BoardLayout; shared: boolean }) {
  const seamTop = 'row' in layout.seam ? (layout.seam.row / layout.rows) * 100 : 50;
  const seamLeft = 'col' in layout.seam ? (layout.seam.col / layout.cols) * 100 : 50;
  return (
    <div
      className="layout-option-preview"
      style={{
        gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
        gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
        aspectRatio: `${layout.cols} / ${layout.rows}`,
        ['--seam-top-pct' as never]: `${seamTop}%`,
        ['--seam-left-pct' as never]: `${seamLeft}%`,
      }}
      aria-hidden="true"
    >
      {layout.seats.map((slot, i) => {
        const rot = shared ? slot.rot : 0;
        const palette = paletteForIndex(i);
        return (
          <span
            key={`seat-${i}`}
            className="layout-option-cell"
            style={{
              gridColumn: slot.colSpan ? `${slot.col} / span ${slot.colSpan}` : `${slot.col}`,
              gridRow: slot.rowSpan ? `${slot.row} / span ${slot.rowSpan}` : `${slot.row}`,
              ['--pp-base' as never]: palette.base,
              ['--pp-edge' as never]: palette.edge,
            }}
          >
            {/* The arrow makes the layout's facing legible at a glance —
                pod (arrows meeting), sides (arrows in from L/R), wide row,
                etc. read as distinct instead of four identical "40"s. */}
            <span className="layout-option-cell-face">
              <FacingArrow rot={rot} />
            </span>
            <span className="layout-option-cell-seat">{i + 1}</span>
          </span>
        );
      })}
      {layout.empty?.map((cell, i) => (
        <span
          key={`empty-${i}`}
          className="layout-option-cell is-empty"
          style={{
            gridColumn: cell.colSpan ? `${cell.col} / span ${cell.colSpan}` : `${cell.col}`,
            gridRow: cell.rowSpan ? `${cell.row} / span ${cell.rowSpan}` : `${cell.row}`,
          }}
        />
      ))}
    </div>
  );
}

// ── Custom layout editor ───────────────────────────────────────────────────

const MAX_EDITOR_ROWS = 6;

/**
 * Tap-first (drag-enhanced) grid editor for arranging seats to match the
 * physical table. Output is serialized into the opaque layout id so it
 * persists + syncs online with no server change. Snaps to a 2-column grid
 * — moves reset spans to 1×1 so overlaps are impossible; width/height are
 * re-applied with the guarded toggles.
 */
export function CustomLayoutEditor({
  game,
  onApply,
  onClose,
}: {
  game: GameState;
  onApply: (layout: string) => void;
  onClose: () => void;
}) {
  const count = game.players.length;
  const seed = useMemo(() => resolveLayout(count, game.layout), [count, game.layout]);
  const [rows, setRows] = useState<number>(Math.max(1, Math.min(seed.rows, MAX_EDITOR_ROWS)));
  const [placements, setPlacements] = useState<(Placement | null)[]>(() => {
    const r0 = Math.max(1, Math.min(seed.rows, MAX_EDITOR_ROWS));
    return Array.from({ length: count }, (_, i) => {
      const s = seed.seats[i];
      if (!s) return null;
      const rowSpan = s.rowSpan ?? 1;
      if (s.row + rowSpan - 1 > r0) return null; // doesn't fit the clamped grid
      return {
        col: s.col,
        row: s.row,
        colSpan: s.colSpan ?? 1,
        rowSpan,
        rot: s.rot,
      };
    });
  });
  const [selected, setSelected] = useState<number | null>(null);

  const sensors = useSensors(
    // Small activation distance so a tap selects and only a real drag moves.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const occ = occupancyOf(placements);
  const placedCount = placements.filter(Boolean).length;
  const allPlaced = placedCount === count;

  const placeAt = (seat: number, col: 1 | 2, row: number) => {
    setPlacements((prev) => applyPlacement(prev, seat, col, row));
    setSelected(null);
  };

  const updateSelected = (patch: Partial<Placement>) => {
    if (selected == null) return;
    setPlacements((prev) => prev.map((p, i) => (i === selected && p ? { ...p, ...patch } : p)));
  };

  const sel = selected != null ? placements[selected] : null;
  const canWiden =
    !!sel &&
    sel.col === 1 &&
    sel.colSpan === 1 &&
    rangeFree(occ, 2, sel.row, sel.rowSpan, selected!);
  const canTallen =
    !!sel &&
    sel.rowSpan === 1 &&
    sel.row + 1 <= rows &&
    rangeFreeRows(occ, sel.col, sel.colSpan, sel.row + 1, selected!);

  const onDragEnd = (e: DragEndEvent) => {
    const seat = Number(String(e.active.id).replace('seat-', ''));
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId || !overId.startsWith('cell-')) return;
    const [, c, r] = overId.split('-');
    placeAt(seat, Number(c) as 1 | 2, Number(r));
  };

  const apply = () => {
    if (!allPlaced) return;
    const seats = placements as Placement[];
    onApply(encodeCustomLayout({ rows, seam: deriveSeam(rows, seats), seats }));
  };

  return (
    <div className="cle-backdrop" role="dialog" aria-label="Custom table layout" onClick={onClose}>
      <div className="cle" onClick={(e) => e.stopPropagation()}>
        <header className="cle-head">
          <span className="cle-title">Custom layout</span>
          <button type="button" className="cle-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="cle-rows">
          <span className="cle-label">Rows</span>
          <div className="play-stepper" role="group" aria-label="Rows">
            <button
              type="button"
              className="play-stepper-btn"
              aria-label="Fewer rows"
              disabled={rows <= 1}
              onClick={() => setRows((n) => Math.max(1, n - 1))}
            >
              −
            </button>
            <span className="play-stepper-value">{rows}</span>
            <button
              type="button"
              className="play-stepper-btn"
              aria-label="More rows"
              disabled={rows >= MAX_EDITOR_ROWS}
              onClick={() => setRows((n) => Math.min(MAX_EDITOR_ROWS, n + 1))}
            >
              +
            </button>
          </div>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div className="cle-grid" style={{ gridTemplateRows: `repeat(${rows}, 1fr)` }}>
            {Array.from({ length: rows }, (_, ri) => ri + 1).flatMap((r) =>
              ([1, 2] as const).map((c) => {
                const owner = occ.get(`${c},${r}`);
                if (owner != null) {
                  const p = placements[owner]!;
                  if (p.col !== c || p.row !== r) return null; // spanned-into cell
                  return (
                    <EditorSeat
                      key={`seat-${owner}`}
                      seat={owner}
                      name={game.players[owner]?.name ?? `Seat ${owner + 1}`}
                      placement={p}
                      selected={selected === owner}
                      onSelect={() => setSelected(selected === owner ? null : owner)}
                    />
                  );
                }
                return (
                  <EditorCell
                    key={`cell-${c}-${r}`}
                    col={c}
                    row={r}
                    armed={selected != null}
                    onTap={() => selected != null && placeAt(selected, c, r)}
                  />
                );
              })
            )}
          </div>
        </DndContext>

        {placedCount < count && (
          <div className="cle-tray" aria-label="Unplaced seats">
            <span className="cle-label">Tap a seat, then a cell</span>
            <div className="cle-tray-chips">
              {placements.map((p, i) =>
                p ? null : (
                  <button
                    key={i}
                    type="button"
                    className={`cle-tray-chip ${selected === i ? 'is-selected' : ''}`}
                    onClick={() => setSelected(selected === i ? null : i)}
                  >
                    {game.players[i]?.name ?? `Seat ${i + 1}`}
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {sel && (
          <div className="cle-controls" aria-label="Selected seat">
            <span className="cle-controls-name">
              {game.players[selected!]?.name ?? `Seat ${selected! + 1}`}
            </span>
            <div className="cle-controls-row">
              <button
                type="button"
                className="cle-ctrl"
                onClick={() =>
                  updateSelected({
                    rot: ((sel.rot + 90) % 360) as 0 | 90 | 180 | 270,
                  })
                }
              >
                <FacingArrow rot={sel.rot} /> Rotate
              </button>
              <button
                type="button"
                className="cle-ctrl"
                disabled={sel.colSpan === 1 && !canWiden}
                onClick={() => updateSelected({ colSpan: sel.colSpan === 2 ? 1 : 2 })}
              >
                {sel.colSpan === 2 ? 'Narrow' : 'Wide'}
              </button>
              <button
                type="button"
                className="cle-ctrl"
                disabled={sel.rowSpan === 1 && !canTallen}
                onClick={() => updateSelected({ rowSpan: sel.rowSpan === 2 ? 1 : 2 })}
              >
                {sel.rowSpan === 2 ? 'Short' : 'Tall'}
              </button>
              <button
                type="button"
                className="cle-ctrl is-danger"
                onClick={() => {
                  setPlacements((prev) => prev.map((p, i) => (i === selected ? null : p)));
                  setSelected(null);
                }}
              >
                Unplace
              </button>
            </div>
          </div>
        )}

        <footer className="cle-foot">
          <span className="cle-status">
            {allPlaced ? 'All seats placed' : `${count - placedCount} seat(s) to place`}
          </span>
          <div className="cle-foot-actions">
            <button type="button" className="game-menu-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="game-menu-btn is-primary"
              disabled={!allPlaced}
              onClick={apply}
            >
              Apply layout
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function EditorSeat({
  seat,
  name,
  placement,
  selected,
  onSelect,
}: {
  seat: number;
  name: string;
  placement: Placement;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `seat-${seat}` });
  const palette = paletteForIndex(seat);
  return (
    <div
      ref={setNodeRef}
      className={`cle-seat ${selected ? 'is-selected' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={{
        gridColumn: `${placement.col} / span ${placement.colSpan}`,
        gridRow: `${placement.row} / span ${placement.rowSpan}`,
        ['--pp-base' as never]: palette.base,
        ['--pp-edge' as never]: palette.edge,
      }}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      role="button"
      aria-pressed={selected}
      aria-label={`${name} — drag or tap to arrange`}
    >
      <span className="cle-seat-rot">
        <FacingArrow rot={placement.rot} />
      </span>
      <span className="cle-seat-name">{name}</span>
    </div>
  );
}

function EditorCell({
  col,
  row,
  armed,
  onTap,
}: {
  col: 1 | 2;
  row: number;
  armed: boolean;
  onTap: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell-${col}-${row}` });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`cle-cell ${isOver ? 'is-over' : ''} ${armed ? 'is-armed' : ''}`}
      style={{ gridColumn: col, gridRow: row }}
      onClick={onTap}
      aria-label={`Empty cell column ${col} row ${row}`}
    >
      +
    </button>
  );
}
