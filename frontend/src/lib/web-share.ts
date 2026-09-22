import { toast } from '@/store/toasts';

interface SharePayload {
  title?: string;
  text?: string;
  url?: string;
}

/**
 * Whether the browser can open a system share sheet. False on most desktop
 * browsers, so callers render the Share button only when this is true —
 * Copy is always there as the fallback.
 */
export function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * Open the system share sheet. Dismissing it rejects with `AbortError`, which
 * is a deliberate no-op rather than a failure worth surfacing.
 */
export async function openShareSheet(payload: SharePayload): Promise<void> {
  try {
    await navigator.share(payload);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    toast.show({ message: "Couldn't open share sheet", tone: 'warn' });
  }
}
