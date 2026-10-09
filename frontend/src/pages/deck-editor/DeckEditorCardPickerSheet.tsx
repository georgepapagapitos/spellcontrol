import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLockBodyScroll } from '@/lib/overlays/use-lock-body-scroll';
import { useSheetExit } from '@/lib/overlays/use-sheet-exit';

export function DeckEditorCardPickerSheet({
  label,
  className,
  onClose,
  children,
}: {
  label: string;
  className: string;
  onClose: () => void;
  children: (dismiss: () => void) => ReactNode;
}) {
  useLockBodyScroll();

  // Escape, the backdrop and every child close go through the hook's
  // beginClose, which is instant on desktop (the panel has no exit keyframe).
  const {
    isClosing,
    beginClose: dismiss,
    onAnimationEnd,
  } = useSheetExit(onClose, 'binder-sheet-slide-out', { instantAt: '(min-width: 1024px)' });

  // Portaled to <body> like every other overlay root, so the page's stacking
  // contexts can't trap it (see test/overlay-roots-portal-to-body.test.ts).
  return createPortal(
    <div
      className="card-picker-root"
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        className={`card-picker-sheet ${className}${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onAnimationEnd={onAnimationEnd}
      >
        {children(dismiss)}
      </div>
    </div>,
    document.body
  );
}
