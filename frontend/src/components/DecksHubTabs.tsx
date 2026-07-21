import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../store/auth';

/**
 * My Decks / Discover / Saved section-nav pills above all three decks pages.
 * Reuses `.collection-hub-tabs` (responsive-nav.css) verbatim — a generic
 * sticky tab-strip already built for the Collection hub (`.site-nav-link` /
 * `.site-nav-count`, hidden-scrollbar overflow) — so this needs zero new
 * CSS even at three pills.
 *
 * Not a layout route (no `<Outlet/>`): rendered directly by each page as a
 * sibling before its own root element, mirroring how `CollectionHubLayout`
 * sits above its nested page content.
 */
export function DecksHubTabs() {
  const { pathname } = useLocation();
  const isAuthed = useAuth((s) => s.status === 'authed');
  const myDecksActive = pathname === '/decks';
  const discoverActive = pathname.startsWith('/decks/discover');
  const savedActive = pathname.startsWith('/decks/saved');

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
      {/* Hidden for guests — matches the verified Header/MobileTabBar Friends
          nav precedent (rendered only when isAuthed) rather than
          always-shown-and-gated. A guest who navigates to /decks/saved
          directly still gets a working page (its own inline sign-in
          empty-state) — this only hides the nav entry point. */}
      {isAuthed && (
        <Link
          to="/decks/saved"
          className={savedActive ? 'site-nav-link active' : 'site-nav-link'}
          aria-current={savedActive ? 'page' : undefined}
        >
          <span>Saved</span>
        </Link>
      )}
    </nav>
  );
}
