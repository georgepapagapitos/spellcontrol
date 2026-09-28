import type { ComponentPropsWithRef } from 'react';
import type { Tone } from './Chip';

/**
 * A count bubble: active filters on a trigger, unread on a nav door, items
 * in a tab (STYLE_GUIDE § Nav chrome, "Badge counts"). `placement` is where
 * it sits: `inline` after a label, or `corner` pinned to its control's
 * corner. Both it and `tone` render as data attributes for the family's CSS;
 * the family's own class still paints it until the count convergence.
 *
 * It renders nothing at zero, so a caller never guards `n > 0 &&` itself.
 *
 * A bare number means nothing to a screen reader, so the count is
 * `aria-hidden` and the control it sits in says it in words ("Filters, 3
 * active"). When the count stands alone with no such control, give it
 * `label` and it becomes an image with that name instead.
 */

type SpanProps = Omit<
  ComponentPropsWithRef<'span'>,
  'className' | 'children' | 'aria-label' | 'aria-hidden'
>;

export interface CountProps extends SpanProps {
  /** The family's own class, e.g. `collection-filters-badge`. */
  className: string;
  value: number;
  placement: 'inline' | 'corner';
  tone?: Tone;
  /** Only for a count no control names: "3 unread". */
  label?: string;
  /** Rendered in place of the number, e.g. `99+` past a cap. */
  display?: string;
}

export function Count({ className, value, placement, tone, label, display, ...rest }: CountProps) {
  if (value <= 0) return null;
  return (
    <span
      {...rest}
      className={`count-badge ${className}`}
      data-placement={placement}
      data-tone={tone}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {display ?? value}
    </span>
  );
}
