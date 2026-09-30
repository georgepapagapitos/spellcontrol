import type { ReactNode } from 'react';
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
  // Escape, the backdrop and every child close go through the hook's
  // beginClose, which is instant on desktop (the panel has no exit keyframe).
  const {
    isClosing,
    beginClose: dismiss,
    onAnimationEnd,
  } = useSheetExit(onClose, 'binder-sheet-slide-out', { instantAt: '(min-width: 1024px)' });

  return (
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
    </div>
  );
}
