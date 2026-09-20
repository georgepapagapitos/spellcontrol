import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { getSafeViewport } from '@/lib/popover-placement';

const MENU_MARGIN = 8;

export interface CtxMenuShellProps {
  /** Anchor (pointer position, or the card's centre for keyboard opens). */
  x: number;
  y: number;
  /** Dialog / menu accessible name and the sheet variant's visible title. */
  title: string;
  /** `floating` = cursor-anchored popover clamped to the safe viewport
   *  (desktop); `sheet` = the shared bottom sheet (narrow viewports). */
  variant: 'floating' | 'sheet';
  /** Changes whenever the caller swaps what it renders inside (e.g. a menu
   *  drilling into a submenu page): the floating variant re-clamps to the new
   *  height, and focus moves to the new content's first control. */
  contentKey?: string;
  onClose(): void;
  children: ReactNode;
}

/**
 * The chrome shared by every card menu on the playtest surface (battlefield
 * permanent, hand card): backdrop, clamped floating popover or bottom sheet,
 * Escape, body-scroll lock, and initial focus into the first control so a
 * keyboard-opened menu is immediately operable. Items are the caller's.
 */
export function CtxMenuShell({
  x,
  y,
  title,
  variant,
  contentKey,
  onClose,
  children,
}: CtxMenuShellProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<HTMLDivElement | null>(null);
  const [clamped, setClamped] = useState<{ left: number; top: number } | null>(null);
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');

  useLockBodyScroll();
  useEscapeKey(variant === 'sheet' ? beginClose : onClose);

  useEffect(() => {
    if (variant !== 'floating') return;
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const safe = getSafeViewport();
    const left = Math.max(MENU_MARGIN, Math.min(x, safe.right - rect.width - MENU_MARGIN));
    const top = Math.max(MENU_MARGIN, Math.min(y, safe.bottom - rect.height - MENU_MARGIN));
    setClamped({ left, top });
  }, [x, y, variant, contentKey]);

  // Keyboard-opened menus land with nothing focused unless something moves
  // focus in; a pointer open leaves focus where it was, which is fine since
  // the pointer is on the menu. `visibility: hidden` (floating, pre-clamp)
  // can't take focus, so wait for `clamped` on that variant.
  useEffect(() => {
    if (variant === 'floating' && !clamped) return;
    const container = variant === 'floating' ? menuRef.current : itemsRef.current;
    container
      ?.querySelector<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'
      )
      ?.focus();
  }, [variant, clamped, contentKey]);

  if (variant === 'sheet') {
    return (
      <div className="card-picker-root">
        {/* The backdrop fully covers the root (both `inset: 0`), so it — not
            root — is what a "click outside the sheet" actually lands on. */}
        <div className="card-picker-backdrop" role="presentation" onClick={() => beginClose()} />
        <div
          className={`card-picker-sheet playtest-ctx-sheet${isClosing ? ' is-closing' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onAnimationEnd={onAnimationEnd}
        >
          <div className="card-picker-handle" aria-hidden />
          <div className="card-picker-header">
            <h2 className="card-picker-title">{title}</h2>
          </div>
          <div className="playtest-ctx-menu" ref={itemsRef}>
            {children}
          </div>
          <div className="card-picker-footer">
            <button type="button" className="btn" onClick={() => beginClose()}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="playtest-ctx__backdrop" role="presentation" onClick={onClose} />
      <div
        ref={menuRef}
        className="playtest-ctx playtest-ctx-menu"
        style={{
          left: clamped?.left ?? x,
          top: clamped?.top ?? y,
          visibility: clamped ? 'visible' : 'hidden',
        }}
        role="menu"
        aria-label={title}
      >
        {children}
      </div>
    </>
  );
}
