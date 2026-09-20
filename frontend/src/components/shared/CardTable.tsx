import type { CSSProperties, ReactNode, Ref } from 'react';
import type { SortDir } from '../../types';
import { SortDirArrow } from '../SortDirArrow';

/**
 * The table density shared by every card list in the app — Collection, a
 * binder's list view, a list's compact view, and the shared/friend views.
 *
 * This module owns the column vocabulary in ONE place. It used to live in
 * two: `CardListTable` hardcoded the header labels and the
 * `--collection-table-cols` grid template, while `CardRow` hardcoded twelve
 * cells that had to be written in the same order by hand ("in the same order
 * `CardRow` (table mode) renders its cells", said the comment that was the
 * only thing keeping them together). A surface that wanted eleven of those
 * columns, or a twelfth of its own, had no way to say so — which is why the
 * table shipped on Collection and nowhere else.
 *
 * Now a surface passes a `CardTableCol[]`. The same array drives the header
 * (here), the cells (`CardRow`) and the grid template (`cardTableTemplate`),
 * so a column cannot exist in one and not the others.
 */
export type CardTableCol =
  | 'qty'
  | 'name'
  | 'set'
  | 'cn'
  | 'cond'
  | 'lang'
  | 'binder'
  | 'page'
  | 'notes'
  | 'target'
  | 'mana'
  | 'price'
  | 'total'
  | 'menu';

interface ColumnSpec {
  /** Header text. Empty for the trailing kebab column. */
  label: string;
  /**
   * Width tier. 1 survives every width; 3 drops first (below 1100px of
   * CONTAINER width), then 2 (below 900px). The drop itself is CSS — see
   * the `@container` rules in collection.css, which zero the column's track
   * var and hide its cells by this tier. Keeping it declarative here means a
   * new column states its own priority instead of being forgotten in three
   * media queries.
   */
  tier: 1 | 2 | 3;
  /**
   * Whether any surface may offer click-to-sort on this column. Load-bearing
   * twice over: `CardTableHead` renders a sort button only for a column marked
   * here, and `card-table-header-fit.test.ts` reserves the sort arrow's width
   * in the column's track only for these. A column that grew an arrow without
   * the flag would be a header too narrow for its own label.
   */
  sortable?: true;
}

/**
 * Canonical order. A surface's column array is filtered from this, never
 * written by hand, so two surfaces can't disagree about whether Set comes
 * before Collector number.
 */
export const CARD_TABLE_COLUMNS: Record<CardTableCol, ColumnSpec> = {
  qty: { label: 'Qty', tier: 1, sortable: true },
  name: { label: 'Name', tier: 1, sortable: true },
  set: { label: 'Set', tier: 1, sortable: true },
  cn: { label: '#', tier: 1 },
  cond: { label: 'Cond', tier: 1 },
  lang: { label: 'Lang', tier: 2 },
  binder: { label: 'Binder', tier: 3 },
  page: { label: 'Page', tier: 3 },
  notes: { label: 'Notes', tier: 2 },
  target: { label: 'Target', tier: 2 },
  mana: { label: 'Mana', tier: 3, sortable: true },
  price: { label: 'Price', tier: 1, sortable: true },
  total: { label: 'Total', tier: 1 },
  menu: { label: '', tier: 1 },
};

const ORDER = Object.keys(CARD_TABLE_COLUMNS) as CardTableCol[];

/** Put a surface's columns into the canonical order and drop any duplicates. */
export function orderColumns(cols: readonly CardTableCol[]): CardTableCol[] {
  const wanted = new Set(cols);
  return ORDER.filter((c) => wanted.has(c));
}

/** Collection: everything the owner of the cards can see about a copy. */
export const COLLECTION_TABLE_COLUMNS = orderColumns([
  'qty',
  'name',
  'set',
  'cn',
  'cond',
  'lang',
  'binder',
  'notes',
  'mana',
  'price',
  'total',
  'menu',
]);

