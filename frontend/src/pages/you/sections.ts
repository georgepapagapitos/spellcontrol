/**
 * The You page's sections. `/you` is the hub (the list of these); each one is
 * its own route, `/you/<id>`. On a desktop the list stays beside the section
 * it opened, so the two read as one settings window.
 */
export type YouSectionId =
  'profile' | 'account' | 'appearance' | 'prices' | 'ai' | 'data' | 'storage' | 'help';

/** Page title of each section: the heading, the tab title and the nav label. */
export const SECTION_TITLES: Record<YouSectionId, string> = {
  profile: 'Profile',
  account: 'Account',
  appearance: 'Appearance',
  prices: 'Prices',
  ai: 'AI',
  data: 'Backup & export',
  storage: 'Storage',
  help: 'Help & about',
};

export function isYouSection(id: string | undefined): id is YouSectionId {
  return !!id && Object.hasOwn(SECTION_TITLES, id);
}

/**
 * `/you?section=<old id>` from before the sections were routes. Old
 * bookmarks and the backend's OAuth link callback (`/settings?linked=…`,
 * forwarded to `/you`) still arrive in this shape, so each old value maps to
 * the section that now holds what it pointed at. `settings` was the header
 * menu's Settings item, which meant the preferences (theme first).
 */
export const LEGACY_SECTION_ROUTES: Record<string, YouSectionId> = {
  profile: 'profile',
  sharing: 'profile',
  account: 'account',
  'sign-in': 'account',
  settings: 'appearance',
  appearance: 'appearance',
  'collection-preferences': 'prices',
  ai: 'ai',
  collection: 'data',
  danger: 'data',
  data: 'storage',
};

/** The reason on every card-only data action while the collection is empty. */
export const NEEDS_CARDS = 'Needs cards in your collection.';
