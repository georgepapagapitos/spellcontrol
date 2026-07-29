import { Outlet, useLocation } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { HubTabsNav } from './HubTabsNav';

/**
 * Tab-bar shell for the Collection hub. Renders Cards / Binders / Lists / Sets
 * / Cube tabs above an <Outlet/> so the nested index, binder-detail and
 * list-detail routes all keep the tab bar visible.
 *
 * Active tab is derived from the live pathname here (NOT a src/lib helper —
 * keeps the gated coverage scope clean). Cards is an exact match because every
 * other tab's path is a prefix of it; the rest are prefix matches so their
 * detail routes keep the parent tab lit.
 */
export function CollectionHubLayout() {
  const { pathname } = useLocation();
  const cardCount = useCollectionStore((s) => s.cards.length);
  const binderCount = useCollectionStore((s) => s.binders.length);
  const listCount = useCollectionStore((s) => s.lists.length);

  return (
    <>
      <HubTabsNav
        ariaLabel="Collection sections"
        tabs={[
          {
            to: '/collection',
            label: 'Cards',
            active: pathname === '/collection',
            count: cardCount,
            countNoun: 'cards',
          },
          {
            to: '/collection/binders',
            label: 'Binders',
            active: pathname.startsWith('/collection/binders'),
            count: binderCount,
            countNoun: 'binders',
          },
          {
            to: '/collection/lists',
            label: 'Lists',
            active: pathname.startsWith('/collection/lists'),
            count: listCount,
            countNoun: 'lists',
          },
          {
            to: '/collection/sets',
            label: 'Sets',
            active: pathname.startsWith('/collection/sets'),
          },
          {
            to: '/collection/cube',
            label: 'Cube',
            active: pathname.startsWith('/collection/cube'),
          },
        ]}
      />
      <Outlet />
    </>
  );
}
