/**
 * First path segments the SPA router owns (see frontend/src/App.tsx). The
 * history fallback serves index.html for these with a 200 so deep links and
 * hard refreshes work; anything else still gets the shell (the app renders
 * its not-found page) but with a 404 status, so crawlers and link checkers
 * see a real miss instead of a soft-404 (E265). `spa-routes.test.ts` reads
 * App.tsx and fails if a new top-level route lands without a row here.
 */
const SPA_ROOTS = new Set([
  '', // /
  'admin',
  'auth',
  'collection',
  'daily',
  'd',
  'decks',
  'dev', // /dev/catalog, the component catalog (noindex, robots-disallowed)
  'forgot-password',
  'friends',
  'gn',
  'home',
  'oauth',
  'play',
  'pods',
  'reset-password',
  'rules',
  's',
  'search',
  'settings',
  'tags',
  'trades',
  'u',
  'verify-email',
  'welcome',
  'you',
]);

export function isSpaRoute(pathname: string): boolean {
  return SPA_ROOTS.has(pathname.split('/')[1] ?? '');
}
