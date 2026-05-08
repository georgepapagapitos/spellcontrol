import { useEffect } from 'react';
import { useToastsStore, type Toast } from '../store/toasts';

export function ToastViewport() {
  const toasts = useToastsStore((s) => s.toasts);
  const dismiss = useToastsStore((s) => s.dismiss);

  return (
    <div className="toast-viewport" role="region" aria-label="Notifications">
      <ol className="toast-list" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </ol>
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    if (toast.durationMs <= 0) return;
    const timer = window.setTimeout(onDismiss, toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [toast.durationMs, onDismiss]);

  const handleAction = () => {
    toast.onAction?.();
    onDismiss();
  };

  return (
    <li className={`toast toast-${toast.tone}`} role="status">
      <span className="toast-message">{toast.message}</span>
      {toast.actionLabel && toast.onAction && (
        <button type="button" className="toast-action" onClick={handleAction}>
          {toast.actionLabel}
        </button>
      )}
      <button type="button" className="toast-close" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </li>
  );
}
