import './CardThumb.css';
import { type JSX, type ReactNode, useState } from 'react';

/**
 * The shared card-art thumbnail — an `<img>` that shows a shimmer skeleton
 * while it loads (instead of flashing a flat grey box) and a graceful
 * fallback if the art 404s or fails to resolve.
 *
 * Sizing/shape is the host's job: pass the surface's existing image class
 * (e.g. `card-group-img`) as `className` and it lands on the WRAPPER, which
 * carries the width/aspect-ratio/radius. The inner img fills it via
 * `.card-thumb-img` (object-fit: cover), so the skeleton overlay matches the
 * rendered art box exactly. Reuses the global `skeleton-shimmer` keyframe.
 */
export interface CardThumbProps {
  src: string;
  alt: string;
  /** Sizing/shape classes for the wrapper — the surface's existing image class. */
  className?: string;
  loading?: 'lazy' | 'eager';
  /** Decorative thumbs: empty alt + aria-hidden so SRs skip them. */
  decorative?: boolean;
  /** Rendered when the image fails to load. Defaults to a muted name plate. */
  fallback?: ReactNode;
}

export function CardThumb({
  src,
  alt,
  className = '',
  loading = 'lazy',
  decorative,
  fallback,
}: CardThumbProps): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  return (
    <span className={`card-thumb ${className}`.trim()}>
      {!loaded && !errored && <span className="card-thumb-skeleton" aria-hidden="true" />}
      {errored ? (
        (fallback ?? (
          <span className="card-thumb-fallback" aria-hidden={decorative || undefined}>
            {decorative ? null : alt}
          </span>
        ))
      ) : (
        <img
          className="card-thumb-img"
          src={src}
          alt={decorative ? '' : alt}
          aria-hidden={decorative || undefined}
          loading={loading}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
        />
      )}
    </span>
  );
}
