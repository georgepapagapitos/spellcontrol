import type { ComponentPropsWithRef, CSSProperties } from 'react';
import './SwipeRow.css';

/**
 * A row of tiles (STYLE_GUIDE § Layout system, "A row of tiles is a grid on
 * desktop and a swipe row below it"). Below 1024px it is one horizontal row
 * that snaps per tile: each tile under three-quarters of a phone's width and
 * 30% of a tablet's, so the next one peeks in and the row reads as
 * scrollable, running out to the screen edge past the page gutter. From
 * 1024px it is a grid of `columns` across.
 *
 * The tiles are the surface's own (`.decks-index-card`, `DiscoverDeckTile`),
 * never a second design of the same object, so `className` carries the
 * list's own classes (`decks-index-list is-grid`) and the row lays them out.
 */
export type SwipeRowProps = Omit<ComponentPropsWithRef<'ul'>, 'className'> & {
  /** The list's own classes, e.g. `decks-index-list is-grid`. */
  className: string;
  /** Tiles across on desktop. */
  columns?: number;
};

export function SwipeRow({ className, columns = 5, style, ...rest }: SwipeRowProps) {
  return (
    <ul
      {...rest}
      className={`swipe-row ${className}`}
      data-swipe-row=""
      style={{ ...style, '--swipe-columns': columns } as CSSProperties}
    />
  );
}
