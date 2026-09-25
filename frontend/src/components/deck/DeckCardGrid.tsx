// Grid + Stacks views for the deck card list (one tile, two layouts). Split
// out of DeckDisplay.tsx purely to shrink the file.
//
// `layout="stacks"` (2026-09-19) is the visual-stacks layout Moxfield and
// Archidekt default Commander decks to: every group is a column of card
// images overlapped so only each card's name strip shows, and the hovered /
// focused / tapped card opens to full size, pushing the rest of the column
// down so the cards under it stay reachable. It renders the exact
// same <li> tile as the grid — qty pip, allocation, legality, foil, badge
// cluster — so the two can't drift; only the section/list classes and the
// `--stack-w` width differ (see deck-builder-card-list.css § Stacks).
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, Handshake, MoreVertical, Tag as TagIcon } from 'lucide-react';
import { getRoleBadge, type RoleKey } from '../../lib/role-badges';
import { stackWidth, zoomBucket, zoomCols, zoomMinCol, zoomTier } from '@/lib/grid-zoom';
import { useElementWidth } from '@/lib/use-element-width';
import type { LegalityIssue } from '../../lib/deck-validation';
import { countedRoleOf } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import { MeterBar } from '../shared/MeterBar';
import { BinderBadge, type BinderInfo } from '../BinderBadge';
import { formatMoney } from '../../lib/format-money';
import {
  foilTileClass,
  allocationSummary,
  packInOrder,
  gridSectionSpan,
  type CurrencyCode,
  type Row,
  type TypedGroup,
} from './deck-display-rows';
import { SectionIcon, FoilShimmer } from './deck-display-icons';
import { PartnerHeaderButton, LegalityBadge, RoleBadge } from './deck-display-icons';

/** Section chrome around one card (0.85rem of padding a side) and the gap
 *  between columns, in px at a 16px root — the two numbers the CSS spends on
 *  a stack besides the card itself. */
const STACK_CHROME_PX = 27;
const STACK_GAP_PX = 16;

/**
 * Stacks pack into page columns rather than wrapping (2026-09-21).
 *
 * `flex-wrap` made every row of columns as tall as its tallest stack, so a
 * 28-card Creature column left a screen-high hole beside Commander and pushed
 * Sorcery and Land far below the fold. The columns are balanced instead, by
 * the same in-order split the list uses (`packInOrder`), so the stacks read
 * in the deck's order, the carousel's order, down each column in turn.
 *
 * The heights are computed, not measured: a stack is a header plus one card
 * plus a strip per card after it, all of which follow from the stack width, so
 * there is no second layout pass and no flash of a wrong arrangement.
 */
export function packStacks<T extends { rows: unknown[] }>(
  groups: T[],
  columns: number,
  stackW: number
): T[][] {
  const cardH = (stackW * 680) / 488;
  // Header, the one card that shows in full, and a strip for each below it.
  return packInOrder(
    groups,
    columns,
    (g) => 46 + cardH + Math.max(0, g.rows.length - 1) * cardH * 0.11
  );
}

/**
 * How wide a stack is and how many columns of them fit.
 *
 * A phone gets ONE stack, as wide as the screen. Two 154px columns put four
 * cards on the first screen and made every name strip a squint; Archidekt
 * gives the phone a single full-bleed column, and a stack IS a name strip you
 * have to be able to read — so on a phone the card size follows the screen
 * rather than the −/+ stepper (which the toolbar hides there for that reason).
 *
 * Anywhere wider, the size tier is the VIEWPORT's, to match the `@media` that
 * picks `--stack-w`, while the column count is the CONTAINER's, which is what
 * the stacks actually have to fit into.
 */
export function stackLayout(viewportW: number, containerW: number, gridZoom: number) {
  const phone = viewportW > 0 && viewportW <= 640;
  const stackW =
    phone && containerW > 0
      ? containerW - STACK_CHROME_PX
      : stackWidth(gridZoom, zoomTier(viewportW));
  const columns = phone
    ? 1
    : Math.max(
        1,
        Math.floor((containerW + STACK_GAP_PX) / (stackW + STACK_CHROME_PX + STACK_GAP_PX))
      );
  return { phone, stackW, columns };
}

/** A group narrower than this many columns drops its price from the header:
 *  there is no room for it beside the name, and the price is in the list
 *  view and on every stack header. */
const GRID_SUBTOTAL_MIN_SPAN = 3;