/**
 * A binder's list view. Which binder a card is in is the one fact a binder
 * page never needs to state, so Binder gives its slot to the physical page
 * number — the thing you actually walk over to the shelf with.
 */
export const BINDER_TABLE_COLUMNS = orderColumns([
  'qty',
  'name',
  'set',
  'cn',
  'cond',
  'lang',
  'page',
  'notes',
  'mana',
  'price',
  'total',
  'menu',
]);

/**
 * A list. Its rows are printing references rather than binder-filed copies,
 * so Binder and Notes have nothing to show. Want lists add the inline target
 * price (see `LIST_TABLE_COLUMNS_WITH_TARGET`).
 */
export const LIST_TABLE_COLUMNS = orderColumns([
  'qty',
  'name',
  'set',
  'cn',
  'cond',
  'lang',
  'mana',
  'price',
  'total',
  'menu',
]);

export const LIST_TABLE_COLUMNS_WITH_TARGET = orderColumns([...LIST_TABLE_COLUMNS, 'target']);

/**
 * Someone else's collection or binder. Read-only: no kebab. Condition,
 * language and notes are the owner's private annotations and aren't in a
 * shared projection at all, so the columns go rather than render empty.
 * Qty and Price stay column-shaped but obey the viewer's `hideQty` /
 * `hidePrice` contract — a friend's collection reports contents, not counts
 * or value.
 */
export const SHARED_TABLE_COLUMNS = orderColumns([
  'qty',
  'name',
  'set',
  'cn',
  'mana',
  'price',
  'total',
]);

/**
 * A copy, as far as the columns that only exist to report a deviation are
 * concerned. Deliberately structural rather than `EnrichedCard` — this module
 * owns the column vocabulary and nothing else.
 */
interface AnnotatedCopy {
  condition?: string;
  language?: string;
  notes?: string;
}

/**
 * Columns whose cell is blank on a copy that carries nothing unusual, and the
 * test for "carries something".
 */
const OPTIONAL_COLUMNS: Partial<Record<CardTableCol, (c: AnnotatedCopy) => boolean>> = {
  cond: (c) => !!c.condition && c.condition !== 'nm',
  lang: (c) => !!c.language && c.language !== 'en',
  notes: (c) => !!c.notes?.trim(),
};

/**
 * Drop the columns that have nothing to say about THESE copies.
 *
 * A binder of 1,062 sleeved English near-mint cards otherwise prints "NM" a
 * thousand times, "EN" a thousand times, and an empty Notes column two `fr`
 * wide — three dead tracks, one of them the second-widest in the table, which
 * is what made the binder read as broken at desktop width. E335 shipped these
 * columns unconditionally on the reasoning that "the column label carries the
 * meaning"; it only carries meaning when a row has meaning to carry.
 *
 * Browse surfaces (a binder, a list) call this. Collection does NOT: it is the
 * audit view, where Cond and Lang are columns you sort and scan by, and one
 * that vanished when every copy happened to be NM would be worse than one that
 * reads NM.
 */
export function visibleColumns(
  columns: readonly CardTableCol[],
  copies: readonly AnnotatedCopy[]
): CardTableCol[] {
  return columns.filter((col) => {
    const carries = OPTIONAL_COLUMNS[col];
    return !carries || copies.some((c) => carries(c));
  });
}

/**
 * The `grid-template-columns` value for a set of columns, as a list of
 * per-column custom properties (`--ct-w-name`, …) defined in collection.css.
 *
 * Going through vars rather than literal track sizes is what makes the
 * responsive tiers preset-agnostic: a `@container` rule sets the dropped
 * column's var to 0px and hides its cells, and every surface's template
 * collapses correctly without the CSS having to know which presets exist.
 * (The column gap is cell padding for the same reason — a zero-width track
 * would otherwise still contribute a gap.)
 */
