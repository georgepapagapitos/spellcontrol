import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
  /** Action button label (e.g. "Undo"). */
  actionLabel?: string;
  /** Fired when the action button is clicked. The toast is dismissed afterward. */
  onAction?: () => void;
  /** Auto-dismiss duration in ms. 0 means stay until dismissed. */
  durationMs: number;
  createdAt: number;
}

interface ToastsState {
  toasts: Toast[];
  push(input: {
    message: string;
    tone?: ToastTone;
    actionLabel?: string;
    onAction?: () => void;
    durationMs?: number;
  }): string;
  dismiss(id: string): void;
  clear(): void;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `toast_${crypto.randomUUID()}`;
  }
  return `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useToastsStore = create<ToastsState>((set) => ({
  toasts: [],
  push: ({ message, tone = 'info', actionLabel, onAction, durationMs = 5000 }) => {
    const id = newId();
    const toast: Toast = {
      id,
      message,
      tone,
      actionLabel,
      onAction,
      durationMs,
      createdAt: Date.now(),
    };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Imperative helper for non-component callers. */
export const toast = {
  show: (input: Parameters<ToastsState['push']>[0]) => useToastsStore.getState().push(input),
  dismiss: (id: string) => useToastsStore.getState().dismiss(id),
};