export function DeckCardGrid({
  groups,
  onRowClick,
  legalityBySlot,
  gridZoom,
  gridRef,
  gridWidth,
  showRoles,
  roleFilter,
  synergyByName,
  binderByCopyId,
  hasPartner,
  onEditPartner,
  layout = 'grid',
  currency,
  showPrice,
  collapsedTitles,
  onToggleSection,
  onRowContextMenu,
  onRowMenu,
  hideHeaders = false,
}: {
  groups: TypedGroup[];
  onRowClick: (name: string) => void;
  /** 'grid' (default) wraps tiles in an auto-fill grid per section; 'stacks'
   *  renders each section as one overlapped column of tiles. */
  layout?: 'grid' | 'stacks';
  legalityBySlot?: Map<string, LegalityIssue>;
  gridZoom: number;
  /** Callback ref + measured width from `useElementWidth`, attached to the
   *  whole grid (every group sits on its shared columns, so it is the width a
   *  zoom step's column count is decided against). Omitted by the out-zone
   *  stack: it is a different width from the decklist's grid. */
  gridRef?: (el: HTMLElement | null) => void;
  gridWidth: number;
  showRoles: boolean;
  /** Active role filter — tiles not filling it render dimmed. */
  roleFilter?: RoleKey | null;
  synergyByName?: Map<string, string[]>;
  binderByCopyId?: Map<string, BinderInfo[]>;
  hasPartner?: boolean;
  onEditPartner?: () => void;
  currency: CurrencyCode;
  /** Mirrors the list view's `showPrefs.price` — the section subtotal was
   *  list-only before, so grid and stacks headers stated a count but never a
   *  price for the same section. */
  showPrice: boolean;
  /** Section titles currently collapsed. Absent (with no onToggleSection)
   *  means this grid cannot collapse at all. */
  collapsedTitles?: Set<string>;
  onToggleSection?: (title: string) => void;
  /** Right-click on a tile. The host owns the menu and its input/link guard. */
  onRowContextMenu?: (row: Row, e: React.MouseEvent) => void;
  /** Opens the same menu from the tile's kebab, anchored to the button's
   *  rect. Right-click alone would leave touch and keyboard users with no
   *  way in, which is why this is not optional in practice. */
  onRowMenu?: (row: Row, rect: DOMRect) => void;
  /** Drops the per-section header. The "Not in the deck" zone names its pile
   *  in a tab directly above the stack, so a header there would say Sideboard
   *  for the third time in three rows. */
  hideHeaders?: boolean;
}) {
  const stacks = layout === 'stacks';
  const [containerRef, containerWidth] = useElementWidth<HTMLDivElement>();
  const containerEl = useRef<HTMLDivElement | null>(null);
  const setContainer = useCallback(
    (el: HTMLDivElement | null) => {
      containerEl.current = el;
      containerRef(el);
      if (!stacks) gridRef?.(el);
    },
    [containerRef, gridRef, stacks]
  );
  // A touch has no hover to open a stacked card, so the first tap does it:
  // the card a tap opened, keyed `section\ncard`. A second tap on it opens the
  // carousel. Keyboard and a fine pointer never set it (focus and hover open
  // the card already), so only a touch pays the extra step.
  const [openCell, setOpenCell] = useState<string | null>(null);
  const lastPointer = useRef<string | null>(null);
  // A tap anywhere but a card in this view closes it. `click`, not
  // `pointerdown`, so a scroll to read the open card leaves it open.
  useEffect(() => {
    if (!openCell) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest?.('.deck-card-grid-cell') || !containerEl.current?.contains(t)) {
        setOpenCell(null);
      }
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openCell]);
  const { phone, stackW, columns } = stackLayout(
    typeof window === 'undefined' ? containerWidth : window.innerWidth,
    containerWidth,
    gridZoom
  );
  // Grid: the shared column count, the same floor-division the CSS auto-fill
  // grid used per group. Unmeasured (0, and always in happy-dom) keeps the
  // unpacked one-group-per-row layout.
  const packed = !stacks && containerWidth > 0;
  const gridCols = packed ? zoomCols(gridZoom, zoomTier(containerWidth), containerWidth) : 0;
  return (
    <div
      ref={setContainer}
      className={`deck-card-grid-sections${stacks ? ' deck-card-grid-sections--stacks' : ''}${
        packed ? ' deck-card-grid-sections--packed' : ''
      }`}
      style={packed ? ({ '--grid-cols': gridCols } as CSSProperties) : undefined}
    >
      {stacks && containerWidth > 0
        ? packStacks(groups, columns, stackW).map((col) => (
            <div className="deck-stack-column" key={col[0].title}>
              {col.map(renderSection)}
            </div>
          ))
        : groups.map(renderSection)}
    </div>
  );

  function renderSection(g: TypedGroup) {
    // A bucket with no rows still renders when it carries a target (the
    // 0/N gap story) — see groupByCategory. Type-mode buckets never set
    // `target`, so this is a no-op there.
    if (g.rows.length === 0 && g.target === undefined) return null;
    const count = g.rows.reduce((s, r) => s + r.qty, 0);
    const subtotal = g.rows.reduce((s, r) => s + r.price, 0);
    // Stacks never collapse. A stack is already its own collapse — the
    // column shows one strip per card and opens one at a time — so a
    // chevron that hides the whole column is a second, redundant control
    // in a header that is trying to stay a label. It also has to be
    // ignored rather than merely hidden: a section collapsed in the grid
    // would otherwise arrive here as a column with no cards and no way to
    // open it.
    const collapsed = !stacks && (collapsedTitles?.has(g.title) ?? false);
    // Section titles are unique within a group list (groupByStack merges
    // a tag that collides with a type name), so the title is a safe id
    // seed. Non-word characters would otherwise produce an invalid id.
    const listId = `deck-grid-section-${g.title.replace(/\W+/g, '-').toLowerCase()}`;
    const span = packed ? gridSectionSpan(g.rows.length, gridCols, collapsed) : 0;
    const showSubtotal = showPrice && (!packed || span >= GRID_SUBTOTAL_MIN_SPAN);
    return (
      <section
        key={g.title}
        className={`deck-grid-section${stacks ? ' deck-grid-section--stack' : ''}${
          collapsed ? ' is-collapsed' : ''
        }`}
        // Stacks: a fixed card width per zoom step, set on the SECTION so
        // both it (its own width) and the list inside inherit it — custom
        // properties only flow downward. The tier is the viewport's: the
        // stack's own width IS this value, so measuring it would be circular.
        style={
          stacks
            ? ({
                '--stack-w-desktop': `${stackWidth(gridZoom, 'desktop')}px`,
                '--stack-w-mobile': `${phone ? stackW : stackWidth(gridZoom, 'mobile')}px`,
              } as CSSProperties)
            : packed
              ? ({ '--span': span } as CSSProperties)
              : undefined
        }
      >
        {!hideHeaders && (
          <header className="deck-section-header">
            {onToggleSection && !stacks && (
              <button
                type="button"
                className="deck-section-collapse"
                aria-expanded={!collapsed}
                aria-controls={listId}
                aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${g.title}`}
                onClick={() => onToggleSection(g.title)}
              >
                <ChevronDown
                  width={14}
                  height={14}
                  strokeWidth={2}
                  className="deck-section-collapse-icon"
                  aria-hidden
                />
              </button>
            )}
            {/* Stacks drop the type glyph: the column is already a wall of
                  card art, and a header that has to sit above it stays
                  readable as words alone. */}
            {!stacks && (
              <span className="deck-section-icon">
                <SectionIcon icon={g.icon} />
              </span>
            )}
            {/* A <div> (MeterBar's root) can't nest inside <h3> — phrasing
                  content only — so the gauge is a sibling of the heading,
                  both wrapped as the single grid-column-occupying title cell. */}
            <div className="deck-section-title-row">
              <h3 className="deck-section-title">
                {g.title}{' '}
                <span className="deck-section-count">
                  ({count}
                  {g.target !== undefined ? ` / ${g.target}` : ''})
                </span>
              </h3>
              {g.target !== undefined && (
                <MeterBar
                  value={count}
                  max={Math.max(g.target, count)}
                  size="sm"
                  role="meter"
                  label={`${g.title}: ${count} of ${g.target}`}
                  className="deck-section-gauge"
                />
              )}
            </div>
            {showSubtotal && (
              <span className="deck-section-subtotal">{formatMoney(subtotal, { currency })}</span>
            )}
            {g.icon === 'commander' && onEditPartner && (
              <PartnerHeaderButton hasPartner={!!hasPartner} onClick={onEditPartner} />
            )}
          </header>
        )}
        <ul
          id={listId}
          hidden={collapsed}
          // Stacks keep measuring a stack's own list for the zoom stepper, as
          // before; the grid is measured whole, on the container (above).
          ref={stacks ? gridRef : undefined}
          className={`deck-card-grid grid-${zoomBucket(gridZoom)}${
            stacks ? ' deck-card-stack' : ''
          }`}
          style={
            {
              '--card-min-desktop': `${zoomMinCol(gridZoom, 'desktop')}px`,
              '--card-min-mobile': `${zoomMinCol(gridZoom, 'mobile')}px`,
              // Container-derived tier overrides the CSS `@media` (viewport)
              // tier once measured — a grid narrower than the viewport got
              // the desktop ladder here and the mobile one in JS.
              ...(gridWidth > 0
                ? { '--card-min': `${zoomMinCol(gridZoom, zoomTier(gridWidth))}px` }
                : {}),
            } as CSSProperties
          }
        >
          {g.rows.map((row, i) => {
            const cellKey = `${g.title}\n${row.name}`;
            const role = showRoles ? getRoleBadge(row.card) : null;
            const synergy = synergyByName?.get(row.name);
            const binders: BinderInfo[] = [];
            if (binderByCopyId) {
              const seen = new Set<string>();
              for (const cid of row.allocatedCopyIds) {
                for (const b of binderByCopyId.get(cid) ?? []) {
                  if (!seen.has(b.id)) {
                    seen.add(b.id);
                    binders.push(b);
                  }
                }
              }
            }
            const roleDimmed = !!roleFilter && countedRoleOf(row.card) !== roleFilter;
            return (
              // `data-peek-name` on the tile feeds the card inspector through
              // the same delegated hover handlers the list rows use.
              <li
                key={row.name}
                className={`deck-card-grid-cell${roleDimmed ? ' is-role-dimmed' : ''}${
                  stacks && openCell === cellKey ? ' is-open' : ''
                }`}
                onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(row, e) : undefined}
              >
                <button
                  type="button"
                  className={`deck-card-grid-tile${foilTileClass(row)}`}
                  onPointerDown={(e) => {
                    lastPointer.current = e.pointerType;
                  }}
                  onClick={(e) => {
                    // `detail` is 0 for a keyboard press, which must not
                    // inherit the pointer type of an earlier tap.
                    const tap = lastPointer.current === 'touch' && e.detail > 0;
                    lastPointer.current = null;
                    // The last card of a stack already shows whole: straight
                    // to the carousel.
                    if (stacks && tap && openCell !== cellKey && i < g.rows.length - 1) {
                      setOpenCell(cellKey);
                      return;
                    }
                    onRowClick(row.name);
                  }}
                  data-peek-name={row.name}
                  aria-label={`${row.name} (${row.qty} in deck, ${allocationSummary(row)})`}
                >
                  {row.imageNormal ? (
                    <img
                      src={row.imageNormal}
                      alt=""
                      className="deck-card-grid-image"
                      loading="lazy"
                    />
                  ) : (
                    <span className="deck-card-grid-fallback">{row.name}</span>
                  )}
                  {/* Foil is shown by the holographic overlay alone — no
                          text pip (keeps the corners free for status icons). */}
                  {row.foil && row.imageNormal && <FoilShimmer />}
                  {row.qty > 1 && <span className="deck-card-grid-qty">×{row.qty}</span>}
                  {row.status !== 'allocated' &&
                    (row.allocatedQty > 0 ? (
                      <span
                        className={`deck-card-grid-alloc deck-card-grid-alloc-${
                          row.orphanQty > 0 ? 'orphan' : 'unowned'
                        }`}
                        title={allocationSummary(row)}
                        aria-label={allocationSummary(row)}
                      >
                        {row.allocatedQty}/{row.qty}
                      </span>
                    ) : (
                      <span
                        className="deck-card-grid-missing"
                        title={allocationSummary(row)}
                        aria-label={allocationSummary(row)}
                      />
                    ))}
                  {(() => {
                    const issue = legalityBySlot?.get(row.legalitySlotKey ?? row.slotIds[0]);
                    return issue ? (
                      <LegalityBadge issue={issue} className="deck-card-grid-illegal" />
                    ) : null;
                  })()}
                </button>
                {onRowMenu && (
                  <button
                    type="button"
                    className="deck-card-grid-menu"
                    aria-haspopup="menu"
                    aria-label={`Actions for ${row.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRowMenu(row, e.currentTarget.getBoundingClientRect());
                    }}
                  >
                    <MoreVertical width={14} height={14} strokeWidth={2} aria-hidden />
                  </button>
                )}
                {(row.isPartner ||
                  role ||
                  (synergy && synergy.length > 0) ||
                  binders.length > 0 ||
                  row.tags.length > 0) && (
                  <div className="deck-card-grid-badges">
                    {row.isPartner && (
                      <span
                        className="deck-card-grid-partner"
                        title="Partner commander"
                        aria-label="Partner commander"
                      >
                        <Handshake width={13} height={13} strokeWidth={2.4} aria-hidden />
                      </span>
                    )}
                    {row.tags.length > 0 && (
                      <span
                        className="deck-card-grid-tags"
                        title={`Tags: ${row.tags.join(', ')}`}
                        aria-label={`Tags: ${row.tags.join(', ')}`}
                      >
                        <TagIcon width={11} height={11} strokeWidth={2.4} aria-hidden />
                        {row.tags.length > 1 && (
                          <span className="deck-card-grid-tags-count">{row.tags.length}</span>
                        )}
                      </span>
                    )}
                    {binders.length > 0 && <BinderBadge binders={binders} />}
                    {synergy && synergy.length > 0 && (
                      <span
                        className="deck-card-grid-synergy"
                        role="img"
                        title={`Synergy with your commander:\n• ${synergy.join('\n• ')}`}
                        aria-label={`Synergy: ${synergy.join('; ')}`}
                      >
                        ✦
                      </span>
                    )}
                    {role && <RoleBadge card={row.card} variant="grid" />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }
}