export function cardTableTemplate(columns: readonly CardTableCol[], selectMode = false): string {
  const tracks = columns.map((c) => `var(--ct-w-${c})`);
  // Leading checkbox gutter, matching the flow row's own select affordance.
  return (selectMode ? ['1.75rem', ...tracks] : tracks).join(' ');
}

interface FrameProps {
  columns: readonly CardTableCol[];
  selectMode?: boolean;
  className?: string;
  /**
   * Draw the whole table as ONE bordered slab: the frame carries the border,
   * the radius and the surface, and the header and row lists inside it go
   * flush. Pass it whenever the table density is on. Without it each list
   * keeps its own box, which on a grouped surface reads as a stack of
   * unconnected cards rather than one table.
   */
  framed?: boolean;
  children: ReactNode;
}

/**
 * The table's container. Owns the shared grid template and the inline-size
 * container the tier rules query, so the header and every row below it —
 * across every section, in the grouped surfaces — resolve to identical
 * column widths.
 */
export function CardTableFrame({
  columns,
  selectMode = false,
  className,
  framed = false,
  children,
}: FrameProps) {
  return (
    <div
      className={`collection-table${selectMode ? ' is-selecting' : ''}${
        framed ? ' is-framed' : ''
      }${className ? ` ${className}` : ''}`}
      style={
        {
          '--collection-table-cols': cardTableTemplate(columns, selectMode),
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}

interface HeadProps<K extends string> {
  columns: readonly CardTableCol[];
  /** Leaves room for the row checkbox gutter. */
  selectMode?: boolean;
  /**
   * Measured pin offset in px — the bottom of the lowest sticky chrome bar
   * above this table. Surfaces measure it because the bars' heights aren't
   * all fixed; the CSS fallback only covers first paint.
   */
  top?: number;
  headRef?: Ref<HTMLDivElement>;
  /**
   * Columns that drive a sort, and the sort key each one sets. A column
   * that isn't here renders as a label, not a button — a header you can
   * click but that does nothing is worse than one you can't.
   */
  sortFor?: Partial<Record<CardTableCol, K>>;
  sortKey?: K;
  sortDir?: SortDir;
  onSort?: (key: K) => void;
  /** "Newest first" / "Z→A" etc. for the active column's accessible name. */
  dirLabel?: (key: K, dir: SortDir) => string;
}

/** The sticky column header. Sortable columns only where `sortFor` says so. */
export function CardTableHead<K extends string>({
  columns,
  selectMode = false,
  top,
  headRef,
  sortFor,
  sortKey,
  sortDir = 'asc',
  onSort,
  dirLabel,
}: HeadProps<K>) {
  return (
    <div
      ref={headRef}
      className="collection-table-head"
      role="group"
      aria-label="Columns"
      style={{ top: top && top > 0 ? top : undefined }}
    >
      {selectMode && <span aria-hidden />}
      {columns.map((col) => {
        const { label, tier, sortable } = CARD_TABLE_COLUMNS[col];
        const key = sortFor?.[col];
        // `sortable` gates the button, not just `sortFor`: the column's track
        // only reserves room for the arrow when the vocabulary says the column
        // can carry one, so a surface can't grow an arrow the width doesn't
        // allow for.
        if (!key || !onSort || !sortable) {
          return (
            <span key={col} className="collection-table-th" data-col={col} data-tier={tier}>
              {label}
            </span>
          );
        }
        const active = sortKey === key;
        const dirWords = dirLabel?.(key, sortDir);
        return (
          <button
            key={col}
            type="button"
            className="collection-table-th is-sortable"
            data-col={col}
            data-tier={tier}
            data-active={active || undefined}
            aria-label={
              active
                ? `Sorted by ${label}${dirWords ? `, ${dirWords}` : ''}. Reverse`
                : `Sort by ${label}`
            }
            onClick={() => onSort(key)}
          >
            {label}
            {active && <SortDirArrow dir={sortDir} />}
          </button>
        );
      })}
    </div>
  );
}
