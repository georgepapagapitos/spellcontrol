import './HomeCard.css';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { readHomeShape, rememberHomeShape } from '../../lib/home-shape';

interface Props {
  title: string;
  icon?: LucideIcon;
  /** Short qualifier after the title ("since Sep 22"). */
  meta?: ReactNode;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Nothing to show: the card renders nothing at all (STYLE_GUIDE § Home). */
  empty?: boolean;
  viewAllHref?: string;
  viewAllLabel?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Shared shell for /home's cards: title (+ meta) and a door in the header,
 * then exactly one of a loading skeleton, an error + Retry, or the card's own
 * content.
 *
 * An empty card renders NOTHING. It used to collapse to a 44px invitation row,
 * which still claimed a whole grid cell and left a hole beside its tall
 * neighbour; four of them made a quarter of the page say "nothing here".
 * Every door those rows carried now lives somewhere with content (the hero's
 * actions, Waiting on you, Around the table).
 *
 * While loading, the shell takes the footprint it resolved to on this
 * browser's last visit (lib/home-shape, keyed by title): a card that ended up
 * empty stays absent, a card that had content reserves its last height.
 * Resolving then happens in place instead of reflowing the page (E277).
 */
export function HomeCard({
  title,
  icon: Icon,
  meta,
  loading,
  error,
  onRetry,
  empty,
  viewAllHref,
  viewAllLabel,
  className,
  children,
}: Props) {
  // Read once at mount — the reservation only matters for the first paint.
  const [remembered] = useState(() => readHomeShape()[title]);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (loading || error) return;
    // Measured, not derived: the card's box is what the next visit reserves.
    // Floors at 1 so "present, height unknown" (jsdom) never reads as empty.
    rememberHomeShape(title, empty ? 0 : Math.max(1, ref.current?.offsetHeight ?? 0));
  });

  if ((!loading && !error && empty) || (loading && remembered === 0)) return null;

  const reserved = loading && typeof remembered === 'number' && remembered > 1;
  return (
    <section
      className={`home-card${className ? ` ${className}` : ''}`}
      ref={ref}
      aria-label={title}
      style={reserved ? { minHeight: remembered } : undefined}
    >
      <div className="home-card-header">
        <h2 className="home-card-title">
          {Icon && <Icon width={16} height={16} strokeWidth={1.8} aria-hidden />}
          {title}
        </h2>
        {meta && <span className="home-card-meta">{meta}</span>}
        {viewAllHref && !loading && (
          <Link to={viewAllHref} className="home-door">
            {viewAllLabel ?? 'View all'}
            <ChevronRight width={14} height={14} strokeWidth={2} aria-hidden />
          </Link>
        )}
      </div>
      <div className="home-card-body">
        {loading ? (
          <div className="home-card-skeleton" role="status" aria-label="Loading" aria-busy="true">
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
    </section>
  );
}
