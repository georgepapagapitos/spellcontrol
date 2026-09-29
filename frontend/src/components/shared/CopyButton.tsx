import type { ComponentPropsWithRef, ReactElement } from 'react';
import { Check, Clipboard } from 'lucide-react';
import { Button, IconButton, type ButtonVariant } from './Button';
import { useCopyFeedback } from '@/lib/util/use-copy-feedback';

/**
 * The in-place half of the copy-confirmation rule (STYLE_GUIDE § Verbs —
 * Copy): a Copy control that stays on screen swaps its own label to
 * "Copied" (plus a check icon, if it has one) for one fixed duration, then
 * reverts, with the swap announced to a screen reader through a live
 * region. A failed copy toasts an error instead of swapping.
 *
 * For a control this doesn't fit (a bespoke non-`Button` trigger), reach for
 * `useCopyFeedback` (`lib/util/use-copy-feedback.ts`) directly instead of
 * re-deriving this behaviour by hand.
 */

type NativeButtonProps = Omit<
  ComponentPropsWithRef<'button'>,
  'children' | 'onClick' | 'type' | 'className' | 'value'
>;

export type CopyButtonProps = NativeButtonProps & {
  /** Text to copy, or a function producing it lazily at click time. */
  value: string | (() => string);
  /** Names what's being copied, for the failure toast only: "Couldn't copy {what}." */
  what: string;
  /** Visible label before/after copying. */
  label?: string;
  copiedLabel?: string;
  /** Shows the clipboard/check glyph pair beside the label. Off by default —
   *  most Copy buttons in this app are text-only. */
  icon?: boolean;
  variant?: ButtonVariant;
  className?: string;
};

export function CopyButton({
  value,
  what,
  label = 'Copy',
  copiedLabel = 'Copied',
  icon = false,
  variant,
  className,
  ...rest
}: CopyButtonProps) {
  const { copied, announcement, copy } = useCopyFeedback({ what });
  return (
    <>
      <Button
        {...rest}
        variant={variant}
        className={className}
        onClick={() => copy(typeof value === 'function' ? value() : value)}
        icon={
          icon ? (
            copied ? (
              <Check width={14} height={14} strokeWidth={1.8} />
            ) : (
              <Clipboard width={14} height={14} strokeWidth={1.8} />
            )
          ) : undefined
        }
      >
        {copied ? copiedLabel : label}
      </Button>
      {/* No `role="status"`: a page can hold several of these (and its own
          unrelated status regions), and `role="status"` would make every
          one of them match a bare `getByRole('status')` query. `aria-live`
          alone still announces without an ARIA role. */}
      <span className="sr-only copy-feedback-announce" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}

export type CopyIconButtonProps = NativeButtonProps & {
  value: string | (() => string);
  what: string;
  /** Accessible name and tooltip — stays put across the copied state; the
   *  live region carries the state change instead. */
  label: string;
  icon: ReactElement;
  className?: string;
};

/** The icon-only twin of `CopyButton`, built on `IconButton` — for a copy
 *  trigger with no visible text (a dock header glyph, a toolbar rect). */
export function CopyIconButton({
  value,
  what,
  label,
  icon,
  className,
  ...rest
}: CopyIconButtonProps) {
  const { copied, announcement, copy } = useCopyFeedback({ what });
  return (
    <>
      <IconButton
        {...rest}
        className={className}
        label={label}
        icon={copied ? <Check size={16} /> : icon}
        onClick={() => copy(typeof value === 'function' ? value() : value)}
      />
      <span className="sr-only copy-feedback-announce" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
