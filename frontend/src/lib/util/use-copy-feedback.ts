import { useEffect, useRef, useState } from 'react';
import { copyToClipboard } from './clipboard';
import { toast } from '@/store/toasts';

/**
 * One duration for the in-place "Copied" swap everywhere (STYLE_GUIDE §
 * Verbs — Copy). Copy sites disagreed before this: 1500ms in most dialogs,
 * 2000ms in the online-lobby join code. 1500ms won as the majority default.
 */
export const COPY_FEEDBACK_DURATION = 1500;

export interface UseCopyFeedbackOptions {
  /** Names what's being copied, for the failure toast only: "Couldn't copy
   *  {what}." (a success never toasts — the label swap already confirms it). */
  what: string;
  duration?: number;
}

export interface CopyFeedback {
  /** True for `duration` ms after a successful copy, then reverts. Swap the
   *  control's visible label (and icon, if it has one) on this. */
  copied: boolean;
  /** "Copied" while `copied` is true, else ''. Render in a visually-hidden
   *  `aria-live="polite"` node beside the control (no `role="status"` — a
   *  page can hold several of these, and that role would collide with a
   *  bare `getByRole('status')` query against the page's own status
   *  regions) so screen readers hear the state change even where the
   *  control's own accessible name does not. */
  announcement: string;
  /** Copies `text`; on failure toasts an error and leaves `copied` false. */
  copy: (text: string) => void;
}

/**
 * Drives the "stays on screen" half of the copy-confirmation rule: a label
 * swap to "Copied" plus a live-region announcement, one shared duration, and
 * a failure toast (STYLE_GUIDE § Verbs — Copy). `CopyButton`/`CopyIconButton`
 * (`components/shared/CopyButton.tsx`) build this in; reach for the hook
 * directly only when the control isn't one of those two (e.g. the join-code
 * chip's bespoke on-dark button in `OnlineLobby`/`PlayPage`).
 */
export function useCopyFeedback({
  what,
  duration = COPY_FEEDBACK_DURATION,
}: UseCopyFeedbackOptions): CopyFeedback {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = (text: string) => {
    void (async () => {
      const ok = await copyToClipboard(text);
      if (ok) {
        clearTimeout(timer.current);
        setCopied(true);
        timer.current = setTimeout(() => setCopied(false), duration);
      } else {
        toast.show({ message: `Couldn't copy ${what}.`, tone: 'error' });
      }
    })();
  };

  return { copied, announcement: copied ? 'Copied' : '', copy };
}
