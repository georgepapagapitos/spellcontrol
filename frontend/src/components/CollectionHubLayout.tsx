import { Outlet } from 'react-router-dom';

/**
 * Shell for the Collection hub's routes. The tab bar used to live here, above
 * the <Outlet/>, so it sat ABOVE every page's title and repeated on the detail
 * pages too; each index page now renders <CollectionHubTabs/> under its own
 * header instead (STYLE_GUIDE § Layout system).
 *
 * The `.collection-hub` wrapper is `display: contents`: it adds no box, and
 * exists only as the marker the wide-page rule keys on (base-layout.css), so
 * every collection route, index or detail, keeps the wider card-grid ceiling.
 */
export function CollectionHubLayout() {
  return (
    <div className="collection-hub">
      <Outlet />
    </div>
  );
}
