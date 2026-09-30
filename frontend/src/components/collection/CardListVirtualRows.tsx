import type { ReactNode, Ref } from 'react';
import { Plus } from 'lucide-react';
import type { VirtualItem } from '@tanstack/react-virtual';
import type { GridLayoutRow, ListLayoutRow } from '@/lib/collection/group-sections';
import { SectionHeaderBar } from '@/components/shared/SectionHeaderBar';
import { GRID_SECTION_HEADER_H } from './card-list-table-config';

// The virtual-row renderers for CardListTable's grid and list bodies, plus the
// two "Add cards" hand-off affordances, split out of it (T176). The
// virtualizers, the row-height estimates and the layout arrays all stay in the
// table: these take the already-computed virtual items and only lay them out,
// so the emitted DOM is exactly what the table rendered inline.

interface GridRowsProps {
  virtualRows: VirtualItem[];
  layout: GridLayoutRow[];
  scrollMargin: number;
  cols: number;
  gap: number;
  collapsedKeys: Set<string>;
  onToggleSection: (key: string) => void;
  /** The trailing "Add cards" hand-off slot, when a query is being offered. */
  handoff: { index: number; query: string; onAdd: (query: string) => void } | null;
  /** Number of card rows; a slot past it renders nothing. */
  rowCount: number;
  renderCell: (index: number) => ReactNode;
}

/** Grid body: full-width section headers interleaved with rows of columns. */
export function CardListGridRows({
  virtualRows,
  layout,
  scrollMargin,
  cols,
  gap,
  collapsedKeys,
  onToggleSection,
  handoff,
  rowCount,
  renderCell,
}: GridRowsProps) {
  return (
    <>
      {virtualRows.map((virtualRow) => {
        const layoutRow = layout[virtualRow.index];
        if (!layoutRow) return null;
        if (layoutRow.kind === 'header') {
          return (
            <SectionHeaderBar
              key={virtualRow.key}
              className="collection-grid-section-header"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: GRID_SECTION_HEADER_H,
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              }}
              pip={layoutRow.meta.pip}
              label={layoutRow.meta.label}
              count={layoutRow.count}
              collapsed={collapsedKeys.has(layoutRow.meta.key)}
              onToggle={() => onToggleSection(layoutRow.meta.key)}
            />
          );
        }
        return (
          <div
            key={virtualRow.key}
            className="collection-grid-vrow"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gap: `${gap}px`,
            }}
          >
            {Array.from({ length: layoutRow.end - layoutRow.start }, (_, colIdx) => {
              const idx = layoutRow.start + colIdx;
              if (handoff && idx === handoff.index) {
                return (
                  <button
                    key="add-handoff"
                    type="button"
                    className="collection-grid-item collection-grid-scryfall"
                    onClick={() => handoff.onAdd(handoff.query)}
                    aria-haspopup="dialog"
                    aria-label={`Add “${handoff.query}” to your collection…`}
                  >
                    <Plus width={26} height={26} strokeWidth={1.6} aria-hidden />
                    <span className="collection-grid-scryfall-title">Add “{handoff.query}”</span>
                    <span className="collection-grid-scryfall-sub">to your collection…</span>
                  </button>
                );
              }
              if (idx >= rowCount) return null;
              return renderCell(idx);
            })}
          </div>
        );
      })}
    </>
  );
}

interface ListRowsProps {
  virtualRows: VirtualItem[];
  layout: ListLayoutRow[];
  scrollMargin: number;
  measureElement: Ref<HTMLDivElement>;
  collapsedKeys: Set<string>;
  onToggleSection: (key: string) => void;
  renderRow: (index: number) => ReactNode;
}

/** List / compact / table body: one measured virtual row per header or card. */
export function CardListListRows({
  virtualRows,
  layout,
  scrollMargin,
  measureElement,
  collapsedKeys,
  onToggleSection,
  renderRow,
}: ListRowsProps) {
  return (
    <>
      {virtualRows.map((virtualRow) => {
        const item = layout[virtualRow.index];
        if (!item) return null;
        // Headers ride as their own measured virtual rows (mirroring the
        // grid), so a collapsed section keeps a tappable header with no card
        // rows below it. `measureElement` folds each row's real height into
        // the offset, so a header row and a card row can differ in height
        // without drift.
        const rowBox = (children: ReactNode) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }}
          >
            {children}
          </div>
        );
        if (item.kind === 'header') {
          return rowBox(
            <SectionHeaderBar
              className="collection-list-section-header"
              pip={item.meta.pip}
              label={item.meta.label}
              count={item.count}
              collapsed={collapsedKeys.has(item.meta.key)}
              onToggle={() => onToggleSection(item.meta.key)}
            />
          );
        }
        return rowBox(renderRow(item.index));
      })}
    </>
  );
}

/** The standalone "Add cards" row under a list / compact / table body. */
export function CardListListHandoff({ query, onAdd }: { query: string; onAdd: () => void }) {
  return (
    <button
      type="button"
      className="collection-list-scryfall collection-list-scryfall--standalone"
      aria-haspopup="dialog"
      aria-label={`Add “${query}” to your collection…`}
      onClick={onAdd}
    >
      <span className="collection-list-scryfall-icon">
        <Plus width={18} height={18} strokeWidth={1.7} aria-hidden />
      </span>
      <span className="collection-list-scryfall-text">
        <span className="collection-list-scryfall-title">Add “{query}”</span>
        <span className="collection-list-scryfall-sub">to your collection…</span>
      </span>
    </button>
  );
}
