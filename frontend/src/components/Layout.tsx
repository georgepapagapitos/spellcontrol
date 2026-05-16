import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { Header } from './Header';
import { MobileTabBar } from './MobileTabBar';
import { Footer } from './Footer';
import { BinderEditor } from './BinderEditor';
import { ToastViewport } from './ToastViewport';
import { ScrollContainerContext } from '../lib/scroll-container';

export function Layout() {
  // Store hydration is owned by the sync layer (see startSync in lib/sync.ts).

  // App-shell layout: the shell is a fixed-height non-scrolling flex column
  // and <main> is the single scroll container. Nothing is position:fixed and
  // the document does not scroll, so the mobile browser's URL bar animation
  // can't shift a fixed tab bar (the bug this layout exists to kill).
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);

  // Scroll restoration. The browser only restores window scroll, which no
  // longer moves, so we keep our own per-history-entry map: reset to top on
  // forward navigation (PUSH/REPLACE), restore the saved offset on POP
  // (back/forward). In-page hash links are left alone.
  const { pathname, hash, key } = useLocation();
  const navType = useNavigationType();
  const positions = useRef(new Map<string, number>());
  const currentKey = useRef(key);

  useEffect(() => {
    const el = scrollEl;
    if (!el) return;
    const onScroll = () => {
      positions.current.set(currentKey.current, el.scrollTop);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollEl]);

  useLayoutEffect(() => {
    currentKey.current = key;
    const el = scrollEl;
    if (!el || hash) return;
    el.scrollTo({ top: navType === 'POP' ? (positions.current.get(key) ?? 0) : 0 });
  }, [pathname, hash, navType, key, scrollEl]);

  return (
    <div className="app-shell">
      <Header />
      <main className="app-main" ref={setScrollEl}>
        <ScrollContainerContext.Provider value={scrollEl}>
          <div className="container">
            <Outlet />
            <BinderEditor />
            <Footer />
          </div>
        </ScrollContainerContext.Provider>
      </main>
      <MobileTabBar />
      <ToastViewport />
    </div>
  );
}
