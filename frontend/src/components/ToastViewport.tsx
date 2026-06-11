import { type CSSProperties, useEffect } from 'react';
import { useToastsStore, type Toast } from '../store/toasts';
import { useToastExits } from '../lib/use-toast-exits';

export function ToastViewport() {
  const toasts = useToastsStore((s) => s.toasts);
  const dismiss = useToastsStore((s) => s.dismiss);
  // Delayed unmount + restack glide: dismissed toasts keep rendering as
  // inert `is-leaving` ghosts until their leave animation ends, and the
  // survivors glide (FLIP) into the freed space. See use-toast-exits.
  const { entries, listRef, registerItem, onExitEnd } = useToastExits(toasts);

  return (
    <div className="toast-viewport" role="region" aria-label="Notifications">
      <ol className="toast-list" aria-live="polite" ref={listRef}>
        {entries.map(({ toast: t, leaving, style }) => (
          <ToastItem
            key={t.id}
            toast={t}
            leaving={leaving}
            style={style}
            onDismiss={() => dismiss(t.id)}
            onExitEnd={onExitEnd}
            registerItem={registerItem}
          />
        ))}
      </ol>
    </div>
  );
}

function ToastItem({
  toast,
  leaving,
  style,
  onDismiss,
  onExitEnd,
  registerItem,
}: {
  toast: Toast;
  leaving: boolean;
  style?: CSSProperties;
  onDismiss: () => void;
  onExitEnd: (id: string) => void;
  registerItem: (id: string, el: HTMLLIElement | null) => void;
}) {
  useEffect(() => {
    // A leaving ghost is already dismissed — re-arming its timer would
    // re-fire dismiss mid-exit.
    if (leaving || toast.durationMs <= 0) return;
    const timer = window.setTimeout(onDismiss, toast.durationMs);
    return () => window.clearTimeout(timer);
    // bumpedAt restarts the countdown whenever an identical toast coalesces in.
  }, [leaving, toast.durationMs, toast.bumpedAt, onDismiss]);

  // Once the leave starts the toast is inert: `.is-leaving` kills pointer
  // events in CSS, and these guards cover keyboard activation of a
  // still-focused button so the action can't double-fire mid-exit.
  const handleAction = () => {
    if (leaving) return;
    toast.onAction?.();
    onDismiss();
  };

  const handleDismiss = () => {
    if (leaving) return;
    onDismiss();
  };

  const handleAnimationEnd = (e: React.AnimationEvent) => {
    // Only the exit keyframe unmounts — the on-mount slide-in also ends here.
    if (leaving && e.animationName === 'toast-leave') onExitEnd(toast.id);
  };

  return (
    <li
      ref={(el) => registerItem(toast.id, el)}
      className={`toast toast-${toast.tone}${leaving ? ' is-leaving' : ''}`}
      role="status"
      style={style}
      onAnimationEnd={handleAnimationEnd}
    >
      <span className="toast-message">{toast.message}</span>
      {toast.repeat && toast.repeat > 1 && (
        <span className="toast-repeat" aria-label={`${toast.repeat} times`}>
          ×{toast.repeat}
        </span>
      )}
      {toast.actionLabel && toast.onAction && (
        <button type="button" className="toast-action" onClick={handleAction}>
          {toast.actionLabel}
        </button>
      )}
      <button type="button" className="toast-close" onClick={handleDismiss} aria-label="Dismiss">
        ×
      </button>
    </li>
  );
}
