import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { Header } from './Header';
import { MobileTabBar } from './MobileTabBar';
import { NavFab } from './NavFab';
import { Footer } from './Footer';
import { BinderEditor } from './BinderEditor';
import { ToastViewport } from './ToastViewport';
import { KeyboardShortcutsOverlay } from './KeyboardShortcutsOverlay';
import { ScrollContainerContext } from '../lib/scroll-container';
import { isNativePlatform } from '../lib/platform';
import { PullToRefresh } from './PullToRefresh';
import { refreshNow } from '../lib/sync';
import {
  ShortcutRegistryProvider,
  isTypingTarget,
  useRegisterShortcuts,
  useShortcutRegistry,
} from '../lib/shortcut-registry';

// ── Global shortcut section ───────────────────────────────────────────────────

/** The app-wide shortcuts that appear in every context. */
const GLOBAL_SHORTCUTS = [
  { keys: ['?'], description: 'Show keyboard shortcuts' },
  { keys: ['Esc'], description: 'Close overlays / dialogs' },
];

/**
 * Inner shell: has access to the registry context, so it can register the
 * Global section, wire the `?` global key, and render the overlay.
 * Layout itself is just the provider wrapper.
 */
function LayoutShell() {
  // Register the Global section (always first because it mounts first).
  useRegisterShortcuts('Global', GLOBAL_SHORTCUTS);

  const { sections, open, toggle, hide } = useShortcutRegistry();

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

  // `?` global listener — fires anywhere outside text inputs.
  // Each page/component is responsible for its own shortcuts; this wires only
  // the overlay toggle so the shortcut works from every page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== '?') return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      toggle();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggle]);

  // Build the groups prop for the overlay from registered sections.
  const overlayGroups = useMemo(
    () =>
      sections.map((s) => ({
        title: s.title,
        shortcuts: s.shortcuts,
      })),
    [sections]
  );

  return (
    <div className="app-shell">
      <Header />
      <main className="app-main" ref={setScrollEl}>
        {isNativePlatform() && <PullToRefresh scrollEl={scrollEl} onRefresh={refreshNow} />}
        <ScrollContainerContext.Provider value={scrollEl}>
          <div className="container">
            <Outlet />
            <BinderEditor />
            <Footer />
          </div>
        </ScrollContainerContext.Provider>
      </main>
      {/* Native uses a floating draggable nav FAB; web mobile keeps the
          always-visible bottom tab bar (the more discoverable pattern for
          the open web). */}
      {isNativePlatform() ? <NavFab /> : <MobileTabBar />}
      <ToastViewport />
      {open && <KeyboardShortcutsOverlay groups={overlayGroups} onClose={hide} />}
    </div>
  );
}

export function Layout() {
  return (
    <ShortcutRegistryProvider>
      <LayoutShell />
    </ShortcutRegistryProvider>
  );
}
