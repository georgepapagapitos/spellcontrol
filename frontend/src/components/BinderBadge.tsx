import { Notebook } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IconButton } from '@/components/shared/Button';
import { ArtBadge } from '@/components/shared/ArtBadge';

export interface BinderInfo {
  id: string;
  name: string;
  color: string | null;
}

interface Props {
  /** All binders covering this row's copies. Empty → no badge. */
  binders: BinderInfo[];
  /**
   * Override the single-binder tap action instead of navigating to the
   * binder page. For contexts where navigating away would abandon an
   * in-progress flow — e.g. the add-cards sheet, where the whole point is to
   * keep adding cards. Falls back to the navigate behavior when omitted, so
   * every existing call site is unchanged.
   */
  onSelect?: (binder: BinderInfo) => void;
  /**
   * Render the single-binder badge as a plain labelled marker with no action at
   * all — for surfaces that want the indicator but no way out, like the trade
   * dialogs, where leaving mid-offer loses it. Takes precedence over
   * `onSelect`; tooltip and accessible name are unchanged.
   */
  nonInteractive?: boolean;
  /**
   * `art` for a mark on card art (a grid tile's corner cluster): the on-art
   * identity disc, filled with the binder's colour, with no count.
   * `row` (default) is the tinted chip beside a name.
   */
  placement?: 'row' | 'art';
}

/**
 * Small "in a binder" indicator. Single binder → links to it (or calls
 * `onSelect`, if given). Multiple → unlinked badge with a tooltip listing
 * every binder name (mirrors DeckBadge).
 */
export function BinderBadge({ binders, onSelect, nonInteractive, placement = 'row' }: Props) {
  const navigate = useNavigate();
  if (binders.length === 0) return null;

  // Dedupe by id — a row's copies may all route to the same binder.
  const byId = new Map<string, BinderInfo>();
  for (const b of binders) byId.set(b.id, b);
  const unique = [...byId.values()];
  const art = placement === 'art';

  const summary = unique.map((b) => b.name).join(', ');
  const label =
    unique.length === 1
      ? `In binder: ${unique[0].name}`
      : `In ${unique.length} binders: ${summary}`;

  // One binder: its colour. On art it fills the identity disc; on a row it
  // tints the chip.
  const oneStyle = (color: string): React.CSSProperties =>
    art
      ? ({ '--identity-color': color } as React.CSSProperties)
      : ({ '--binder-color': color, color } as React.CSSProperties);
  const glyph = <Notebook width={12} height={12} strokeWidth={2} aria-hidden />;

  // A marker with no action, on art: the plate. Several binders have no one
  // colour, so they stay on the neutral scrim (the plate's `many`), and the count
  // stays in the tooltip.
  if (art && (unique.length > 1 || nonInteractive)) {
    const many = unique.length > 1;
    return (
      <ArtBadge
        className="identity-mark"
        data-identity={many ? 'many' : 'one'}
        style={many ? undefined : oneStyle(unique[0].color || 'var(--accent)')}
        title={label}
        label={label}
      >
        {glyph}
      </ArtBadge>
    );
  }

  if (unique.length === 1 && nonInteractive) {
    return (
      <span
        className="card-list-binder-badge"
        style={oneStyle(unique[0].color || 'var(--accent)')}
        title={label}
        aria-label={label}
        role="img"
      >
        {glyph}
      </span>
    );
  }

  if (unique.length === 1) {
    const b = unique[0];
    return (
      <IconButton
        className={art ? 'art-badge identity-mark' : 'card-list-binder-badge'}
        data-identity={art ? 'one' : undefined}
        style={oneStyle(b.color || 'var(--accent)')}
        onClick={(e) => {
          e.stopPropagation();
          if (onSelect) onSelect(b);
          else navigate(`/collection/binders/${b.id}`);
        }}
        label={label}
        icon={<Notebook width={12} height={12} strokeWidth={2} />}
      />
    );
  }

  return (
    <span
      className="card-list-binder-badge card-list-binder-badge--multi"
      title={label}
      aria-label={label}
      role="img"
    >
      {glyph}
      <span className="card-list-deck-badge-count" aria-hidden>
        {unique.length}
      </span>
    </span>
  );
}
