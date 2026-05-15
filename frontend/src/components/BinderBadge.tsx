import { Notebook } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Props {
  /** Binder identity. Null/undefined → no badge. */
  binderId: string | null | undefined;
  binderName: string | null | undefined;
  /** Binder color used for the icon. Falls back to the accent token. */
  binderColor: string | null | undefined;
}

export function BinderBadge({ binderId, binderName, binderColor }: Props) {
  const navigate = useNavigate();
  if (!binderId || !binderName) return null;
  const label = `In binder: ${binderName}`;
  const color = binderColor || 'var(--accent)';
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
        navigate(`/binders/${binderId}`);
      }}
    >
      <Notebook width={11} height={11} strokeWidth={2} aria-hidden />
    </button>
  );
}
