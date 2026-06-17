import { create } from 'zustand';
import { addToast } from '../lib/toast-stack';
import { genId } from '../lib/id';

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
  /** How many identical toasts have coalesced into this one (>=2 once coalesced; absent means 1). */
  repeat?: number;
  /** Timestamp of the last coalesce bump — used to restart the auto-dismiss timer. */
  bumpedAt?: number;
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

export const useToastsStore = create<ToastsState>((set) => ({
  toasts: [],
  push: ({ message, tone = 'info', actionLabel, onAction, durationMs = 5000 }) => {
    const id = genId('toast');
    const toast: Toast = {
      id,
      message,
      tone,
      actionLabel,
      onAction,
      durationMs,
      createdAt: Date.now(),
    };
    // addToast coalesces identical plain toasts and caps the list length.
    set((s) => ({ toasts: addToast(s.toasts, toast) }));
    // Returns the freshly-minted id even when coalesced (the coalesced toast
    // keeps its original id, but callers only use this for an optional dismiss).
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
