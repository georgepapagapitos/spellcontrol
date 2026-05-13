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

  // Flex-column shell pinned to 100dvh: header on top (desktop), main fills
  // the middle and is the scroll container, mobile tab bar locks to the
  // bottom as a regular flex child. Doing the layout this way (instead of
  // floating the tab bar with position: fixed) means the bar can't drift,
  // grow, or detach during browser-chrome animations — the whole shell
  // resizes together with the dynamic viewport.
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
