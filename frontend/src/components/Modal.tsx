import { useEffect, type ReactNode } from 'react';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';

interface Props {
  onClose: () => void;
  /** id of an element inside the modal that labels it (sets aria-labelledby). */
  labelledBy?: string;
  /** Static aria-label, used when there is no visible title element to reference. */
  label?: string;
  /** Class for the inner dialog container. Defaults to `choice-dialog`. */
  className?: string;
  /** Disable closing on backdrop click or Escape. Used when work is in flight. */
  dismissable?: boolean;
  children: ReactNode;
}

/**
 * Shared modal primitive: renders the standard `modal-backdrop` + dialog
 * container, locks body scroll, and closes on Escape / backdrop click.
 *
 * Keeps the existing CSS class names so per-dialog styling (`choice-dialog`,
 * `modal card-edit-dialog`, etc.) is unchanged — pass via `className`.
 */
export function Modal({
  onClose,
  labelledBy,
  label,
  className = 'choice-dialog',
  dismissable = true,
  children,
}: Props) {
  useLockBodyScroll();

  useEffect(() => {
    // Restore focus to whatever was focused before the modal opened, so
    // keyboard / screen-reader users aren't dropped at the top of the page
    // when it closes.
    const prevFocused = document.activeElement as HTMLElement | null;
    return () => prevFocused?.focus?.();
  }, []);

  useEffect(() => {
    if (!dismissable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, dismissable]);

  return (
    <div className="modal-backdrop" onClick={dismissable ? onClose : undefined} role="presentation">
      <div
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
