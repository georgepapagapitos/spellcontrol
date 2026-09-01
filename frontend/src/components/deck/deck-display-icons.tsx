// JSX-returning presentational helpers for DeckDisplay, split out alongside
// deck-display-rows.ts purely to shrink DeckDisplay.tsx — no logic changes.
import {
  Bomb,
  BookOpen,
  Boxes,
  Crosshair,
  Layers,
  Sparkles,
  Sprout,
  Tag as TagIcon,
  Wrench,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DeckCategory } from '@/deck-builder/types';
import { TYPE_GROUP_PLURAL, type TypeGroup } from '@/lib/build-mana-data';
import type { ArrivalsByType } from '@/lib/new-arrivals';
import { ManaSymbol } from '../shared/ManaSymbol';
import { allocationSummary, type Row } from './deck-display-rows';
import { CircleAlert } from 'lucide-react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { LegalityIssue } from '../../lib/deck-validation';
import { getRoleBadge, isMultiRole, multiRoleTitle } from '../../lib/role-badges';
import { ToolbarPopover } from '../shared/ToolbarPopover';

// Section-header icon per category bucket. 'lands'/'creatures' reuse the
// mana-font type glyphs (via ManaSymbol, see SectionIcon below) — the other
// 6 have no mana-font equivalent, so they render a small lucide glyph
// instead (decorative, aria-hidden either way).
const CATEGORY_ICON_COMPONENTS: Partial<
  Record<
    DeckCategory,
    React.ComponentType<{
      width?: number;
      height?: number;
      strokeWidth?: number;
      'aria-hidden'?: boolean;
      className?: string;
    }>
  >
> = {
  ramp: Sprout,
  cardDraw: BookOpen,
  singleRemoval: Crosshair,
  boardWipes: Bomb,
  synergy: Sparkles,
  utility: Wrench,
};

// Section-header icon renderer shared by CategorySection and DeckCardGrid.
// `icon` is a mana-font token ('land'/'creature'/'commander'/…) for
// groupByType or a category-view lucide token for groupByCategory's 6
// non-type buckets — CATEGORY_ICON_COMPONENTS decides which.
export function SectionIcon({ icon }: { icon: string }) {
  if (icon === 'tag') {
    return (
      <TagIcon
        width={14}
        height={14}
        strokeWidth={1.8}
        aria-hidden
        className="deck-section-icon-glyph"
      />
    );
  }
  const Lucide = CATEGORY_ICON_COMPONENTS[icon as DeckCategory];
  if (Lucide) {
    return (
      <Lucide
        width={14}
        height={14}
        strokeWidth={1.8}
        aria-hidden
        className="deck-section-icon-glyph"
      />
    );
  }
  return <ManaSymbol symbol={icon} />;
}

/** The two ambient-drift overlay layers (rainbow shine + glare) reused from the
 *  CardPreview foil engine. Render inside any element carrying `is-foil`. */
export function FoilShimmer() {
  return (
    <>
      <div className="card-preview-foil-shine" aria-hidden="true" />
      <div className="card-preview-foil-glare" aria-hidden="true" />
    </>
  );
}

// Inline chip rendered next to the card name. Stays out of the way when the
// row is fully allocated; surfaces a precise "M of N owned" count when only
// some slots are bound to a real collection copy. Orphans get their own
// tone so a stale-allocation row is distinguishable from a never-owned one.
// When the user owns the card but every copy is allocated to a different
// deck, we surface the same "deck badge" (Layers icon + deck color) used
// in the Collection grid so the row reads "in another deck" — never
// "unowned" for a card that's already in the binder.
export function AllocationChip({ row }: { row: Row }) {
  const missing = row.unownedQty + row.orphanQty + row.claimedElsewhereQty;
  if (missing === 0) return null;
  // "Claimed elsewhere" gets the deck-link badge — when there's no genuinely
  // unowned/orphan slot mixed in, the chip is purely a navigation affordance.
  if (row.claimedElsewhereQty > 0 && row.unownedQty === 0 && row.orphanQty === 0 && row.claimedBy) {
    const info = row.claimedBy;
    const isCube = info.ownerKind === 'cube';
    const noun = isCube ? 'cube' : 'deck';
    const title =
      row.claimedElsewhereQty === row.qty
        ? `In ${noun}: ${info.ownerName}`
        : `${row.claimedElsewhereQty} of ${row.qty} in ${noun}: ${info.ownerName}`;
    return (
      <Link
        to={isCube ? `/decks/cube/${info.ownerId}` : `/decks/${info.ownerId}`}
        className="deck-row-alloc-badge"
        style={
          {
            ['--deck-color']: isCube ? 'var(--cube-color)' : info.ownerColor || 'var(--accent)',
          } as React.CSSProperties
        }
        title={title}
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {isCube ? (
          <Boxes width={11} height={11} strokeWidth={2.2} aria-hidden />
        ) : (
          <Layers width={11} height={11} strokeWidth={2.2} aria-hidden />
        )}
        <span className="deck-row-alloc-badge-label">{info.ownerName}</span>
      </Link>
    );
  }
  const tone = row.orphanQty > 0 ? 'orphan' : row.unownedQty > 0 ? 'unowned' : 'claimed-elsewhere';
  const label =
    row.allocatedQty === 0
      ? row.orphanQty > 0
        ? 'orphan'
        : row.unownedQty > 0
          ? 'unowned'
          : 'in another deck'
      : `${row.allocatedQty} of ${row.qty} owned`;
  return (
    <span
      className={`deck-row-alloc-chip deck-row-alloc-chip-${tone}`}
      title={allocationSummary(row)}
      aria-label={allocationSummary(row)}
    >
      {label}
    </span>
  );
}

