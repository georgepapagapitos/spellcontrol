import { Layers, Boxes } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AllocationInfo } from '@/lib/collection/allocations';
import type { CubeListing } from '@/lib/cube/cube-listings';
import { ArtBadge } from '@/components/shared/ArtBadge';
import './DeckBadge.css';

interface Props {
  /** All allocations (deck and/or cube) covering this row's copies. Empty → no badge. */
  allocations: AllocationInfo[];
  /**
   * Render the single-owner badge as a plain labelled marker instead of a link.
   * For surfaces where following it would abandon an in-progress flow — the
   * trade dialogs, where leaving for the deck drops the offer being composed.
   * Tooltip and accessible name are unchanged; only the navigation goes.
   */
  nonInteractive?: boolean;
  /**
   * `art` for a mark on card art (a grid tile's corner cluster): the on-art
   * identity disc, filled with the owner's colour, with no count.
   * `row` (default) is the tinted chip beside a name.
   */
  placement?: 'row' | 'art';
  /** Cubes that list this card but hold no copy of it (a draft cube, or a
   *  physical cube's unreserved picks). Renders the dashed cube badge. */
  listedIn?: CubeListing[];
}

/** One owner a badge can name and link to, whatever kind it is. */
interface Owner {
  id: string;
  name: string;
  color: string;
  href: string;
}

/**
 * - deck: a deck holds a copy. The deck's colour, Layers glyph.
 * - cube: a physical cube holds a copy. Violet (--cube-color), Boxes glyph.
 * - listed: a cube lists the card but holds no copy. The cube mark drawn
 *   hollow and dashed (a dashed row chip; on art, the scrim with a dashed
 *   ring), the STYLE_GUIDE mark for "no physical home". The copy stays
 *   available, so this is a note about the cube, not a claim on the card.
 */
type Kind = 'deck' | 'cube' | 'listed';

const WORDS: Record<Kind, { one: string; many: (n: number) => string }> = {
  deck: { one: 'In deck', many: (n) => `In ${n} decks` },
  cube: { one: 'In cube', many: (n) => `In ${n} cubes` },
  listed: { one: 'Listed in cube', many: (n) => `Listed in ${n} cubes` },
};

/**
 * One badge for a set of same-kind owners. Single owner → links to it.
 * Multiple → unlinked badge whose tooltip lists every name (clicking would
 * have to pick one — worse than just telling you where it is).
 */
function OwnerBadge({
  kind,
  owners,
  nonInteractive,
  placement,
}: {
  kind: Kind;
  owners: Owner[];
  nonInteractive?: boolean;
  placement: 'row' | 'art';
}) {
  if (owners.length === 0) return null;
  const Icon = kind === 'deck' ? Layers : Boxes;
  const words = WORDS[kind];
  const multi = owners.length > 1;
  const art = placement === 'art';
  const label = multi
    ? `${words.many(owners.length)}: ${owners.map((o) => o.name).join(', ')}`
    : `${words.one}: ${owners[0].name}`;
  // Several decks have no one colour; every cube kind is the cube's violet.
  const color = kind === 'deck' && multi ? 'var(--accent)' : owners[0].color;
  // On art, several deck/cube owners have no one colour, so the plate's
  // `many` gives them the neutral scrim rather than passing the accent off as
  // an owner's. A listing is always the cube's violet ring, one cube or many.
  const identity = kind === 'listed' ? 'listed' : multi ? 'many' : 'one';
  const style = (
    art
      ? identity === 'many'
        ? undefined
        : { '--identity-color': color }
      : { '--deck-color': color }
  ) as React.CSSProperties | undefined;
  const rowClass =
    kind === 'listed'
      ? 'card-list-deck-badge card-list-deck-badge--listed'
      : 'card-list-deck-badge';

  if (!multi && !nonInteractive) {
    return (
      <Link
        to={owners[0].href}
        className={art ? 'art-badge identity-mark' : rowClass}
        data-identity={art ? identity : undefined}
        style={style}
        title={label}
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <Icon width={11} height={11} strokeWidth={2} aria-hidden />
      </Link>
    );
  }

  // On art the mark is the plate, and it never carries the count: the
  // thumbnail keeps one glyph, and the names are in the tooltip and the
  // accessible name.
  if (art)
    return (
      <ArtBadge
        className="identity-mark"
        data-identity={identity}
        style={style}
        title={label}
        label={label}
      >
        <Icon width={11} height={11} strokeWidth={2} aria-hidden />
      </ArtBadge>
    );

  // The count rides along only when there's more than one owner to count —
  // a lone non-interactive badge is the same marker as the link, minus the link.
  return (
    <span
      className={multi ? `${rowClass} card-list-deck-badge--multi` : rowClass}
      style={style}
      title={label}
      aria-label={label}
      role="img"
    >
      <Icon width={11} height={11} strokeWidth={2} aria-hidden />
      {multi && (
        <span className="card-list-deck-badge-count" aria-hidden>
          {owners.length}
        </span>
      )}
    </span>
  );
}

function allocationOwners(allocations: AllocationInfo[], kind: 'deck' | 'cube'): Owner[] {
  const m = new Map<string, Owner>();
  for (const a of allocations) {
    if (a.ownerKind !== kind) continue;
    m.set(a.ownerId, {
      id: a.ownerId,
      name: a.ownerName,
      color: kind === 'cube' ? 'var(--cube-color)' : a.ownerColor || 'var(--accent)',
      href: a.href ?? (kind === 'cube' ? `/decks/cube/${a.ownerId}` : `/decks/${a.ownerId}`),
    });
  }
  return [...m.values()];
}

/**
 * "Committed elsewhere" indicator for the binder + collection lists. Renders a
 * deck badge and/or a cube badge depending on where this row's copies live (a
 * card can have copies in both). Deduped per owner so one deck/cube never
 * repeats. `listedIn` adds the dashed badge for cubes that only list the card.
 */
export function DeckBadge({
  allocations,
  nonInteractive,
  placement = 'row',
  listedIn = [],
}: Props) {
  if (allocations.length === 0 && listedIn.length === 0) return null;
  const listed: Owner[] = listedIn.map((l) => ({
    id: l.cubeId,
    name: l.cubeName,
    color: 'var(--cube-color)',
    href: `/decks/cube/${l.cubeId}`,
  }));
  return (
    <>
      <OwnerBadge
        kind="deck"
        owners={allocationOwners(allocations, 'deck')}
        nonInteractive={nonInteractive}
        placement={placement}
      />
      <OwnerBadge
        kind="cube"
        owners={allocationOwners(allocations, 'cube')}
        nonInteractive={nonInteractive}
        placement={placement}
      />
      <OwnerBadge
        kind="listed"
        owners={listed}
        nonInteractive={nonInteractive}
        placement={placement}
      />
    </>
  );
}
