import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
 * What counts as focusable for the trap. Deliberately the pragmatic list —
 * not a full a11y-tree walk — covering everything the app's dialogs render.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.closest('[hidden]')
  );
}

/**
 * Stack of mounted modals (a confirm dialog can open on top of an editor
 * modal). Only the topmost modal answers Escape and traps Tab — without
 * this, the modal underneath would yank focus back out of the one on top
 * and a single Escape would close both.
 */
const modalStack: symbol[] = [];

/**
 * Shared modal primitive: renders the standard `modal-backdrop` + dialog
 * container, locks body scroll, and closes on Escape / backdrop click.
 *
 * Keeps the existing CSS class names so per-dialog styling (`choice-dialog`,
 * `modal card-edit-dialog`, etc.) is unchanged — pass via `className`.
 *
 * Motion (STYLE_GUIDE § Motion, pattern 3): the backdrop/panel entrance is
 * pure CSS on `.modal-backdrop` / its `[role='dialog']` child. Dismissals
 * the modal itself owns (Escape, backdrop click) play a 120ms exit first —
 * `beginClose` adds `.is-closing` and defers `onClose` until the panel's
 * `modal-panel-out` animation finishes (mirrors `useSheetExit`, including
 * the reduced-motion bail-out: no animation to wait on → close at once).
 * Closes initiated by the dialog's own buttons call the parent's close
 * handler directly and unmount immediately, exactly as before.
 *
 * Focus: on open, focus moves to the first focusable element (or the panel
 * itself — it carries tabindex={-1} as a fallback); an `autoFocus` child
 * wins because it focuses before the effect runs. Tab / Shift+Tab wrap
 * within the dialog so `aria-modal` is actually true. On unmount, focus
 * returns to whatever was focused before the modal opened.
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

  const panelRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) idRef.current = Symbol('modal');
  const [isClosing, setIsClosing] = useState(false);
  // Ref guard so a double-trigger (e.g. Escape + backdrop click in the same
  // frame) can't start two exits / fire onClose twice before the state
  // re-render lands. Mirrors use-sheet-exit.
  const closingRef = useRef(false);

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  const beginClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    // Reduced motion: the exit keyframe is neutralized in CSS, so the
    // animationend below would never fire — close immediately instead of
    // leaving the dialog stuck.
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setIsClosing(true);
  }, [onClose]);

  const onAnimationEnd = useCallback(
    (e: React.AnimationEvent) => {
      // Ignore the entrance keyframes (and any descendant animation that
      // bubbles up) — only the panel's exit should unmount.
      if (closingRef.current && e.animationName === 'modal-panel-out') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    const id = idRef.current as symbol;
    modalStack.push(id);

    // Move focus into the dialog so Tab starts inside it. An autoFocus
    // child has already focused itself by the time this effect runs —
    // the contains() check leaves it alone.
    const prevFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const first = getFocusable(panel)[0];
      (first ?? panel).focus();
    }

    return () => {
      const idx = modalStack.indexOf(id);
      if (idx !== -1) modalStack.splice(idx, 1);
      // Restore focus to whatever was focused before the modal opened, so
      // keyboard / screen-reader users aren't dropped at the top of the page
      // when it closes. (Runs after the exit animation — unmount is what
      // ends a close.)
      if (prevFocused?.isConnected) prevFocused.focus?.();
    };
  }, []);

  useEffect(() => {
    const id = idRef.current as symbol;
    const onKey = (e: KeyboardEvent) => {
      // Only the topmost modal handles keys — see modalStack.
      if (modalStack[modalStack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        if (dismissable) beginClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = getFocusable(panel);
      if (focusables.length === 0) {
        // Nothing tabbable — keep focus pinned on the panel itself.
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && panel.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [beginClose, dismissable]);

  return (
    <div
      className={`modal-backdrop${isClosing ? ' is-closing' : ''}`}
      onClick={dismissable ? beginClose : undefined}
      onAnimationEnd={onAnimationEnd}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
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
