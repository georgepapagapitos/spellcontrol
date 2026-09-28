import type { ComponentPropsWithRef } from 'react';

/**
 * One of the three resting surfaces (STYLE_GUIDE § Layout system, Surfaces):
 *
 * - `sleeve`: an index tile. `--surface-raised` + `--shadow-card`, no outline.
 * - `framed`: an in-page section card. `--surface`, a hairline, `--radius-lg`.
 * - `popover`: an anchored panel. `--surface` + `--shadow-tooltip`.
 *
 * `variant` renders as `data-surface`; the family's own class still paints
 * it until the surface convergence gives each variant one look. `as` picks
 * the element for the role (`li` in a list of tiles, `section` for a titled
 * panel). A surface is never a control: a tile that is itself a link or a
 * button keeps its own element.
 */

type Tag = 'div' | 'section' | 'article' | 'aside' | 'li';

export type SurfaceProps = Omit<ComponentPropsWithRef<'div'>, 'className'> & {
  variant: 'sleeve' | 'framed' | 'popover';
  as?: Tag;
  /** The family's own class, e.g. `deck-combos-panel`. */
  className: string;
};

export function Surface({ variant, as: Element = 'div', className, ...rest }: SurfaceProps) {
  // The props are the div's; every tag in `Tag` takes the same global set.
  const Tag = Element as 'div';
  return <Tag {...rest} className={className} data-surface={variant} />;
}
