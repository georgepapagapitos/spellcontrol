import type { NavigateFunction } from 'react-router-dom';

// Lets non-React code (store actions, toast onAction callbacks) navigate via the
// app's router. App registers the live `navigate` once on mount, mirroring how
// `initDeepLinks(navigate)` already hands the router to a lib. Module-level
// singleton: there is exactly one router instance for the app's lifetime.
let appNavigator: NavigateFunction | null = null;

export function setAppNavigator(fn: NavigateFunction | null): void {
  appNavigator = fn;
}

/** Navigate via the registered router, falling back to a hard load pre-mount. */
export function appNavigate(to: string): void {
  if (appNavigator) appNavigator(to);
  else if (typeof window !== 'undefined') window.location.assign(to);
}
