import { useLocation } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { HubTabsNav } from './HubTabsNav';

/**
 * My Decks / Discover / Saved section-nav pills above all three decks pages.
 *
 * Not a layout route (no `<Outlet/>`): rendered directly by each page as a
 * sibling before its own root element, mirroring how `CollectionHubLayout`
 * sits above its nested page content.
 */
export function DecksHubTabs() {
  const { pathname } = useLocation();
  const isAuthed = useAuth((s) => s.status === 'authed');

  return (
    <HubTabsNav
      ariaLabel="Decks sections"
      tabs={[
        { to: '/decks', label: 'My Decks', active: pathname === '/decks' },
        {
          to: '/decks/discover',
          label: 'Discover',
          active: pathname.startsWith('/decks/discover'),
        },
        // Hidden for guests — matches the verified Header/MobileTabBar Friends
        // nav precedent (rendered only when isAuthed) rather than
        // always-shown-and-gated. A guest who navigates to /decks/saved
        // directly still gets a working page (its own inline sign-in
        // empty-state) — this only hides the nav entry point.
        ...(isAuthed
          ? [
              {
                to: '/decks/saved',
                label: 'Saved',
                active: pathname.startsWith('/decks/saved'),
              },
            ]
          : []),
      ]}
    />
  );
}
