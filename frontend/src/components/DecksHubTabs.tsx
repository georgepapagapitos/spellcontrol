import { Link, useLocation } from 'react-router-dom';

/**
 * My Decks / Discover section-nav pills above both decks pages. Reuses
 * `.collection-hub-tabs` (responsive-nav.css) verbatim — a generic sticky
 * tab-strip already built for the Collection hub (`.site-nav-link` /
 * `.site-nav-count`, hidden-scrollbar overflow) — so this needs zero new
 * CSS. A third "Saved" pill lands in `w2-likes-bookmarks`.
 *
 * Not a layout route (no `<Outlet/>`): rendered directly by each page as a
 * sibling before its own root element, mirroring how `CollectionHubLayout`
 * sits above its nested page content.
 */
export function DecksHubTabs() {
  const { pathname } = useLocation();
  const myDecksActive = pathname === '/decks';
  const discoverActive = pathname.startsWith('/decks/discover');

  return (
    <nav className="collection-hub-tabs" aria-label="Decks sections">
      <Link
        to="/decks"
        className={myDecksActive ? 'site-nav-link active' : 'site-nav-link'}
        aria-current={myDecksActive ? 'page' : undefined}
      >
        <span>My Decks</span>
      </Link>
      <Link
        to="/decks/discover"
        className={discoverActive ? 'site-nav-link active' : 'site-nav-link'}
        aria-current={discoverActive ? 'page' : undefined}
      >
        <span>Discover</span>
      </Link>
    </nav>
  );
}
