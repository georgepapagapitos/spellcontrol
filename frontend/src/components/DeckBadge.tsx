import { Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AllocationInfo } from '../lib/allocations';

interface Props {
  /** All deck allocations covering this row's copies. Empty/undefined → no badge. */
  allocations: AllocationInfo[];
}

/**
 * Small "in a deck" indicator used by the binder + collection lists.
 * Single allocation → links to that deck. Multiple → unlinked badge with
 * a tooltip listing every deck name (clicking would have to pick one,
 * and that's a worse experience than just "tells you it's elsewhere").
 */
export function DeckBadge({ allocations }: Props) {
  if (allocations.length === 0) return null;

  // Dedupe by deckId — a single deck can claim multiple copies of the
  // same card, but the badge shouldn't repeat a deck name.
  const byDeck = new Map<string, AllocationInfo>();
  for (const a of allocations) byDeck.set(a.deckId, a);
  const decks = [...byDeck.values()];
  const summary = decks.map((d) => d.deckName).join(', ');
  const label =
    decks.length === 1 ? `In deck: ${decks[0].deckName}` : `In ${decks.length} decks: ${summary}`;

  if (decks.length === 1) {
    const color = decks[0].deckColor || 'var(--accent)';
    return (
      <Link
        to={`/decks/${decks[0].deckId}`}
        className="card-list-deck-badge"
        style={{ '--deck-color': color } as React.CSSProperties}
        title={label}
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <Layers width={11} height={11} strokeWidth={2} aria-hidden />
      </Link>
    );
  }

  return (
    <span
      className="card-list-deck-badge card-list-deck-badge--multi"
      title={label}
      aria-label={label}
    >
      <Layers width={11} height={11} strokeWidth={2} aria-hidden />
      <span className="card-list-deck-badge-count" aria-hidden>
        {decks.length}
      </span>
    </span>
  );
}
