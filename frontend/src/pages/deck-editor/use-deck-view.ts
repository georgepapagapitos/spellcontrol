import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { scrollToDeckStats } from '@/components/deck/DeckDisplay';
import { type DeckView } from '@/lib/deck-analysis/deck-view';
import { type AnalysisTabId } from '@/lib/deck-analysis/deck-view';
import { type DeckCombosPanelHandle } from '@/components/deck/DeckCombosPanel';
import { type NextBestMoveFocus } from '@/deck-builder/services/deckBuilder/nextBestMove';
import { type LaneId } from '@/lib/coach/deck-change';

export function useDeckView() {
  // The deck editor is a set of page-top distinct views (Deck · Stats · Power ·
  // Tune) switched by the hub tab bar below the header. `view`
  // is the active one; the feature-strip chips + keyboard shortcuts deep-link
  // into a view and scroll it into reach. Test hand is NOT a view — it's its own
  // standalone overlay (goldfishing is a distinct activity), opened on demand
  // from the Deck-view toolbar — a modal on desktop, a bottom sheet on mobile
  // (same card-picker pattern as Add cards), so it's never pinned inline.
  const viewScrollRef = useRef<HTMLDivElement>(null);
  // The tab row's stat slot (desktop): the Deck view's stat strip renders here.
  const [statSlot, setStatSlot] = useState<HTMLDivElement | null>(null);
  const [showTestHand, setShowTestHand] = useState(false);
  // The active view lives in the URL (`?view=power`) so each tab switch is a real
  // history entry: hardware/gesture back walks back through the tabs you visited
  // before exiting the editor, and tabs become deep-linkable. 'deck' is the clean
  // default (no param). Mirrors PlayPage's `?tab=` pattern.
  const [searchParams, setSearchParams] = useSearchParams();
  const view = (searchParams.get('view') as DeckView | null) ?? 'deck';
  const setView = useCallback(
    (next: DeckView) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === 'deck') p.delete('view');
          else p.set('view', next);
          return p;
        },
        { replace: false }
      );
    },
    [setSearchParams]
  );
  // One-shot deep link from the decks-index overflow menu ("Export deck" →
  // `/decks/:id?export=1`): the open flag is captured at mount via the lazy
  // useState initializer (mirrors CollectionPage's `?add=` pattern) so it
  // stays true even after the param is stripped below and re-renders with an
  // empty searchParams. Hoisted (rather than owned by DeckDisplay) so the
  // mobile action sheet can open Export without rendering a duplicate button.
  const [exportOpen, setExportOpen] = useState(() => searchParams.get('export') === '1');
  // E458: same one-shot pattern for the upgrade plan ("Plan upgrades" on a
  // freshly added precon lands on `?view=tune&plan=1`).
  const [planOpen, setPlanOpen] = useState(() => searchParams.get('plan') === '1');
  // Same one-shot pattern for Home's "+N new cards" badge (`?arrivals=1`),
  // which lands on the new-arrivals sheet with those cards in it.
  const [arrivalsDeepLink] = useState(() => searchParams.get('arrivals') === '1');

  useEffect(() => {
    if (
      searchParams.get('export') === '1' ||
      searchParams.get('plan') === '1' ||
      searchParams.get('arrivals') === '1'
    ) {
      // Strip the params from the URL without adding a history entry so a
      // refresh — or a later bookmarked visit — doesn't re-open the dialog.
      const next = new URLSearchParams(searchParams);
      next.delete('export');
      next.delete('plan');
      next.delete('arrivals');
      setSearchParams(next, { replace: true });
    }
    // Run only once on mount — the param value is already captured in state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openView = useCallback(
    (next: DeckView) => {
      setView(next);
      // Stats is a place on the Deck tab, not a tab: `?view=stats` renders the
      // Deck tab and the arrival effect below scrolls to it after the commit.
      if (next === 'stats') return;
      window.requestAnimationFrame(() => {
        viewScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [setView]
  );
  // `?view=stats` (from openView, or a saved link to the old Stats tab and its
  // older names, overview and mana) lands on the Deck tab at the stats under
  // the list. The param stays in the URL until the next tab switch: rewriting
  // it here is a navigation, and Layout's scroll reset on navigation cancels
  // the scroll. The scroll waits for the deck, which hydrates after this
  // page's first render.
  const arrivedAtStats = ['stats', 'overview', 'mana'].includes(view);
  useEffect(() => {
    if (arrivedAtStats) window.requestAnimationFrame(scrollToDeckStats);
  }, [arrivedAtStats]);
  // Chip / keyboard deep-links target a specific analysis view.
  const openAnalysisTab = useCallback((tab: AnalysisTabId) => openView(tab), [openView]);

  // The Combos panel lives inside the Power bento; switching to Power lands on
  // the top of the bento, not the panel. A next-best-move with focus 'combos'
  // (the "Complete a combo" suggestion) reveals + scrolls the panel and opens
  // its one-away tab. The panel only mounts once Power is active, so reveal on
  // the next frame, after the view switch has committed.
  const combosRef = useRef<DeckCombosPanelHandle>(null);
  // A hero move that deep-links into the Coach feed sets this; CoachFeed maps it
  // to a filter chip, then clears it (one-shot) via onFilterHandled.
  const [tuneFocusLane, setTuneFocusLane] = useState<LaneId | null>(null);
  const clearTuneFocus = useCallback(() => setTuneFocusLane(null), []);
  const handleNbmNavigate = useCallback(
    (next: DeckView, focus?: NextBestMoveFocus) => {
      openView(next);
      if (focus === 'combos') {
        window.requestAnimationFrame(() => combosRef.current?.reveal('oneAway'));
      } else if (focus) {
        // A Tune intent lane — hand the target to DeckDisplay to reveal + scroll.
        setTuneFocusLane(focus);
      }
    },
    [openView]
  );

  // UX-311: deep-link from a StatsHero shortfall to the Coach filter that fixes
  // it. Switches to the Coach tab and sets the focus so CoachFeed activates the
  // matching chip (the same one-shot mechanism as NextBestMove deep-links).
  const handleNavigateToTune = useCallback(
    (lane: LaneId) => {
      openView('tune');
      setTuneFocusLane(lane);
    },
    [openView]
  );

  return {
    combosRef,
    planOpen,
    view,
    openAnalysisTab,
    setPlanOpen,
    setExportOpen,
    setShowTestHand,
    viewScrollRef,
    setView,
    setStatSlot,
    arrivalsDeepLink,
    exportOpen,
    statSlot,
    handleNavigateToTune,
    tuneFocusLane,
    clearTuneFocus,
    handleNbmNavigate,
    showTestHand,
  };
}
