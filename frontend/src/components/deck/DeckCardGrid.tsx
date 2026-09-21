// Grid + Stacks views for the deck card list (one tile, two layouts). Split
// out of DeckDisplay.tsx purely to shrink the file.
//
// `layout="stacks"` (2026-09-19) is the visual-stacks layout Moxfield and
// Archidekt default Commander decks to: every group is a column of card
// images overlapped so only each card's name strip shows, and the hovered /
// focused card opens to full size, pushing the rest of the column down so the
// cards under it stay reachable. It renders the exact
// same <li> tile as the grid — qty pip, allocation, legality, foil, badge
// cluster — so the two can't drift; only the section/list classes and the
// `--stack-w` width differ (see deck-builder-card-list.css § Stacks).
import type { CSSProperties } from 'react';
import { ChevronDown, Handshake, MoreVertical, Tag as TagIcon } from 'lucide-react';
import { getRoleBadge, type RoleKey } from '../../lib/role-badges';
import { stackWidth, zoomBucket, zoomMinCol, zoomTier } from '@/lib/grid-zoom';
import type { LegalityIssue } from '../../lib/deck-validation';
import { MeterBar } from '../shared/MeterBar';
import { BinderBadge, type BinderInfo } from '../BinderBadge';
import { formatMoney } from '../../lib/format-money';
import {
  cardFilterRoles,
  foilTileClass,
  allocationSummary,
  type CurrencyCode,
  type Row,
  type TypedGroup,
} from './deck-display-rows';
import { SectionIcon, FoilShimmer } from './deck-display-icons';
import { PartnerHeaderButton, LegalityBadge, RoleBadge } from './deck-display-icons';

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
}: {
  groups: TypedGroup[];
  onRowClick: (name: string) => void;
  /** 'grid' (default) wraps tiles in an auto-fill grid per section; 'stacks'
   *  renders each section as one overlapped column of tiles. */
  layout?: 'grid' | 'stacks';
  legalityBySlot?: Map<string, LegalityIssue>;
  gridZoom: number;
  /** Callback ref + measured width from `useElementWidth`, attached to every
   *  section's grid (all equal width; the last to mount is observed). */
  gridRef: (el: HTMLUListElement | null) => void;
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
}) {
  const stacks = layout === 'stacks';
  return (
    <div className={`deck-card-grid-sections${stacks ? ' deck-card-grid-sections--stacks' : ''}`}>
      {groups.map((g) => {
        // A bucket with no rows still renders when it carries a target (the
        // 0/N gap story) — see groupByCategory. Type-mode buckets never set
        // `target`, so this is a no-op there.
        if (g.rows.length === 0 && g.target === undefined) return null;
        const count = g.rows.reduce((s, r) => s + r.qty, 0);
        const subtotal = g.rows.reduce((s, r) => s + r.price, 0);
        const collapsed = collapsedTitles?.has(g.title) ?? false;
        // Section titles are unique within a group list (groupByStack merges
        // a tag that collides with a type name), so the title is a safe id
        // seed. Non-word characters would otherwise produce an invalid id.
        const listId = `deck-grid-section-${g.title.replace(/\W+/g, '-').toLowerCase()}`;
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
                    '--stack-w-mobile': `${stackWidth(gridZoom, 'mobile')}px`,
                  } as CSSProperties)
                : undefined
            }
          >
            <header className="deck-section-header">
              {onToggleSection && (
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
              <span className="deck-section-icon">
                <SectionIcon icon={g.icon} />
              </span>
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
              {showPrice && (
                <span className="deck-section-subtotal">{formatMoney(subtotal, { currency })}</span>
              )}
              {g.icon === 'commander' && onEditPartner && (
                <PartnerHeaderButton hasPartner={!!hasPartner} onClick={onEditPartner} />
              )}
            </header>
            <ul
              id={listId}
              hidden={collapsed}
              ref={gridRef}
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
              {g.rows.map((row) => {
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
                const roleDimmed = !!roleFilter && !cardFilterRoles(row.card).includes(roleFilter);
                return (
                  // `data-peek-name` on the tile feeds the card inspector through
                  // the same delegated hover handlers the list rows use.
                  <li
                    key={row.name}
                    className={`deck-card-grid-cell${roleDimmed ? ' is-role-dimmed' : ''}`}
                    onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(row, e) : undefined}
                  >
                    <button
                      type="button"
                      className={`deck-card-grid-tile${foilTileClass(row)}`}
                      onClick={() => onRowClick(row.name)}
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
      })}
    </div>
  );
}
