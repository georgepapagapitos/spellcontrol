import { Link, Outlet, useLocation } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';

// Mirrors Header's formatCount (intentionally copied, not imported — keeps the
// hub shell decoupled from the header so either can change independently).
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}

/**
 * Tab-bar shell for the Collection hub. Renders Cards / Binders / Lists tabs
 * above an <Outlet/> so the nested index, binder-detail and list-detail routes
 * all keep the tab bar visible.
 *
 * Active tab is derived from the live pathname here (NOT a src/lib helper —
 * keeps the gated coverage scope clean):
 *  - Cards    : pathname === '/collection' (exact)
 *  - Binders  : pathname starts with '/collection/binders'
 *  - Lists    : pathname starts with '/collection/lists'
 */
export function CollectionHubLayout() {
  const { pathname } = useLocation();
  const cardCount = useCollectionStore((s) => s.cards.length);
  const binderCount = useCollectionStore((s) => s.binders.length);
  const listCount = useCollectionStore((s) => s.lists.length);

  const cardsActive = pathname === '/collection';
  const bindersActive = pathname.startsWith('/collection/binders');
  const listsActive = pathname.startsWith('/collection/lists');
  const cubeActive = pathname.startsWith('/collection/cube');

  return (
    <>
      <nav className="collection-hub-tabs" aria-label="Collection sections">
        <Link
          to="/collection"
          className={cardsActive ? 'site-nav-link active' : 'site-nav-link'}
          aria-current={cardsActive ? 'page' : undefined}
        >
          <span>Cards</span>
          {cardCount > 0 && (
            <span className="site-nav-count" aria-label={`${cardCount} cards`}>
              {formatCount(cardCount)}
            </span>
          )}
        </Link>
        <Link
          to="/collection/binders"
          className={bindersActive ? 'site-nav-link active' : 'site-nav-link'}
          aria-current={bindersActive ? 'page' : undefined}
        >
          <span>Binders</span>
          {binderCount > 0 && (
            <span className="site-nav-count" aria-label={`${binderCount} binders`}>
              {formatCount(binderCount)}
            </span>
          )}
        </Link>
        <Link
          to="/collection/lists"
          className={listsActive ? 'site-nav-link active' : 'site-nav-link'}
          aria-current={listsActive ? 'page' : undefined}
        >
          <span>Lists</span>
          {listCount > 0 && (
            <span className="site-nav-count" aria-label={`${listCount} lists`}>
              {formatCount(listCount)}
            </span>
          )}
        </Link>
        <Link
          to="/collection/cube"
          className={cubeActive ? 'site-nav-link active' : 'site-nav-link'}
          aria-current={cubeActive ? 'page' : undefined}
        >
          <span>Cube</span>
        </Link>
      </nav>
      <Outlet />
    </>
  );
}
