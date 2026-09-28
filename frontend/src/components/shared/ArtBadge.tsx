import {
  cloneElement,
  isValidElement,
  type ComponentPropsWithRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { Tone } from './Chip';

/**
 * A badge that sits on card art: a copy count, a deck or binder mark, a
 * role glyph (STYLE_GUIDE § On-art scrims). It is always the scrim plate,
 * never a themed pill, because it has to read on any artwork.
 *
 * `corner` says which corner of the art it pins to and `tone` which status
 * it carries; both render as data attributes for the family's CSS. A badge
 * in a cluster (a row of marks pinned together, like a grid tile's corner)
 * takes no `corner`: the cluster is what pins. The
 * family's own class still paints it (`className`) until the art-badge
 * convergence moves every family onto one plate.
 *
 * An icon-only badge has no text to read, so it takes `label`, which becomes
 * its accessible name (`role="img"`). A text badge (`×2`) can take one too,
 * when the visible text is not what it means ("2 copies").
 */

export type ArtBadgeCorner = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';

type Icon = ReactElement<{ 'aria-hidden'?: boolean }>;

type SpanProps = Omit<ComponentPropsWithRef<'span'>, 'className' | 'children' | 'aria-label'>;

interface Base extends SpanProps {
  /** The family's own class, e.g. `deck-combos-card-qty-badge`. */
  className: string;
  /** Omitted inside a cluster, which pins for it. */
  corner?: ArtBadgeCorner;
  tone?: Tone;
}

type TextBadge = Base & { children: ReactNode; icon?: Icon; label?: string };
type IconBadge = Base & { icon: Icon; label: string; children?: never };

export type ArtBadgeProps = TextBadge | IconBadge;

export function ArtBadge({
  className,
  corner,
  tone,
  icon,
  label,
  children,
  ...rest
}: ArtBadgeProps) {
  return (
    <span
      {...rest}
      className={className}
      data-corner={corner}
      data-tone={tone}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {isValidElement(icon) ? cloneElement(icon, { 'aria-hidden': true }) : null}
      {children}
    </span>
  );
}
