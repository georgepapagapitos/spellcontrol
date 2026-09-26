import {
  cloneElement,
  isValidElement,
  type ComponentPropsWithRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link, type LinkProps } from 'react-router-dom';

/**
 * The app's action controls: `Button` and `IconButton` (STYLE_GUIDE § Shape
 * language — corners, and the Primitives index).
 *
 * Both render the long-standing CSS classes rather than new ones, so a call
 * site moved onto them paints exactly what it painted before. What they add is
 * the part a class name could not enforce:
 *
 * - the label always sits in its own element (`.btn-label`),
 * - an icon is always `aria-hidden` (the label, or `IconButton`'s required
 *   `label`, carries the name),
 * - a `<button>` defaults to `type="button"`, so one inside a form never
 *   submits it by accident,
 * - `to` renders a router `<Link>` and `href` an `<a>`, so a navigation is a
 *   link and an action is a button, never a `<div onClick>`.
 */

export type ButtonVariant = 'secondary' | 'primary' | 'danger' | 'link';

/**
 * Where the button lives, which is what separates the three families:
 * `inline` (`.btn`, dialogs and panels, grey hover), `row` (`.pill-btn`, page
 * heroes and action rows: accent-tinted hover, a 0.4rem icon gap, never
 * shrinks), `toolbar` (`.toolbar-pill`, the toolbar-control pill).
 */
export type ButtonPlacement = 'inline' | 'row' | 'toolbar';

type Look =
  | { placement?: 'inline'; variant?: ButtonVariant }
  | { placement: 'row'; variant?: Exclude<ButtonVariant, 'link'> }
  | { placement: 'toolbar'; variant?: 'secondary' };

// Literal strings, never `btn-${variant}`: css-chunk-ownership.test.ts reads
// class tokens out of the source and cannot see an interpolated one.
const CLASSES = {
  inline: {
    secondary: 'btn',
    primary: 'btn btn-primary',
    danger: 'btn btn-danger',
    link: 'btn-link',
  },
  row: {
    secondary: 'pill-btn',
    primary: 'pill-btn pill-btn-primary',
    danger: 'pill-btn pill-btn-danger',
  },
  toolbar: { secondary: 'toolbar-pill' },
} as const;

function lookClass(placement: ButtonPlacement = 'inline', variant: ButtonVariant = 'secondary') {
  return (CLASSES[placement] as Partial<Record<ButtonVariant, string>>)[variant] ?? '';
}

type AsButton = Omit<ComponentPropsWithRef<'button'>, 'children' | 'className'> & {
  to?: never;
  href?: never;
};
type AsLink = Omit<LinkProps & ComponentPropsWithRef<'a'>, 'children' | 'className'> & {
  href?: never;
};
type AsAnchor = Omit<ComponentPropsWithRef<'a'>, 'children' | 'className'> & {
  href: string;
  to?: never;
};
type Target = AsButton | AsLink | AsAnchor;

/** A lucide glyph (or any element that accepts `aria-hidden`). */
type Icon = ReactElement<{ 'aria-hidden'?: boolean }> | null | false | undefined;

function hidden(icon: Icon) {
  // Cloned, not wrapped: a wrapper span around an svg adds a line box and can
  // change the button's height.
  return isValidElement(icon) ? cloneElement(icon, { 'aria-hidden': true }) : null;
}

function render(cls: string, rest: Target, content: ReactNode) {
  if ('to' in rest && rest.to !== undefined) {
    return (
      <Link {...(rest as AsLink)} className={cls}>
        {content}
      </Link>
    );
  }
  if ('href' in rest && rest.href !== undefined) {
    return (
      <a {...(rest as AsAnchor)} className={cls}>
        {content}
      </a>
    );
  }
  const { type = 'button', ...button } = rest as AsButton;
  return (
    <button {...button} type={type} className={cls}>
      {content}
    </button>
  );
}

const join = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(' ');

export type ButtonProps = Look &
  Target & {
    /** Leading glyph, rendered `aria-hidden`. */
    icon?: Icon;
    /** Trailing glyph (a chevron, an external-link mark), rendered `aria-hidden`. */
    iconEnd?: Icon;
    /** A surface modifier, appended after the variant's classes. */
    className?: string;
    /** The label. Always rendered inside `.btn-label`. */
    children: ReactNode;
  };

export function Button({
  variant,
  placement,
  icon,
  iconEnd,
  className,
  children,
  ...rest
}: ButtonProps) {
  return render(
    join(lookClass(placement, variant), className),
    rest as Target,
    <>
      {hidden(icon)}
      <span className="btn-label">{children}</span>
      {hidden(iconEnd)}
    </>
  );
}

/** `Omit` over each member of a union. A plain `Omit<Target, …>` keeps only the
 *  keys every member shares, which dropped `disabled` (a link has none) and
 *  left an `IconButton` stepper with no way to turn off at its limit. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type IconButtonProps = Partial<Look> &
  DistributiveOmit<Target, 'aria-label' | 'title'> & {
    /** The accessible name. Also the hover tooltip unless `title` says otherwise. */
    label: string;
    icon: NonNullable<Icon>;
    /** Tooltip text; defaults to `label`. `false` renders none. */
    title?: string | false;
    className?: string;
  };

/**
 * An icon with no visible text. `label` is required, so an unnamed icon
 * button cannot compile. With no `variant`/`placement` it adds no shared class
 * and the surface's own `className` carries the look (most icon-only buttons
 * are one-off close, step and menu controls); pass a variant to get `.btn`'s.
 */
export function IconButton({
  variant,
  placement,
  label,
  icon,
  title,
  className,
  ...rest
}: IconButtonProps) {
  const shared = variant || placement ? lookClass(placement, variant) : '';
  return render(
    join(shared, className),
    {
      ...(rest as Target),
      'aria-label': label,
      title: title === false ? undefined : (title ?? label),
    } as Target,
    hidden(icon)
  );
}
