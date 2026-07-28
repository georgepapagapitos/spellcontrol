import type { JSX, ReactNode } from 'react';
import { X } from 'lucide-react';
import { useEscapeKey } from '../../lib/use-escape-key';
import './WedgeHintStrip.css';

interface Props {
  icon: ReactNode;
  headline: string;
  detail: string;
  /** Optional call-to-action (e.g. "Resync") — omit for a purely
   *  informational hint where the feature being pointed at is already on
   *  screen (e.g. the binder badge). */
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

/**
 * One-row, once-only discovery hint for a shipped feature a user could
 * plausibly never find (STYLE_GUIDE "Wedge-feature discovery hints"). Follows
 * the UX-334 insight-strip ground rules — one row, full-width, 44px touch
 * target, never a permanent fixture — but the caller owns the precondition
 * (via `lib/wedge-hints.ts`) and mount/unmount entirely; this component has
 * no internal "nothing to show" state of its own, unlike UX-334's own strips.
 * `role="status"`/`aria-live="polite"` announces its appearance without
 * moving focus. Escape dismisses it, same as every other click-away surface
 * in the deck editor (`useEscapeKey`) — harmless if a parent sheet also
 * listens for Escape, since dismissing both a hint and its host sheet on one
 * keypress is a reasonable outcome, not a conflict.
 */
export function WedgeHintStrip({
  icon,
  headline,
  detail,
  actionLabel,
  onAction,
  onDismiss,
}: Props): JSX.Element {
  useEscapeKey(onDismiss);

  return (
    <div className="wedge-hint-strip" role="status" aria-live="polite">
      <span className="wedge-hint-strip-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="wedge-hint-strip-body">
        <p className="wedge-hint-strip-headline">{headline}</p>
        <p className="wedge-hint-strip-detail">{detail}</p>
      </div>
      {actionLabel && onAction && (
        <button type="button" className="wedge-hint-strip-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
      <button
        type="button"
        className="wedge-hint-strip-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss hint"
      >
        <X width={14} height={14} aria-hidden />
      </button>
    </div>
  );
}
