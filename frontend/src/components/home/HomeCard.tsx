import './HomeCard.css';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  title: string;
  icon?: LucideIcon;
  /** Count pill next to the title. Omitted/0 renders no badge. */
  badge?: number;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: boolean;
  emptyText?: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  children: ReactNode;
}

/**
 * Shared shell every /home bento card mounts into: title + optional badge,
 * then exactly one of a loading skeleton, an empty line, an error + Retry, or
 * the card's own content — plus an optional "View all" footer link.
 */
export function HomeCard({
  title,
  icon: Icon,
  badge,
  loading,
  error,
  onRetry,
  empty,
  emptyText,
  viewAllHref,
  viewAllLabel,
  children,
}: Props) {
  // Empty (and not loading/erroring) collapses to a one-line invitation row
  // instead of the full shell — STYLE_GUIDE "Home signal cards" ruling.
  if (!loading && !error && empty) {
    return (
      <div className="home-card home-card--empty">
        {Icon && <Icon width={14} height={14} strokeWidth={1.8} aria-hidden />}
        <h2 className="home-card-title">{title}</h2>
        <span className="home-card-empty">{emptyText ?? 'Nothing here yet.'}</span>
        {viewAllHref && (
          <Link to={viewAllHref} className="home-card-view-all">
            {viewAllLabel ?? 'View all'}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="home-card">
      <div className="home-card-header">
        <h2 className="home-card-title">
          {Icon && <Icon width={14} height={14} strokeWidth={1.8} aria-hidden />}
          {title}
        </h2>
        {!!badge && badge > 0 && <span className="home-card-badge">{badge}</span>}
      </div>
      <div className="home-card-body">
        {loading ? (
          <div className="home-card-skeleton" aria-label="Loading" aria-busy="true">
            <span className="home-card-skeleton-bar" />
            <span className="home-card-skeleton-bar" />
            <span className="home-card-skeleton-bar" />
          </div>
        ) : error ? (
          <div className="home-card-error" role="alert">
            <span>{error}</span>
            {onRetry && (
              <button
                type="button"
                className="home-card-retry"
                aria-label={`Retry loading ${title}`}
                onClick={onRetry}
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          children
        )}
      </div>
      {viewAllHref && (
        <Link to={viewAllHref} className="home-card-view-all">
          {viewAllLabel ?? 'View all'}
        </Link>
      )}
    </div>
  );
}
