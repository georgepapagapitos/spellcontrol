import type { Toast } from '../store/toasts';

/** Cap on how many toasts are ever kept in the list at once. */
export const MAX_VISIBLE_TOASTS = 4;

/** Action toasts carry distinct callbacks/targets, so they must never coalesce. */
function hasAction(t: Toast): boolean {
  return Boolean(t.actionLabel) || typeof t.onAction === 'function';
}

/** Two toasts coalesce when they are plain (no action) and share message + tone. */
function canCoalesce(existing: Toast, incoming: Toast): boolean {
  if (hasAction(existing) || hasAction(incoming)) return false;
  return existing.message === incoming.message && existing.tone === incoming.tone;
}

/**
 * Pure list reducer for the toast viewport. Either coalesces the incoming toast
 * into an identical existing one (bumping its repeat count, refreshing its
 * timer, moving it to the newest position) or appends it and enforces the cap
 * by dropping the oldest toasts from the front. Always returns a new array.
 */
export function addToast(list: Toast[], toast: Toast, max = MAX_VISIBLE_TOASTS): Toast[] {
  const matchIndex = list.findIndex((t) => canCoalesce(t, toast));

  if (matchIndex !== -1) {
    const existing = list[matchIndex];
    const bumped: Toast = {
      ...existing,
      repeat: (existing.repeat ?? 1) + 1,
      // Refresh timing so the auto-dismiss countdown restarts.
      createdAt: toast.createdAt,
      bumpedAt: toast.createdAt,
    };
    // Drop the old position and re-add at the end (newest).
    const next = list.filter((_, i) => i !== matchIndex);
    next.push(bumped);
    return next;
  }

  const next = [...list, toast];
  // Enforce the cap: shed the oldest (front) entries until length === max.
  if (next.length > max) {
    return next.slice(next.length - max);
  }
  return next;
}
