import { useState } from 'react';
import { X } from 'lucide-react';
import { hasEverVisited } from '../lib/first-run';
import { dismissNavTip, shouldShowNavTip } from '../lib/nav-migration-tip';
import './NavMigrationTip.css';

/**
 * One-time, dismissible "what's new" tip for the W3 nav activation: `/` now
 * lands authed users on Home, and Settings/Friends/Rules moved. Shown once,
 * ever, per device, to RETURNING users only — a brand-new signup has
 * nothing to migrate from and never renders this, on any visit.
 *
 * `wasReturningUserOnLoad` is captured via a lazy useState initializer
 * (not a plain render-time read) because it must be snapshotted BEFORE any
 * in-session auth action (login/register/complete-signup — all of which
 * call `markEverVisited()` inside `store/auth.ts`'s `signInAs()`) can flip
 * the underlying flag. Without this, a brand-new signup would read as
 * "returning" by the time it reaches its first authed page, same as a
 * pre-existing user — only a load-time snapshot separates the two cohorts.
 *
 * Mounted in Layout.tsx (nav chrome lives there), not App.tsx — this banner
 * explains nav-chrome changes specifically, so it has no business rendering
 * on chrome-less routes like /auth or /s/:token.
 */
export function NavMigrationTip() {
  const [wasReturningUserOnLoad] = useState(() => hasEverVisited());
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !shouldShowNavTip(wasReturningUserOnLoad)) return null;

  return (
    <div className="nav-migration-tip" role="status" aria-live="polite">
      <p>Settings and Friends now live under You. Rules moved into Play.</p>
      <button
        type="button"
        className="nav-migration-tip-dismiss"
        aria-label="Dismiss"
        onClick={() => {
          dismissNavTip();
          setDismissed(true);
        }}
      >
        <X width={16} height={16} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
