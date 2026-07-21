/**
 * One-time "what's new" tip for the W3 nav activation: tells a RETURNING
 * user where Settings/Friends/Rules moved, once, ever, on this device. A
 * brand-new signup has nothing to migrate from — the caller gates on
 * `wasReturningUserOnLoad` rather than this module deciding who counts as
 * "new".
 *
 * Storage is plain localStorage — device-local by design, same as
 * `first-run.ts`. Tolerant of storage errors, but in the OPPOSITE default
 * direction from `first-run.ts`: there, a storage failure defaults to
 * "already visited" so a user is never trapped on /auth. Here, a storage
 * failure defaults to hidden — an unwanted popup is worse than a missed
 * one, so staying silent is the safe failure mode.
 */
const KEY = 'sc-seen-nav-v2-tip';

export function shouldShowNavTip(wasReturningUserOnLoad: boolean): boolean {
  if (!wasReturningUserOnLoad) return false;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === null;
  } catch {
    return false;
  }
}

export function dismissNavTip(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, '1');
  } catch {
    /* ignore — see shouldShowNavTip */
  }
}