// New-arrivals header chip (E140) — one renderer shared by the list view's
// CategorySection headerAction slot and the grid view's DeckCardGrid section
// header (a sibling component, not nested, so this can't be a closure).
// Renders nothing when the bucket has no arrivals — never an empty affordance.
export function renderArrivalsChip(
  bucket: TypeGroup,
  arrivalsByType: ArrivalsByType | undefined,
  onOpen: (bucket: TypeGroup) => void
): React.ReactNode {
  const count = arrivalsByType?.[bucket]?.length ?? 0;
  if (count === 0) return null;
  const label = TYPE_GROUP_PLURAL[bucket];
  return (
    <button
      type="button"
      className="deck-arrivals-chip"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(bucket);
      }}
      aria-label={`${count} new card${count === 1 ? '' : 's'} in your collection for ${label} — review`}
    >
      <span aria-hidden>✦</span> {count} new
    </button>
  );
}

// A single deck-list / grid role badge, now tap-to-reveal: on touch (no
// hover) the native `title` tooltip never appears, so tapping the badge
// opens a popover with the full role key — the tapped role highlighted.
// Tapping the badge on mobile shows just the role name — no legend.
// The full legend is still reachable via the toolbar "Show" → "What do
// the role badges mean?" disclosure. Desktop keeps the native title
// hover tooltip so it still works without a tap.
export function RoleBadge({ card, variant }: { card: ScryfallCard; variant: 'row' | 'grid' }) {
  const roleBadge = getRoleBadge(card);
  if (!roleBadge) return null;
  const multi = variant === 'row' && isMultiRole(card);
  const baseClass = variant === 'grid' ? 'deck-card-grid-role' : 'deck-row-role-badge';
  const toneClass = multi ? 'deck-row-role-multi' : `deck-row-role-${roleBadge.tone}`;
  const tipText = multi ? multiRoleTitle(card) : roleBadge.title;
  return (
    <ToolbarPopover
      wrapperClassName="role-badge-pop-wrap"
      triggerClassName={`role-badge-btn ${baseClass} ${toneClass}`}
      triggerTitle={tipText}
      triggerAriaLabel={`Role: ${tipText}`}
      triggerContent={
        multi ? <span className="deck-row-role-multi-dot" aria-hidden /> : roleBadge.label
      }
    >
      {() => <div className="role-badge-pop">{tipText}</div>}
    </ToolbarPopover>
  );
}
// ── Legality badge ──────────────────────────────────────────────────────
// Shared by list and grid view. Theme-colored; caller sets size/position
// via className.
export function LegalityBadge({ issue, className }: { issue: LegalityIssue; className: string }) {
  return (
    <span className={className} role="img" aria-label={issue.detail} title={issue.detail}>
      <CircleAlert width="100%" height="100%" strokeWidth={2.2} aria-hidden />
    </span>
  );
}
// Commander-section header control for adding / changing the partner
// commander. Shared by the list and grid views so the affordance reads the
// same in both. Label flips to "Edit partner" once a partner is set.
export function PartnerHeaderButton({
  hasPartner,
  onClick,
}: {
  hasPartner: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="btn-link deck-section-partner-btn"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {hasPartner ? 'Edit partner' : '+ Add partner'}
    </button>
  );
}
