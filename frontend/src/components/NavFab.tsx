import { BookOpen, Camera, Layers, List, Settings, Users } from 'lucide-react';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { usePlayStore } from '../store/play';
import { useCanScan } from '../lib/use-can-scan';
import { useCollectionStore } from '../store/collection';
import { useRulesReferenceStore } from '../store/rules-reference';
import { toast } from '../store/toasts';
import { importScannedCards } from '../lib/scan-import';
import { useScanQueueStore } from '../lib/use-scan-queue';

const CardScanner = lazy(() => import('./CardScanner').then((m) => ({ default: m.CardScanner })));

/** Navigation destinations, top-to-bottom as they stack above the FAB.
 *  Last entry = closest to the FAB trigger (easiest one-thumb tap). */
const NAV_ITEMS = [
  { to: '/settings', label: 'Settings', Icon: Settings },
  { to: '/decks', label: 'Decks', Icon: Layers },
  { to: '/play', label: 'Play', Icon: Users },
  { to: '/collection', label: 'Collection', Icon: List },
] as const;

const ICON_PROPS = { width: 22, height: 22, strokeWidth: 1.7, 'aria-hidden': true } as const;

/**
 * Native-only floating navigation control.
 *
 * Replaces the bottom tab bar inside the Capacitor WebView (web mobile keeps
 * `MobileTabBar`). A hamburger FAB sits locked in the bottom-right corner;
 * tapping it raises four nav destinations + (when the device supports
 * scanning) a "Scan" action above it in a speed-dial stack — each an icon
 * chip with a label pill — and tapping the scrim, a destination, or
 * pressing Escape closes it again.
 *
 * The Scan action is rendered as the topmost item so it's the easiest to
 * reach with one thumb. It launches {@link CardScanner} directly (no
 * Collection-page detour) and merges scanned cards into the collection on
 * confirm — the same flow the unified Add-cards sheet uses for its Scan
 * tab.
 *
 * The FAB is `position:absolute` inside `.app-shell` (a stable 100dvh box),
 * not `position:fixed`, so it never gets caught by the mobile URL-bar shift
 * the shell layout exists to avoid.
 */
