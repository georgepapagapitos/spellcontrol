import { type CSSProperties, useCallback, useEffect } from 'react';
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
      {/* Each toast announces itself via its per-item role (alert/status); the
          list itself is not a live region to avoid double announcements. */}
      <ol className="toast-list" ref={listRef}>
        {entries.map(({ toast: t, leaving, style }) => (
          <ToastItem
            key={t.id}
            toast={t}
            leaving={leaving}
            style={style}
            dismiss={dismiss}
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
  dismiss,
  onExitEnd,
  registerItem,
}: {
  toast: Toast;
  leaving: boolean;
  style?: CSSProperties;
  dismiss: (id: string) => void;
  onExitEnd: (id: string) => void;
  registerItem: (id: string, el: HTMLLIElement | null) => void;
}) {
  // Built here, not by the parent's `.map()`. An inline arrow was a fresh
  // identity on every ToastViewport render, and this timer effect lists it in
  // its deps — so pushing *any* unrelated toast tore down and restarted the
  // countdown of every toast already on screen, and a steady trickle of toasts
  // could keep one visible indefinitely. `dismiss` is a stable zustand action
  // and `toast.id` never changes for a given item.
  const onDismiss = useCallback(() => dismiss(toast.id), [dismiss, toast.id]);

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
      // Errors interrupt (assertive); everything else waits its turn (polite).
      role={toast.tone === 'error' ? 'alert' : 'status'}
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
