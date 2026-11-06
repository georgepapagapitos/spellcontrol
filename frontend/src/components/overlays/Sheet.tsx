import { useId, useImperativeHandle, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from '@/components/shared/Button';
import { useLockBodyScroll } from '@/lib/overlays/use-lock-body-scroll';
import { useSheetExit } from '@/lib/overlays/use-sheet-exit';

/** `close` plays the sheet's exit, then calls `onClose`. Route every dismiss
 *  a sheet's own controls raise (Done, Cancel, a pick that ends the flow)
 *  through it, never through the raw `onClose`. */
/** For a close the sheet's own JSX doesn't raise: an auto-close timer, a
 *  handler that acts and then dismisses. */
export interface SheetHandle {
  close: () => void;
}

type SheetSlot = ReactNode | ((close: () => void) => ReactNode);

interface Props {
  onClose: () => void;
  /** Visible heading. It also names the dialog (aria-labelledby). */
  title: ReactNode;
  /** Accessible name when the visible title isn't enough on its own. */
  label?: string;
  /** Small label above the title, when the title is a name ("Card tags" over
   *  the card's name). */
  eyebrow?: ReactNode;
  /** One muted line under the title. */
  description?: ReactNode;
  /** Controls that sit in the header under the title, inside its inset and
   *  above its divider: a search field, a segmented control, a filter row. */
  toolbar?: ReactNode;
  /** The scrolling content. Rendered directly into the panel, so a list
   *  (`.card-picker-list`) or body (`.add-card-sheet-body`) owns its scroll. */
  children: SheetSlot;
  /** Footer actions, right-aligned in `.card-picker-footer`. */
  footer?: SheetSlot;
  /** A close (X) button at the header's end, for a sheet with no footer to
   *  dismiss it from. */
  closeButton?: boolean;
  /** Extra classes on the footer. */
  footerClassName?: string;
  /** Extra classes on the panel. */
  className?: string;
  /** Extra classes on the fixed root (a stronger scrim, a z-index lift). */
  rootClassName?: string;
  /**
   * `false` for a sheet that has to be answered: no backdrop or Escape
   * dismiss, and no drag handle (users read the handle as "drag down to
   * dismiss", STYLE_GUIDE overlays appendix).
   */
  dismissable?: boolean;
  /**
   * Render where it's mounted instead of portaling to <body>. Only for the
   * play table and playtest board, whose sheets stay inside the rotated seat
   * that opened them (overlay-roots-portal-to-body.test.ts exempts them).
   */
  inPlace?: boolean;
  ref?: Ref<SheetHandle>;
  /** id on the panel, for a trigger's aria-controls. */
  id?: string;
}

/**
 * The bottom sheet (centered panel at 1024px and up) every picker, chooser
 * and short flow in the app uses: portal, scrim, drag handle, header with
 * title, footer, focus trap, Escape and Back, body scroll lock, and the
 * symmetric slide-out. The `.card-picker-*` classes are the shell's CSS in
 * binder-card-management.css.
 *
 * Before this existed each sheet typed the shell out by hand, so each one
 * also decided its own header inset, exit keyframe and dismiss wiring. The
 * binder "Add card" sheet dropped a search field straight into the panel
 * with no inset, and it ran edge to edge across the dialog. The header owns
 * the inset here, so anything passed as `toolbar` gets it by construction.
 * `sheet-shell.test.ts` keeps new sheets on this component.
 */
export function Sheet({
  onClose,
  title,
  label,
  eyebrow,
  description,
  toolbar,
  children,
  footer,
  closeButton = false,
  footerClassName,
  className,
  rootClassName,
  dismissable = true,
  inPlace = false,
  ref,
  id,
}: Props) {
  useLockBodyScroll();
  const titleId = useId();

  // Below 1024px the panel slides up, so a dismiss plays the symmetric
  // `binder-sheet-slide-out` first. At 1024px and up it's a centered panel
  // with `animation: none`, so every close there is immediate.
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(
    onClose,
    'binder-sheet-slide-out',
    { instantAt: '(min-width: 1024px)', escape: dismissable }
  );
  const close = () => beginClose();
  useImperativeHandle(ref, () => ({ close: () => beginClose() }), [beginClose]);
  const render = (slot: SheetSlot) => (typeof slot === 'function' ? slot(close) : slot);

  const node = (
    <div
      className={`card-picker-root${rootClassName ? ` ${rootClassName}` : ''}`}
      onClick={
        dismissable
          ? (e) => {
              e.stopPropagation();
              if (e.target === e.currentTarget) close();
            }
          : undefined
      }
      role="presentation"
    >
      <div
        id={id}
        className={`card-picker-sheet${className ? ` ${className}` : ''}${
          isClosing ? ' is-closing' : ''
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label ? undefined : titleId}
        aria-label={label}
        onAnimationEnd={onAnimationEnd}
      >
        {dismissable && <div className="card-picker-handle" aria-hidden />}
        <div className="card-picker-header">
          <div className="card-picker-heading">
            <div className="text-stack card-picker-heading-text">
              {eyebrow && <p className="card-picker-eyebrow">{eyebrow}</p>}
              <h2 id={titleId} className="card-picker-title">
                {title}
              </h2>
              {description && <p className="card-picker-description">{description}</p>}
            </div>
            {closeButton && (
              <IconButton
                variant="quiet"
                className="card-picker-close"
                onClick={close}
                label="Close"
                icon={<X width={18} height={18} strokeWidth={2} />}
              />
            )}
          </div>
          {toolbar}
        </div>
        {render(children)}
        {footer && (
          <div className={`card-picker-footer${footerClassName ? ` ${footerClassName}` : ''}`}>
            {render(footer)}
          </div>
        )}
      </div>
    </div>
  );
  return inPlace ? node : createPortal(node, document.body);
}