export function NavFab() {
  const hasActiveGame = usePlayStore((s) => !!s.local || !!s.online);
  const canScan = useCanScan();
  const importCards = useCollectionStore((s) => s.importCards);
  const openRules = useRulesReferenceStore((s) => s.open);
  const [expanded, setExpanded] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  // `snap` skips the close animation: set when a destination is tapped, so
  // the overlay vanishes at once instead of animating over the new page.
  const [snap, setSnap] = useState(false);

  const fabRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null);

  const openMenu = () => {
    setSnap(false);
    setExpanded(true);
  };
  /** Dismiss without navigating — keeps the animated retract. */
  const dismiss = () => {
    setSnap(false);
    setExpanded(false);
  };
  /** Close on navigation — instant, no retract animation. */
  const closeForNav = () => {
    setSnap(true);
    setExpanded(false);
  };

  // Escape closes the menu and returns focus to the toggle. The Scan
  // overlay manages its own Escape handling, so we suppress this one
  // while it's open to avoid both closing the menu underneath.
  useEffect(() => {
    if (!expanded || scannerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismiss();
        fabRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded, scannerOpen]);

  // Move focus into the menu on open so keyboard / switch-control users land
  // on a destination instead of being stranded on the toggle.
  useEffect(() => {
    if (expanded) firstItemRef.current?.focus();
  }, [expanded]);

  const handleScanLaunch = () => {
    // Keep the menu open behind the scanner — closing it would animate
    // the chip away from under the user's finger as the camera opens.
    setScannerOpen(true);
  };

  const handleScanConfirm = async (text: string, count: number) => {
    setScannerOpen(false);
    setImporting(true);
    try {
      const { added, requested } = await importScannedCards(text, count, importCards);
      // Cards are now committed to the collection — clear the persisted queue
      // so they don't reappear next time the scanner opens. Only on success:
      // a failed import (the catch below) keeps the queue so the user can retry.
      useScanQueueStore.getState().clear();
      const tail = added === requested ? '' : ` of ${requested.toLocaleString()}`;
      toast.show({
        message: `Added ${added.toLocaleString()}${tail} scanned card${added === 1 ? '' : 's'}`,
        tone: 'success',
      });
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't save scanned cards.",
        tone: 'error',
      });
    } finally {
      setImporting(false);
      // Collapse the FAB after a successful or failed scan so the user
      // sees the toast and the page state, not a still-open menu.
      closeForNav();
    }
  };

  // Build the visible item list. Scan is the topmost (DOM-first) item so
  // visually it sits at the top of the stack with --stack equal to the
  // total item count. --stack is set inline per-item (was an nth-child
  // chain) so the layout adapts to whichever items are available.
  const items: Array<
    | { kind: 'nav'; to: string; label: string; Icon: typeof List; isPlay?: boolean }
    | {
        kind: 'action';
        label: string;
        Icon: typeof Camera;
        onClick: () => void;
        disabled?: boolean;
      }
  > = [
    ...(canScan
      ? [
          {
            kind: 'action' as const,
            label: 'Scan',
            Icon: Camera,
            onClick: handleScanLaunch,
            disabled: importing,
          },
        ]
      : []),
    {
      kind: 'action' as const,
      label: 'Rules',
      Icon: BookOpen,
      onClick: () => {
        openRules();
        closeForNav();
      },
    },
    ...NAV_ITEMS.map((n) => ({
      kind: 'nav' as const,
      to: n.to,
      label: n.label,
      Icon: n.Icon,
      isPlay: n.to === '/play',
    })),
  ];
  const total = items.length;

  return (
    <div className={`nav-fab-root${snap ? ' snap' : ''}`}>
      <div
        className={`nav-fab-scrim${expanded ? ' open' : ''}`}
        onClick={dismiss}
        aria-hidden="true"
      />
      <div className={`nav-fab${expanded ? ' open' : ''}`}>
        <nav
          id="nav-fab-menu"
          className="nav-fab-menu"
          aria-label="Primary mobile"
          style={{ '--nav-fab-menu-len': total } as React.CSSProperties}
        >
          {items.map((item, i) => {
            // The topmost (first) item gets --stack = total; the one
            // closest to the FAB (last) gets --stack = 1. Open stagger
            // counts up FROM the FAB; close stagger counts down.
            const stack = total - i;
            const style = { '--stack': stack } as React.CSSProperties;
            const isFirst = i === 0;
            if (item.kind === 'nav') {
              const isActive = item.isPlay && hasActiveGame;
              return (
                <NavLink
                  key={item.to}
                  ref={isFirst ? (firstItemRef as React.Ref<HTMLAnchorElement>) : undefined}
                  to={item.to}
                  tabIndex={expanded ? 0 : -1}
                  aria-hidden={!expanded}
                  style={style}
                  className={({ isActive: isRouteActive }) =>
                    isRouteActive ? 'nav-fab-item active' : 'nav-fab-item'
                  }
                  onClick={closeForNav}
                >
                  <span className="nav-fab-item-label">{item.label}</span>
                  <span className="nav-fab-item-glyph">
                    <item.Icon {...ICON_PROPS} />
                    {isActive && <span className="nav-fab-dot" aria-label="game in progress" />}
                  </span>
                </NavLink>
              );
            }
            return (
              <button
                key={`action-${item.label}`}
                type="button"
                ref={isFirst ? (firstItemRef as React.Ref<HTMLButtonElement>) : undefined}
                tabIndex={expanded ? 0 : -1}
                aria-hidden={!expanded}
                style={style}
                disabled={item.disabled}
                className="nav-fab-item nav-fab-item-action"
                onClick={item.onClick}
              >
                <span className="nav-fab-item-label">{item.label}</span>
                <span className="nav-fab-item-glyph">
                  <item.Icon {...ICON_PROPS} />
                </span>
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          ref={fabRef}
          className="nav-fab-btn"
          aria-label={expanded ? 'Close navigation' : 'Open navigation'}
          aria-expanded={expanded}
          aria-haspopup="true"
          aria-controls="nav-fab-menu"
          onClick={() => (expanded ? dismiss() : openMenu())}
        >
          {/* Three bars that morph between a hamburger and an X — see the
              `.nav-fab-burger` rules. The button's aria-label carries the
              state for assistive tech. */}
          <span className="nav-fab-burger" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {!expanded && hasActiveGame && <span className="nav-fab-dot" aria-hidden="true" />}
        </button>
      </div>

      {scannerOpen && (
        <Suspense fallback={null}>
          <CardScanner
            onClose={() => setScannerOpen(false)}
            onConfirm={(text, count) => void handleScanConfirm(text, count)}
          />
        </Suspense>
      )}
    </div>
  );
}
