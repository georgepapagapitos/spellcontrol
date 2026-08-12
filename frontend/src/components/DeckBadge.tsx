import { Layers, Boxes } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AllocationInfo } from '../lib/allocations';

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
}

/**
 * One badge for a set of same-kind owners (decks or physical cubes).
 * Single owner → links to it. Multiple → unlinked count badge whose tooltip
 * lists every name (clicking would have to pick one — worse than just telling
 * you it's committed elsewhere). Cube badges are violet (--cube-color) with a
 * Boxes glyph; deck badges keep their deck color and the Layers glyph.
 */
function OwnerBadge({
  kind,
  owners,
  nonInteractive,
}: {
  kind: 'deck' | 'cube';
  owners: AllocationInfo[];
  nonInteractive?: boolean;
}) {
  if (owners.length === 0) return null;
  const Icon = kind === 'cube' ? Boxes : Layers;
  const noun = kind === 'cube' ? 'cube' : 'deck';
  const plural = kind === 'cube' ? 'cubes' : 'decks';
  const names = owners.map((o) => o.ownerName).join(', ');
  const label =
    owners.length === 1
      ? `In ${noun}: ${owners[0].ownerName}`
      : `In ${owners.length} ${plural}: ${names}`;
  const color =
    kind === 'cube'
      ? 'var(--cube-color)'
      : owners.length === 1
        ? owners[0].ownerColor || 'var(--accent)'
        : 'var(--accent)';
  const style = { '--deck-color': color } as React.CSSProperties;

  if (owners.length === 1 && !nonInteractive) {
    const to =
      kind === 'cube' ? `/collection/cube/${owners[0].ownerId}` : `/decks/${owners[0].ownerId}`;
    return (
      <Link
        to={to}
        className="card-list-deck-badge"
        style={style}
        title={label}
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <Icon width={11} height={11} strokeWidth={2} aria-hidden />
      </Link>
    );
  }

  // The count rides along only when there's more than one owner to count —
  // a lone non-interactive badge is the same marker as the link, minus the link.
  const multi = owners.length > 1;
  return (
    <span
      className={
        multi ? 'card-list-deck-badge card-list-deck-badge--multi' : 'card-list-deck-badge'
      }
      style={style}
      title={label}
      aria-label={label}
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

/**
 * "Committed elsewhere" indicator for the binder + collection lists. Renders a
 * deck badge and/or a cube badge depending on where this row's copies live (a
 * card can have copies in both). Deduped per owner so one deck/cube never
 * repeats.
 */
export function DeckBadge({ allocations, nonInteractive }: Props) {
  if (allocations.length === 0) return null;
  const dedupe = (kind: 'deck' | 'cube'): AllocationInfo[] => {
    const m = new Map<string, AllocationInfo>();
    for (const a of allocations) if (a.ownerKind === kind) m.set(a.ownerId, a);
    return [...m.values()];
  };
  return (
    <>
      <OwnerBadge kind="deck" owners={dedupe('deck')} nonInteractive={nonInteractive} />
      <OwnerBadge kind="cube" owners={dedupe('cube')} nonInteractive={nonInteractive} />
    </>
  );
}
