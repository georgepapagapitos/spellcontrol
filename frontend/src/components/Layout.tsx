import { Outlet } from 'react-router-dom';
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
