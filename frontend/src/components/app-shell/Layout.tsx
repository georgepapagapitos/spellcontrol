import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { Header } from './Header';
import { MobileTabBar } from './MobileTabBar';
import { ScanFab } from '@/components/scanner/ScanFab';
import { Footer } from './Footer';
import { ToastViewport } from '@/components/overlays/ToastViewport';
import { ConflictPanel } from '@/components/account/ConflictPanel';
import { KeyboardShortcutsOverlay } from './KeyboardShortcutsOverlay';
import { CommandPalette } from './CommandPalette';
import { RulesReferenceSheet } from '@/components/rules/RulesReferenceSheet';
import { ActivityLiveRegion } from './ActivityLiveRegion';
import { ScrollContainerContext } from '@/lib/util/scroll-container';
import { isTouchDevice } from '@/lib/util/platform';
import { PullToRefresh } from './PullToRefresh';
import { refreshNow } from '@/lib/sync';
import { useDocumentTitle } from '@/lib/util/use-document-title';
import { focusArrivalHeading } from '@/lib/util/scroll-to-heading';
import { useCollectionStore } from '@/store/collection';

// The binder editor (and its stylesheet) loads on its first open, not at boot:
// it is the largest dialog in the app and a first-time visitor never opens it
// (§ Boot payload is budgeted). Once loaded it stays mounted, so its closing
// animation and closed-state bookkeeping work as before.
const BinderEditor = lazy(() =>
  import('@/components/binder/BinderEditor').then((m) => ({ default: m.BinderEditor }))
);

function LazyBinderEditor() {
  const open = useCollectionStore((s) => s.editingBinder !== null);
  const [loaded, setLoaded] = useState(open);
  if (open && !loaded) setLoaded(true);
  if (!loaded) return null;
  return (
    <Suspense fallback={null}>
      <BinderEditor />
    </Suspense>
  );
}

/** Route→label map for the app's primary hub destinations. Sub-routes (e.g.
 * `/decks/:id`) inherit their hub's title until/unless they set a more
 * specific one of their own — a strict improvement over the boot-time title
 * that stuck across every navigation before this existed. */
const HUB_TITLES: Record<string, string> = {
  home: 'Home',
  collection: 'Collection',
  decks: 'Decks',
  play: 'Play',
  you: 'You',
  friends: 'Social',
  trades: 'Trades',
  pods: 'Pods',
  search: 'Search',
  rules: 'Rules',
  tags: 'Tags',
  admin: 'Admin',
};
import {
  ShortcutRegistryProvider,
  isTypingTarget,
  useRegisterShortcuts,
  useShortcutRegistry,
} from './shortcut-registry';

// ── Global shortcut section ───────────────────────────────────────────────────

/** The app-wide shortcuts that appear in every context. */
const GLOBAL_SHORTCUTS = [
  { keys: ['⌘K', 'Ctrl+K'], description: 'Open the command palette' },
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
  const [paletteOpen, setPaletteOpen] = useState(false);

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

  // Route-change announcement: a hub title in the tab, and focus moved to
  // the new page's <h1> — the same "scroll/focus a heading on arrival" idea
  // lib/util/scroll-to-heading.ts already applies to `?section=` deep links,
  // extended to ordinary top-level navigation so a screen-reader user isn't
  // silently left wherever focus last was. Skips the very first render (the
  // browser already places focus sensibly on initial load).
  useDocumentTitle(HUB_TITLES[pathname.split('/')[1] ?? ''], { hub: true });
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const el = scrollEl;
    if (!el) return;
    if (focusArrivalHeading(el)) return;
    // The route's lazy chunk (or a page that fetches before it can render a
    // title) hasn't painted its <h1> yet — catch it the moment it does.
    const observer = new MutationObserver(() => {
      if (focusArrivalHeading(el)) observer.disconnect();
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname, scrollEl]);

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

  // ⌘K / Ctrl+K — the command palette. Separate from the `?` listener above,
  // which bails on any modifier by design. Deliberately NOT gated on
  // `isTypingTarget`: a palette you cannot reach from a search box is a
  // palette you reach for and miss. The browser's own ⌘K (address bar) is
  // preventDefault'd, which is the platform convention for this shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key !== 'k' && e.key !== 'K') return;
      e.preventDefault();
      setPaletteOpen((v) => !v);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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
      {/* WCAG 2.4.1 Bypass Blocks. The header carries the brand, five nav
          links, card search and the account menu — eight tab stops a keyboard
          user crossed on every route before reaching content. Visually hidden
          until focused. `<main>` takes tabIndex={-1} so the jump moves focus,
          not just the viewport (and the shell's scroll container IS <main>). */}
      <a className="skip-link" href="#app-main">
        Skip to content
      </a>
      <Header />
      <main className="app-main" id="app-main" tabIndex={-1} ref={setScrollEl}>
        {isTouchDevice() && <PullToRefresh scrollEl={scrollEl} onRefresh={refreshNow} />}
        <ScrollContainerContext.Provider value={scrollEl}>
          <div className="container">
            {/* Pages are lazy route chunks (App.tsx). Catching the load here —
                below the header/tab bar — keeps the chrome painted while a
                hub's chunk arrives, so a first visit to a section reads as a
                page loading, not the app rebooting. */}
            <Suspense
              fallback={
                <div className="page-loader" role="status" aria-live="polite">
                  <span className="spinner" aria-hidden="true" />
                  <span className="visually-hidden">Loading</span>
                </div>
              }
            >
              <Outlet />
            </Suspense>
            <LazyBinderEditor />
            <Footer />
          </div>
        </ScrollContainerContext.Provider>
      </main>
      {/* A scan-capable device additionally floats a Scan-only FAB on top of
          the tab bar — the one action the tab bar has no room for. ScanFab
          renders nothing where scanning isn't available. */}
      <MobileTabBar />
      <ScanFab scrollEl={scrollEl} />
      <ToastViewport />
      <ConflictPanel />
      <RulesReferenceSheet />
      <ActivityLiveRegion />
      {open && <KeyboardShortcutsOverlay groups={overlayGroups} onClose={hide} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
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
