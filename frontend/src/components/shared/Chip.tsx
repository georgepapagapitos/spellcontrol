import {
  cloneElement,
  isValidElement,
  type ComponentPropsWithRef,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button';

/**
 * A chip: a small labelled pill or rect that names a state, filters a list,
 * or opens something (STYLE_GUIDE § Shape language, "Chips are a primitive").
 *
 * Chips have no shared look: every family keeps its own class, passed as
 * `className`, so a call site moved onto `Chip` paints what it did before.
 * What `Chip` adds is the structure, one way for each role:
 *
 * - no handler: a label chip, `<span>` (or `<li>` inside a list);
 * - `pressed` + `onClick`: a filter toggle, `<button aria-pressed>`;
 * - `onClick` alone: an action chip, `<button>`;
 * - `onRemove`: a removable chip, a label plus a sibling × `IconButton` (never
 *   nested inside another control).
 *
 * The label always sits in its own element (`.chip-label`). A count badge or
 * state mark that must stay a separate flex item goes in `trailing`; a leading
 * glyph or set icon goes in `icon`, rendered `aria-hidden`.
 */

type Icon = ReactElement<{ 'aria-hidden'?: boolean }> | null | false | undefined;

interface Base {
  /** The chip family's own class, e.g. `verdict-chip is-success`. */
  className: string;
  /** Added to `.chip-label` itself. */
  labelClassName?: string;
  /** The label's own tooltip: the full name of one that truncates. */
  labelTitle?: string;
  /** Leading glyph or icon, rendered `aria-hidden`. */
  icon?: Icon;
  /** A badge or mark kept as its own element after the label (a count). */
  trailing?: ReactNode;
  children: ReactNode;
}

type SpanProps = Omit<ComponentPropsWithRef<'span'>, 'className' | 'children' | 'onClick'>;
type ButtonProps = Omit<ComponentPropsWithRef<'button'>, 'className' | 'children' | 'onClick'>;

type LabelChip = Base &
  Omit<SpanProps, 'ref'> & {
    /** `li` when the chip is an item of a list. */
    as?: 'span' | 'li';
    pressed?: never;
    onClick?: never;
    onRemove?: never;
  };
type FilterChip = Base &
  ButtonProps & {
    pressed: boolean;
    onClick: NonNullable<ComponentPropsWithRef<'button'>['onClick']>;
    as?: never;
    onRemove?: never;
  };
type ActionChip = Base &
  ButtonProps & {
    onClick: NonNullable<ComponentPropsWithRef<'button'>['onClick']>;
    pressed?: never;
    as?: never;
    onRemove?: never;
  };
type RemovableChip = Base &
  SpanProps & {
    onRemove: NonNullable<ComponentPropsWithRef<'button'>['onClick']>;
    /** The × button's accessible name, e.g. "Remove filter: Red". */
    removeLabel: string;
    removeClassName?: string;
    /** Defaults to a 12px X. */
    removeIcon?: NonNullable<Icon>;
    as?: never;
    pressed?: never;
    onClick?: never;
  };

export type ChipProps = LabelChip | FilterChip | ActionChip | RemovableChip;

const join = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(' ');
const hidden = (icon: Icon) =>
  isValidElement(icon) ? cloneElement(icon, { 'aria-hidden': true }) : null;

export function Chip(props: ChipProps) {
  const { className, labelClassName, labelTitle, icon, trailing, children } = props;
  const body = (
    <>
      {hidden(icon)}
      <span className={join('chip-label', labelClassName)} title={labelTitle}>
        {children}
      </span>
      {trailing}
    </>
  );

  if ('onRemove' in props && props.onRemove) {
    const {
      onRemove,
      removeLabel,
      removeClassName,
      removeIcon,
      className: _c,
      labelClassName: _l,
      labelTitle: _lt,
      icon: _i,
      trailing: _t,
      children: _ch,
      ...rest
    } = props;
    return (
      <span {...rest} className={className}>
        {body}
        <IconButton
          className={removeClassName}
          label={removeLabel}
          icon={removeIcon ?? <X width={12} height={12} strokeWidth={2.5} />}
          onClick={onRemove}
        />
      </span>
    );
  }

  if ('onClick' in props && props.onClick) {
    const {
      pressed,
      type = 'button',
      className: _c,
      labelClassName: _l,
      labelTitle: _lt,
      icon: _i,
      trailing: _t,
      children: _ch,
      ...rest
    } = props as FilterChip | ActionChip;
    return (
      <button {...rest} type={type} className={className} aria-pressed={pressed}>
        {body}
      </button>
    );
  }

  const {
    as: Tag = 'span',
    className: _c,
    labelClassName: _l,
    labelTitle: _lt,
    icon: _i,
    trailing: _t,
    children: _ch,
    ...rest
  } = props as LabelChip;
  return (
    <Tag {...(rest as HTMLAttributes<HTMLElement>)} className={className}>
      {body}
    </Tag>
  );
}
