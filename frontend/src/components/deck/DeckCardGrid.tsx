// Grid view for the deck card list. Split out of DeckDisplay.tsx purely to
// shrink the file — no logic changes.
import type { CSSProperties } from 'react';
import { Handshake, Tag as TagIcon } from 'lucide-react';
import type { TypeGroup } from '@/lib/build-mana-data';
import type { ArrivalsByType } from '@/lib/new-arrivals';
import { getRoleBadge, type RoleKey } from '../../lib/role-badges';
import { zoomBucket, zoomMinCol, zoomTier } from '@/lib/grid-zoom';
import type { LegalityIssue } from '../../lib/deck-validation';
import { MeterBar } from '../shared/MeterBar';
import { BinderBadge, type BinderInfo } from '../BinderBadge';
import {
  cardFilterRoles,
  foilTileClass,
  allocationSummary,
  type TypedGroup,
} from './deck-display-rows';
import { SectionIcon, FoilShimmer, renderArrivalsChip } from './deck-display-icons';
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
  arrivalsByType,
  onOpenArrivals,
}: {
  groups: TypedGroup[];
  onRowClick: (name: string) => void;
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
  arrivalsByType?: ArrivalsByType;
  onOpenArrivals?: (bucket: TypeGroup) => void;
}) {
  return (
    <div className="deck-card-grid-sections">
      {groups.map((g) => {
        // A bucket with no rows still renders when it carries a target (the
        // 0/N gap story) — see groupByCategory. Type-mode buckets never set
        // `target`, so this is a no-op there.
        if (g.rows.length === 0 && g.target === undefined) return null;
        const count = g.rows.reduce((s, r) => s + r.qty, 0);
        return (
          <section key={g.title} className="deck-grid-section">
            <header className="deck-section-header">
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
              {g.icon === 'commander' && onEditPartner ? (
                <PartnerHeaderButton hasPartner={!!hasPartner} onClick={onEditPartner} />
              ) : g.icon === 'commander' ? null : (
                onOpenArrivals &&
                renderArrivalsChip(g.title as TypeGroup, arrivalsByType, onOpenArrivals)
              )}
            </header>
            <ul
              ref={gridRef}
              className={`deck-card-grid grid-${zoomBucket(gridZoom)}`}
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
                  <li
                    key={row.name}
                    className={`deck-card-grid-cell${roleDimmed ? ' is-role-dimmed' : ''}`}
                  >
                    <button
                      type="button"
                      className={`deck-card-grid-tile${foilTileClass(row)}`}
                      onClick={() => onRowClick(row.name)}
                      aria-label={`${row.name} (${row.qty} in deck — ${allocationSummary(row)})`}
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
