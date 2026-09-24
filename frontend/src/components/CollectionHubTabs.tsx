import { useLocation } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { HubTabsNav } from './HubTabsNav';

/**
 * Cards / Binders / Lists / Combos / Sets. (Cube lives in the Decks hub: it's
 * a thing you build, not a thing you own; `/collection/cube` redirects there.)
 *
 * Rendered by each Collection INDEX page directly under its PageHeader
 * (STYLE_GUIDE § Layout system: title → meta → actions → tabs), the same way
 * DecksHubTabs and SocialHubTabs are. Detail pages (a binder, a list, a set)
 * don't render it: their back link goes up a level and the main nav still
 * names the hub, so a third navigation row above their title bought nothing.
 *
 * Cards is an exact match because every other tab's path is a prefix of it.
 */
export function CollectionHubTabs() {
  const { pathname } = useLocation();
  const cardCount = useCollectionStore((s) => s.cards.length);
  const binderCount = useCollectionStore((s) => s.binders.length);
  const listCount = useCollectionStore((s) => s.lists.length);

  return (
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
          to: '/collection/combos',
          label: 'Combos',
          active: pathname.startsWith('/collection/combos'),
        },
        {
          to: '/collection/sets',
          label: 'Sets',
          active: pathname.startsWith('/collection/sets'),
        },
      ]}
    />
  );
}
