import { Outlet } from 'react-router-dom';

/**
 * Shell for the Collection hub's routes. The tab bar used to live here, above
 * the <Outlet/>, so it sat ABOVE every page's title and repeated on the detail
 * pages too; each index page now renders <CollectionHubTabs/> under its own
 * header instead (STYLE_GUIDE § Layout system).
 */
export function CollectionHubLayout() {
  return <Outlet />;
}
