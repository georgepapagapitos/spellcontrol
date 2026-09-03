import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { focusInto, trapTab, useOverlayLayer } from '../lib/overlay-layer';
import { isNativePlatform } from '../lib/platform';

interface Props {
  onClose: () => void;
  /** id of an element inside the modal that labels it (sets aria-labelledby). */
  labelledBy?: string;
  /** Static aria-label, used when there is no visible title element to reference. */
  label?: string;
  /** Class for the inner dialog container. Defaults to `choice-dialog`. */
  className?: string;
  /** Optional class for the backdrop/root layer. */
  backdropClassName?: string;
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
  backdropClassName,
  dismissable = true,
  children,
}: Props) {
  useLockBodyScroll();

  const panelRef = useRef<HTMLDivElement>(null);
  // Shared with every sheet on `useSheetExit` — a confirm dialog opening on
  // top of a sheet must be the one that answers Escape / hardware back.
  const { isTopmost } = useOverlayLayer();
  const [isClosing, setIsClosing] = useState(false);
  // Ref guard so a double-trigger (e.g. Escape + backdrop click in the same
  // frame) can't start two exits / fire onClose twice before the state
  // re-render lands. Mirrors use-sheet-exit.
  const closingRef = useRef(false);
  // Latest props in refs so the document/back-button listeners below register
  // once. Callers pass inline arrows, and re-subscribing per render swapped
  // the keydown listener out mid-dispatch whenever an earlier listener
  // re-rendered the tree (the deck editor's hint strip did exactly that) —
  // a listener removed during dispatch never fires, so Escape was lost. See
  // use-escape-key.ts.
  const onCloseRef = useRef(onClose);
  const dismissableRef = useRef(dismissable);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissableRef.current = dismissable;
  }, [onClose, dismissable]);

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
      onCloseRef.current();
      return;
    }
    setIsClosing(true);
  }, []);

  const onAnimationEnd = useCallback((e: React.AnimationEvent) => {
    // Ignore the entrance keyframes (and any descendant animation that
    // bubbles up) — only the panel's exit should unmount.
    if (closingRef.current && e.animationName === 'modal-panel-out') onCloseRef.current();
  }, []);

  // Captured during THIS component's render, which happens before any child
  // mounts. Reading it in the mount effect instead was too late whenever the
  // dialog had an `autoFocus` child: `autoFocus` is applied as the DOM node is
  // inserted, so by the time effects ran, `document.activeElement` was already
  // that child. The modal then "restored" focus to its own input — which the
  // close had just unmounted, failing the isConnected check — and the user was
  // dropped on <body>. Measured on the binder editor, whose name field
  // autofocuses; it affects every autoFocus dialog on this primitive.
  const prevFocusedRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)
  );

  useEffect(() => {
    // Move focus into the dialog so Tab starts inside it. An autoFocus
    // child has already focused itself by the time this effect runs —
    // focusInto's contains() check leaves it alone.
    if (panelRef.current) focusInto(panelRef.current);

    const prevFocused = prevFocusedRef.current;
    return () => {
      // Restore focus to whatever was focused before the modal opened, so
      // keyboard / screen-reader users aren't dropped at the top of the page
      // when it closes. (Runs after the exit animation — unmount is what
      // ends a close.)
      if (prevFocused?.isConnected) prevFocused.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Only the topmost overlay handles keys — see useOverlayLayer.
      if (!isTopmost()) return;
      if (e.key === 'Escape') {
        if (dismissableRef.current) beginClose();
        return;
      }
      if (panelRef.current) trapTab(panelRef.current, e);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [beginClose, isTopmost]);

  // Android hardware back button (T11): without a listener, Capacitor's
  // default is to navigate the WebView's own history — which would leave
  // this modal visually stuck open while the page underneath changes. Close
  // the modal instead, same topmost-modal + dismissable gating as Escape
  // above. Native-only; no-op on web (no hardware back event exists there).
  useEffect(() => {
    if (!isNativePlatform()) return;
    const handle = CapacitorApp.addListener('backButton', () => {
      if (!isTopmost()) return;
      if (dismissableRef.current) beginClose();
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [beginClose, isTopmost]);

  // Portal to <body>. A modal rendered in place inherits any ancestor's
  // containing block: a deck hero with `container-type: inline-size` traps
  // `position: fixed`, so the share dialog opened clipped inside the hero
  // with its backdrop dimming only that card (STYLE_GUIDE § Responsive:
  // "Floating UI inside any panel must portal to <body>"). Every Modal is a
  // top layer, so every Modal portals.
  const node = (
    <div
      className={`modal-backdrop${backdropClassName ? ` ${backdropClassName}` : ''}${
        isClosing ? ' is-closing' : ''
      }`}
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
  return typeof document === 'undefined' ? node : createPortal(node, document.body);
}
