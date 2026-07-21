import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { useMenuKeyboard } from '../lib/use-menu-keyboard';
import { computePopoverPlacement, getSafeViewport } from '../lib/popover-placement';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The Like/Bookmark button that triggered this — also where focus returns
   *  on Esc/outside-click/dismiss. */
  anchorRef: RefObject<HTMLButtonElement | null>;
  /** e.g. "Sign in to like decks" — LikeButton/BookmarkButton each pass their
   *  own verb (never a generic message). */
  message: string;
}

type PanelPos = { top?: number; bottom?: number; left?: number; right?: number };

/**
 * Shared guest-tap gate for LikeButton/BookmarkButton: an inline,
 * dismissable popover — never a bare full-page navigate. Portal +
 * computePopoverPlacement matches FilterPopover's anchoring mechanics; focus
 * moves in on open and Esc/outside-click closes and returns focus to the
 * trigger via useMenuKeyboard (the same mechanics as OverflowMenu/SelectMenu)
 * — a real dismissable popover, unlike the non-modal filters popover, since
 * this one's sole content is a single decision. The only navigation is an
 * explicit click on "Sign in", which carries `returnTo` so the user lands
 * back where they were instead of the default post-auth `/`.
 */
export function GuestActionPopover({ open, onClose, anchorRef, message }: Props) {
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // itemSelector targets the real <a>/<button> controls directly rather than
  // the hook's default `[role="menuitem"]` — this popover's content is a
  // genuine navigational link + a dismiss button, not a command menu, and
  // overriding their native role to "menuitem" would misannounce the Sign-in
  // link to assistive tech (and there's nothing to gain: the hook only uses
  // itemSelector to find focusable candidates for initial-focus/roving).
  useMenuKeyboard({ open, onClose, panelRef, triggerRef: anchorRef, itemSelector: 'a, button' });

  useLayoutEffect(() => {
    if (!open || !panelRef.current || !anchorRef.current) return;
    const anchorRect = anchorRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const safe = getSafeViewport();
    const placement = computePopoverPlacement(
      anchorRect,
      { width: panelRect.width, height: panelRect.height },
      safe,
      'right'
    );
    setPanelPos({
      top: placement.top,
      bottom: placement.bottom,
      left: placement.left,
      right: placement.right,
    });
  }, [open, anchorRef]);

  if (!open || typeof document === 'undefined') return null;

  // No pre-render position estimate (reading anchorRef.current during render
  // is disallowed — react-hooks/refs). Rendering with an unset position for
  // one synchronous pass is safe: useLayoutEffect above corrects it and
  // triggers a re-render before the browser ever paints, same as any other
  // useLayoutEffect-measured popover in this app.
  const pos: PanelPos = panelPos ?? {};

  const returnTo = `${location.pathname}${location.search}`;

  return createPortal(
    <div
      ref={panelRef}
      className="filter-popover-panel guest-action-popover"
      style={{
        position: 'fixed',
        top: pos.top,
        bottom: pos.bottom,
        left: pos.left,
        right: pos.right,
      }}
    >
      <p className="guest-action-popover-message">{message}</p>
      <div className="guest-action-popover-actions">
        <Link
          to={`/auth?returnTo=${encodeURIComponent(returnTo)}`}
          className="btn btn-primary guest-action-popover-signin"
        >
          Sign in
        </Link>
        <button
          type="button"
          className="guest-action-popover-close"
          aria-label="Dismiss"
          onClick={onClose}
        >
          <X width={14} height={14} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>,
    document.body
  );
}
