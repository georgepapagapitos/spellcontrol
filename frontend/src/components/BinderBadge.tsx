import { Notebook } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export interface BinderInfo {
  id: string;
  name: string;
  color: string | null;
}

interface Props {
  /** All binders covering this row's copies. Empty → no badge. */
  binders: BinderInfo[];
}

/**
 * Small "in a binder" indicator. Single binder → links to it. Multiple →
 * unlinked badge with a tooltip listing every binder name (mirrors DeckBadge).
 */
export function BinderBadge({ binders }: Props) {
  const navigate = useNavigate();
  if (binders.length === 0) return null;

  // Dedupe by id — a row's copies may all route to the same binder.
  const byId = new Map<string, BinderInfo>();
  for (const b of binders) byId.set(b.id, b);
  const unique = [...byId.values()];

  const summary = unique.map((b) => b.name).join(', ');
  const label =
    unique.length === 1
      ? `In binder: ${unique[0].name}`
      : `In ${unique.length} binders: ${summary}`;

  if (unique.length === 1) {
    const b = unique[0];
    const color = b.color || 'var(--accent)';
    return (
      <button
        type="button"
        className="card-list-binder-badge"
        style={
          {
            '--binder-color': color,
            color,
          } as React.CSSProperties
        }
        title={label}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          navigate(`/binders/${b.id}`);
        }}
      >
        <Notebook width={11} height={11} strokeWidth={2} aria-hidden />
      </button>
    );
  }

  return (
    <span
      className="card-list-binder-badge card-list-binder-badge--multi"
      title={label}
      aria-label={label}
    >
      <Notebook width={11} height={11} strokeWidth={2} aria-hidden />
      <span className="card-list-deck-badge-count" aria-hidden>
        {unique.length}
      </span>
    </span>
  );
}
