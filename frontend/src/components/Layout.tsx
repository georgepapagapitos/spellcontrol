import { useEffect } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { Header } from './Header';
import { MobileTabBar } from './MobileTabBar';
import { Footer } from './Footer';
import { BinderEditor } from './BinderEditor';
import { ToastViewport } from './ToastViewport';

export function Layout() {
  // Store hydration is owned by the sync layer (see startSync in lib/sync.ts).
  // It loads IndexedDB cards into the store before any push, so Layout no
  // longer needs to call hydrateCards manually.

  // The document itself is the scroll container so useWindowVirtualizer
  // and native pull-to-refresh work. The desktop header pins via
  // position: sticky and the mobile tab bar via position: fixed —
  // .app-main has a matching bottom padding on mobile so the last row
  // isn't trapped under the bar.

  // Reset scroll on forward navigations (PUSH/REPLACE) so e.g. landing
  // on a freshly generated deck starts at the top. Back/forward (POP)
  // keeps the prior scroll so returning to a list view feels natural.
  // In-page hash links (#section) are exempt.
  const { pathname, hash } = useLocation();
  const navType = useNavigationType();
  useEffect(() => {
    if (navType === 'POP') return;
    if (hash) return;
    window.scrollTo(0, 0);
  }, [pathname, hash, navType]);

  return (
    <div className="app-shell">
      <Header />
      <main className="app-main">
        <div className="container">
          <Outlet />
          <BinderEditor />
          <Footer />
        </div>
      </main>
      <MobileTabBar />
      <ToastViewport />
    </div>
  );
}
