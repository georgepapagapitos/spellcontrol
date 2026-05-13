import { useNavigate } from 'react-router-dom';

interface Props {
  /** Binder identity. Null/undefined → no badge. */
  binderId: string | null | undefined;
  binderName: string | null | undefined;
  /** Binder color used for the swatch. Falls back to the accent token. */
  binderColor: string | null | undefined;
}

/**
 * "In a binder" indicator used by the collection list. Mirrors DeckBadge in
 * shape and position. Clicking jumps to the binder detail page.
 */
export function BinderBadge({ binderId, binderName, binderColor }: Props) {
  const navigate = useNavigate();
  if (!binderId || !binderName) return null;
  const label = `In binder: ${binderName}`;
  return (
    <button
      type="button"
      className="card-list-binder-badge"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/binders/${binderId}`);
      }}
    >
      <span
        className="card-list-binder-badge-swatch"
        style={{ background: binderColor || 'var(--accent)' }}
        aria-hidden
      />
    </button>
  );
}
