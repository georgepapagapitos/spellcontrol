import './CoachFeed.css';
import { type JSX, useMemo, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { DeckCardRow } from './DeckCardRow';
import { SubstituteOptions } from './SubstituteOptions';
import { DeckHoverPeek } from './DeckHoverPeek';
import { NextBestMove as NextBestMoveComponent } from './NextBestMove';
import { VerdictBadge } from './VerdictBadge';
import { InfoTip } from '../InfoTip';
import { useDeckHoverPeek } from './use-deck-hover-peek';
import { useCardCarousel, type CarouselEntry } from './useCardCarousel';
import { useCardThumb } from '@/lib/card-thumbs';
import {
  fromGapCard,
  fromOptimizeCard,
  fromSynergySuggestion,
  fromSubstituteRow,
  fromBracketFitMove,
  fromCostSwapRow,
  fromComboCompletion,
  mergeImprove,
  type Change,
  type ChangeOwnership,
} from '@/lib/deck-change';
import { rankCoachMoves, type CoachContext } from '@/lib/coach-rank';
import { useRegisterShortcuts, isTypingTarget } from '@/lib/shortcut-registry';
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { OptimizeSwaps } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import type { SubstituteRow } from '@/deck-builder/services/deckBuilder/substituteFinder';
import type { CostPlan } from '@/deck-builder/services/deckBuilder/costAnalyzer';
import type { BracketFitPlan } from '@/deck-builder/services/deckBuilder/bracketFit';
import type { ComboMatch } from '@/types/combos';
import type { PlanScore } from '@/deck-builder/services/deckBuilder/planScore';
import type {
  NextBestMove,
  NextBestMoveFocus,
} from '@/deck-builder/services/deckBuilder/nextBestMove';
import type { DeckView } from './DeckDisplay';

// ── Types ──────────────────────────────────────────────────────────────────

type FilterId =
  | 'all'
  | 'fill-gaps'
  | 'upgrade'
  | 'budget'
  | 'collection'
  | 'bracket-fit'
  | 'combos';

const FILTER_LABELS: Record<FilterId, string> = {
  all: 'All',
  'fill-gaps': 'Fix gaps',
  upgrade: 'Upgrades',
  budget: 'Budget',
  collection: 'Stand-ins',
  'bracket-fit': 'Bracket',
  combos: 'Combos',
};

/** tuneFocusLane → feed filter chip mapping. */
const FOCUS_TO_FILTER: Record<string, FilterId> = {
  'fill-gaps': 'fill-gaps',
  upgrade: 'upgrade',
  budget: 'budget',
  collection: 'collection',
  'bracket-fit': 'bracket-fit',
};

// ── Shortcuts ─────────────────────────────────────────────────────────────

/**
 * Shortcuts contributed by the Coach feed to the app-wide `?` overlay.
 * STABLE module-level constant — never inline (dep-array reference equality).
 */
const COACH_SHORTCUTS = [
  { keys: ['f'], description: 'Cycle suggestion filters (All → Fix gaps → Upgrades → …)' },
];

// ── Props ──────────────────────────────────────────────────────────────────

export interface CoachFeedProps {
  // Data sources
  gaps: GapAnalysisCard[];
  optimize?: OptimizeSwaps;
  synergy: SynergySuggestion[];
  substitutes: SubstituteRow[];
  costPlan?: CostPlan;
  bracketFit?: BracketFitPlan;
  oneAwayCombos?: ComboMatch[];
  // Context for ranking
  planScore?: PlanScore;
  roleCounts?: Record<string, number>;
  roleTargets?: Record<string, number>;
  deckSize: number;
  deckTarget: number;
  bracketOverridePresent: boolean;
  // Ownership
  resolveOwnership: (name: string) => ChangeOwnership;
  ownedNames: Set<string>;
  /**
   * Lowercased names of the cards currently in the deck's mainboard — the
   * ground truth the feed filters against. The persisted analyses (gaps,
   * optimizer, bracket fit, cost plan) do NOT recompute synchronously on an
   * apply, so without this filter an applied row would linger (and an undone
   * apply couldn't bring its row back). Add rows hide once their card is in
   * the deck; swap rows need their outgoing card still present and their
   * incoming card absent; cut rows need their card still present.
   */
  deckNames: Set<string>;
  // Apply dispatch
  onApplyMove: (change: Change) => void | Promise<void>;
  onApplyAllDropIns: (
    swaps: Array<{ removeName: string; addName: string }>
  ) => void | Promise<void>;
  /**
   * Bulk-converge to the target bracket: apply every bracket-fit *swap* move at
   * once (one atomic undo entry). Swap-only — like the budget drop-ins — so the
   * deck stays at its legal size; pure cuts and upshift adds keep their per-row
   * apply (each needs its own size-aware prompt).
   */
  onConvergeBracket: (
    swaps: Array<{ removeName: string; addName: string }>
  ) => void | Promise<void>;
  /**
   * Open the "Will it fit?" audition (CardFitPanel) for an add/swap row.
   * Called with the Change so the page can resolve the incoming card name
   * and, for swap rows, pre-seed the outgoing card as the suggested cut.
   * Omit to suppress the Fit? button on all rows.
   */
  onPreviewFit?: (change: Change) => void;
  // Initial filter (from tuneFocusLane deep-link)
  initialFilter?: string;
  onFilterHandled?: () => void;
  // Analysis state
  analysisState?: 'pending' | 'ready';
  // Commander name for row copy
  commanderName?: string;
  // EDHREC theme browser
  browser?: ReactNode;
  // Busy names (actions in flight)
  busyNames?: Set<string>;
  // Next best move data (rendered at top of feed)
  nextBestMoves?: NextBestMove[];
  combosLoading?: boolean;
  onNbmNavigate?: (view: DeckView, focus?: NextBestMoveFocus) => void;
  /** "Owned only" toggle — controlled by the parent so the Next-best-move hero
   *  (built upstream) respects the same filter as the feed. */
  ownedOnly: boolean;
  onOwnedOnlyChange: (ownedOnly: boolean) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * The unified Coach tab feed. Consolidates every prescriptive suggestion
 * surface — fill gaps, upgrades, budget swaps, owned substitutes, bracket-fit
 * moves, and combo completions — into one ranked, filterable list. Replaces
 * the three separate CollapsibleLane components (ImproveLane + CostPanel +
 * BracketFitLane).
 */
export function CoachFeed({
  gaps,
  optimize,
  synergy,
  substitutes,
  costPlan,
  bracketFit,
  oneAwayCombos,
  planScore,
  roleCounts,
  roleTargets,
  deckSize,
  deckTarget,
  bracketOverridePresent,
  resolveOwnership,
  ownedNames,
  deckNames,
  onApplyMove,
  onApplyAllDropIns,
  onConvergeBracket,
  onPreviewFit,
  initialFilter,
  onFilterHandled,
  analysisState = 'ready',
  commanderName,
  browser,
  busyNames,
  nextBestMoves = [],
  combosLoading,
  onNbmNavigate,
  ownedOnly,
  onOwnedOnlyChange,
}: CoachFeedProps): JSX.Element {
  const busy = busyNames ?? new Set<string>();
  const carousel = useCardCarousel('Coach');
  // Cursor-anchored hover-peek — floats card art beside the pointer on
  // hover-capable viewports. Touch devices keep the tap→carousel flow.
  const hoverPeek = useDeckHoverPeek();
  // Full-size peek art resolved via CDN (cached + batched, never the
  // rate-limited API image host).
  const peekUrl = useCardThumb(hoverPeek.peek?.name, 'normal');

  // Derive the active filter chip from the deep-link prop (tuneFocusLane).
  // The lazy initializer covers the mount case (arriving from another tab),
  // so the first render already shows the right chip. The effect covers the
  // mounted case — an NBM preset clicked while already on the Coach tab sets
  // the prop on a live feed, so it must also setActiveFilter. The parent
  // clears the prop via onFilterHandled; the ref resets on that clear so the
  // SAME preset can re-fire later.
  const [activeFilter, setActiveFilter] = useState<FilterId>(() =>
    initialFilter ? (FOCUS_TO_FILTER[initialFilter] ?? 'all') : 'all'
  );

  const ackedFilterRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!initialFilter) {
      ackedFilterRef.current = undefined;
      return;
    }
    if (ackedFilterRef.current === initialFilter) return;
    ackedFilterRef.current = initialFilter;
    setActiveFilter(FOCUS_TO_FILTER[initialFilter] ?? 'all');
    onFilterHandled?.();
  }, [initialFilter, onFilterHandled]);

  // ── Row-leave animation (animate, THEN apply) ────────────────────────────
  // The persisted analyses don't recompute synchronously, and a cut mutates the
  // store synchronously — so "apply first, animate the survivor" either snaps
  // the row back (adds) or never shows the animation at all (cuts). Instead:
  // clicking Apply marks the row leaving and PARKS the Change; the apply fires
  // on animationend (or immediately under reduced motion / on unmount, so a
  // mid-animation tab switch can't lose the user's click). After the apply the
  // id sits in `departedIds` to bridge any async gap before the deck update
  // drops the row from the data; an effect prunes departed ids the moment the
  // data no longer contains them, so an UNDONE apply brings its row back.
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());
  const [departedIds, setDepartedIds] = useState<Set<string>>(new Set());
  const pendingApplyRef = useRef(new Map<string, Change>());
  const onApplyMoveRef = useRef(onApplyMove);
  useEffect(() => {
    onApplyMoveRef.current = onApplyMove;
  }, [onApplyMove]);

  const prefersReducedMotion = useCallback(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
    []
  );

  const handleApplyWithLeave = useCallback(
    (change: Change) => {
      if (prefersReducedMotion()) {
        void onApplyMoveRef.current(change);
        return;
      }
      pendingApplyRef.current.set(change.id, change);
      setLeavingIds((prev) => new Set([...prev, change.id]));
    },
    [prefersReducedMotion]
  );

  const handleLeavingAnimationEnd = useCallback((id: string, e: React.AnimationEvent) => {
    if (e.animationName !== 'coach-row-leave') return;
    const change = pendingApplyRef.current.get(id);
    pendingApplyRef.current.delete(id);
    if (change) void onApplyMoveRef.current(change);
    setLeavingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    // Hide the row while the (possibly async) apply propagates to the deck;
    // the pruning effect below releases the id once the data drops the row.
    setDepartedIds((prev) => new Set([...prev, id]));
  }, []);

  // A mid-animation unmount must not swallow the click — flush pending applies.
  useEffect(
    () => () => {
      for (const change of pendingApplyRef.current.values()) {
        void onApplyMoveRef.current(change);
      }
      pendingApplyRef.current.clear();
    },
    []
  );

  // ── Shortcut registration + `f` key cycle ───────────────────────────────
  useRegisterShortcuts('Coach', COACH_SHORTCUTS);

  // Ordered list of chips that actually have rows (used to cycle with `f`).
  // Computed from filterCounts, but filterCounts isn't available yet (it's
  // defined below in the return path). We derive it inline from addsAndSwaps
  // after ranking, so the effect can reference it. We store it in a ref so
  // the keydown listener always sees the current set without re-registering.
  const cyclableFiltersRef = useRef<FilterId[]>(['all']);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'f' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const filters = cyclableFiltersRef.current;
      if (filters.length === 0) return;
      setActiveFilter((curr) => {
        const idx = filters.indexOf(curr);
        return filters[(idx + 1) % filters.length];
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Build all changes ────────────────────────────────────────────────────

  const allChanges = useMemo<Change[]>(() => {
    const adds: Change[] = [
      ...gaps.map((g) => fromGapCard(g, resolveOwnership(g.name))),
      ...(optimize?.additions ?? []).map((o) =>
        fromOptimizeCard(o, 'add', resolveOwnership(o.name))
      ),
      ...synergy.map((s) => fromSynergySuggestion(s, resolveOwnership(s.cardName))),
      ...substitutes.map(fromSubstituteRow),
    ];

    const allCostRows = [...(costPlan?.spellRows ?? []), ...(costPlan?.landRows ?? [])];

    const costChanges: Change[] = allCostRows.map((row) =>
      fromCostSwapRow(row, resolveOwnership(row.suggestionName))
    );

    const bracketChanges: Change[] = (bracketFit?.moves ?? []).map((m) => {
      if (m.type === 'swap' && m.inName) {
        return fromBracketFitMove(m, resolveOwnership(m.inName));
      }
      return fromBracketFitMove(m, m.type === 'cut' ? undefined : resolveOwnership(m.name));
    });

    const validOneAway = (oneAwayCombos ?? []).filter(
      (match) => match.missingOracleIds.length === 1
    );
    const comboChanges: Change[] = validOneAway
      .map((match) => {
        const missingId = match.missingOracleIds[0];
        const missingCard = match.combo.cards.find((c) => c.oracleId === missingId);
        if (!missingCard) return null;
        return fromComboCompletion(
          match,
          missingCard.cardName,
          resolveOwnership(missingCard.cardName)
        );
      })
      .filter((c): c is Change => c !== null);

    // Merge add-type changes (dedup by name, keep higher-signal row).
    const mergedAdds = mergeImprove(adds);

    // Swaps/cuts from cost + bracket-fit (have specific target slots, skip dedup),
    // plus the optimizer's "consider cutting" rows (ownership-blind — the card is
    // already in the deck).
    const swapsAndCuts = [
      ...costChanges,
      ...bracketChanges.filter((c) => c.type === 'swap' || c.type === 'cut'),
      ...(optimize?.removals ?? []).map((o) => fromOptimizeCard(o, 'cut')),
    ];

    // Bracket adds (not swaps/cuts).
    const bracketAdds = bracketChanges.filter((c) => c.type === 'add');

    // Ground-truth filter against the live deck list (see the deckNames prop
    // doc): applied rows drop out, undone applies come back, and a swap whose
    // target slot is gone can no longer be offered.
    const inDeck = (n: string) => deckNames.has(n.toLowerCase());
    return [...mergedAdds, ...bracketAdds, ...comboChanges, ...swapsAndCuts].filter((c) => {
      if (c.type === 'add') return !inDeck(c.name);
      if (c.type === 'cut') return inDeck(c.name);
      return c.inName ? inDeck(c.inName) && !inDeck(c.name) : false;
    });
  }, [
    gaps,
    optimize,
    synergy,
    substitutes,
    costPlan,
    bracketFit,
    oneAwayCombos,
    resolveOwnership,
    deckNames,
  ]);

  // ── Rank ─────────────────────────────────────────────────────────────────

  const ctx: CoachContext = useMemo(
    () => ({
      planScore,
      roleCounts: roleCounts ?? {},
      roleTargets: roleTargets ?? {},
      deckSize,
      deckTarget,
      bracketOverridePresent,
      ownedNames,
    }),
    [planScore, roleCounts, roleTargets, deckSize, deckTarget, bracketOverridePresent, ownedNames]
  );

  // Rank, then dedupe add-type rows by card name keeping the highest-ranked
  // occurrence — mergeImprove only dedupes the three improve sources, so a card
  // suggested by both (say) the gap engine and a combo completion would
  // otherwise render twice in one feed.
  const ranked = useMemo(() => {
    const all = rankCoachMoves(allChanges, ctx);
    const seenAdds = new Set<string>();
    return all.filter((m) => {
      if (m.change.type !== 'add') return true;
      const key = m.change.name.toLowerCase();
      if (seenAdds.has(key)) return false;
      seenAdds.add(key);
      return true;
    });
  }, [allChanges, ctx]);

  // ── Separate adds/swaps from cuts ────────────────────────────────────────

  // Release departed ids once the deck update has genuinely dropped their rows
  // from the data — after that the id is stale bookkeeping, and if the row ever
  // legitimately returns (the apply was undone), it must not stay hidden.
  // Render-phase adjustment (react.dev "storing information from previous
  // renders"): guarded setState during render, NOT an effect — React re-renders
  // immediately without committing the stale frame.
  const liveIds = useMemo(() => new Set(ranked.map((r) => r.change.id)), [ranked]);
  if (departedIds.size > 0 && [...departedIds].some((id) => !liveIds.has(id))) {
    setDepartedIds(new Set([...departedIds].filter((id) => liveIds.has(id))));
  }

  const addsAndSwaps = useMemo(
    () => ranked.filter((r) => r.change.type !== 'cut' && !departedIds.has(r.change.id)),
    [ranked, departedIds]
  );
  const cuts = useMemo(
    () => ranked.filter((r) => r.change.type === 'cut' && !departedIds.has(r.change.id)),
    [ranked, departedIds]
  );

  // ── Filter ───────────────────────────────────────────────────────────────

  const filteredAdds = useMemo(() => {
    let list = addsAndSwaps;
    if (ownedOnly) {
      list = list.filter((r) => r.change.ownership === 'owned');
    }
    if (activeFilter !== 'all') {
      list = list.filter((r) => r.change.lane === activeFilter);
    }
    return list;
  }, [addsAndSwaps, activeFilter, ownedOnly]);

  // ── Chip counts ──────────────────────────────────────────────────────────
  //
  // Two count maps per lane:
  //  • shown  — rows that survive the current `ownedOnly` filter. This is the
  //    badge number, so it always matches the body (the chip is a faceted-search
  //    preview of what clicking yields — never a count that disagrees with the
  //    list, which is the bug this replaced).
  //  • total  — rows ignoring `ownedOnly`. Drives chip *visibility* and the
  //    "all N are unowned" empty-state hint, so a lane the toggle emptied stays
  //    reachable instead of silently vanishing.
  const { shownCounts, totalCounts } = useMemo(() => {
    const make = (): Record<FilterId, number> => ({
      all: 0,
      'fill-gaps': 0,
      upgrade: 0,
      budget: 0,
      collection: 0,
      'bracket-fit': 0,
      combos: 0,
    });
    const shown = make();
    const total = make();
    for (const r of addsAndSwaps) {
      const lane = r.change.lane as FilterId;
      const visible = !ownedOnly || r.change.ownership === 'owned';
      if (lane in total) {
        total[lane]++;
        if (visible) shown[lane]++;
      }
      total.all++;
      if (visible) shown.all++;
    }
    return { shownCounts: shown, totalCounts: total };
  }, [addsAndSwaps, ownedOnly]);

  // Body empty purely because `ownedOnly` hid every match in this lane — drives
  // the context-aware empty state (explain + one-tap relax) rather than a bare
  // "nothing here", which reads as a dead-end.
  const hiddenByOwned = totalCounts[activeFilter] - shownCounts[activeFilter];
  const isOwnedEmpty = ownedOnly && filteredAdds.length === 0 && hiddenByOwned > 0;

  // ── Update cyclable-filters ref (for `f` key cycle) ─────────────────────
  // The `f` key listener uses a ref so it doesn't need to re-register on
  // every render; we sync it via an effect (writing refs during render is
  // flagged by react-hooks/refs).
  const cyclableList = useMemo<FilterId[]>(
    () =>
      (Object.keys(FILTER_LABELS) as FilterId[]).filter((f) => f === 'all' || totalCounts[f] > 0),
    [totalCounts]
  );
  useEffect(() => {
    cyclableFiltersRef.current = cyclableList;
  }, [cyclableList]);

  // ── Drop-in budget changes for "Apply all" ───────────────────────────────

  const dropInChanges = useMemo(
    () =>
      addsAndSwaps.filter(
        (r) => r.change.lane === 'budget' && r.change.confidence === 'drop-in' && r.change.inName
      ),
    [addsAndSwaps]
  );

  // Size-safe subset of the bracket-fit plan for "Converge to target": only the
  // net-neutral swap moves (a downshift cut paired with a pool replacement, or an
  // upshift game-changer swap). Pure cuts / upshift adds are excluded — they
  // change the deck size and keep their per-row apply + size-aware prompt.
  const bracketSwaps = useMemo(
    () =>
      addsAndSwaps.filter(
        (r) => r.change.lane === 'bracket-fit' && r.change.type === 'swap' && r.change.inName
      ),
    [addsAndSwaps]
  );

  // ── Carousel entries (all previewable changes for swipe support) ─────────

  const entryFor = (change: Change): CarouselEntry => ({
    name: change.name,
    label:
      typeof change.inclusion === 'number'
        ? `In ${Math.round(change.inclusion)}% of decks`
        : 'Suggested',
  });
  const previewEntries = useMemo<CarouselEntry[]>(
    () =>
      // Nested owned-substitute alternatives are previewable too, so the carousel
      // can swipe to them from their row.
      [...addsAndSwaps, ...cuts].flatMap(({ change }) => [
        entryFor(change),
        ...(change.alternatives ?? []).map(entryFor),
      ]),
    [addsAndSwaps, cuts]
  );

  // ── Skeleton ─────────────────────────────────────────────────────────────

  if (analysisState === 'pending' && allChanges.length === 0) {
    return (
      <div className="coach-feed">
        {(nextBestMoves.length > 0 || combosLoading) && (
          <NextBestMoveComponent
            moves={nextBestMoves}
            onNavigate={onNbmNavigate}
            combosLoading={combosLoading}
            currentView="tune"
          />
        )}
        <div
          className="deck-analysis-skeleton"
          role="status"
          aria-label="Analyzing your deck…"
          aria-live="polite"
        >
          <p className="deck-analysis-skeleton-eyebrow">Analyzing your deck…</p>
          <div className="deck-analysis-skeleton-bar is-headline" />
          <div className="deck-analysis-skeleton-bar is-body" />
          <div className="deck-analysis-skeleton-lane">
            <div className="deck-analysis-skeleton-bar is-body" />
            <div className="deck-analysis-skeleton-bar is-body is-short" />
          </div>
          <div className="deck-analysis-skeleton-lane">
            <div className="deck-analysis-skeleton-bar is-body is-short" />
            <div className="deck-analysis-skeleton-bar is-body" />
          </div>
        </div>
      </div>
    );
  }

  // ── Empty state (tuned deck, no changes at all) ───────────────────────────

  const isPending = analysisState === 'pending';

  return (
    <div className="coach-feed" {...hoverPeek.listHandlers}>
      {/* Next best move headline — always at top when data is available */}
      {(nextBestMoves.length > 0 || combosLoading) && (
        <NextBestMoveComponent
          moves={nextBestMoves}
          onNavigate={onNbmNavigate}
          combosLoading={combosLoading}
          currentView="tune"
        />
      )}

      {!isPending && allChanges.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-tagline">Nothing to coach — this deck looks tuned.</p>
          <p className="empty-state-hint">
            Your deck is well-covered. Try adjusting your bracket target or browsing themes below.
          </p>
        </div>
      ) : (
        <>
          {/* Filter chips */}
          <div className="coach-feed-header">
            <div className="coach-feed-filters" role="group" aria-label="Filter suggestions">
              {(Object.keys(FILTER_LABELS) as FilterId[]).map((f) => {
                const shown = shownCounts[f];
                const total = totalCounts[f];
                // Visible when the lane has any match at all (owned or not), so a
                // lane `ownedOnly` has emptied stays reachable — clicking it lands
                // on the "all N are unowned" empty state rather than disappearing.
                if (f !== 'all' && total === 0) return null;
                const ownedEmpty = f !== 'all' && shown === 0 && total > 0;
                return (
                  <button
                    key={f}
                    type="button"
                    className={
                      'coach-feed-filter-chip' +
                      (ownedEmpty ? ' coach-feed-filter-chip--owned-empty' : '')
                    }
                    aria-pressed={activeFilter === f}
                    onClick={() => setActiveFilter(f)}
                  >
                    {FILTER_LABELS[f]}
                    {shown > 0 && f !== 'all' && (
                      <span className="coach-feed-chip-count">{shown}</span>
                    )}
                  </button>
                );
              })}
              <label className="coach-feed-owned-toggle">
                <input
                  type="checkbox"
                  className="field-checkbox"
                  checked={ownedOnly}
                  onChange={(e) => onOwnedOnlyChange(e.target.checked)}
                />
                Owned only
              </label>
            </div>

            {/* Apply all drop-ins — budget filter only */}
            {activeFilter === 'budget' && dropInChanges.length > 0 && (
              <button
                type="button"
                className="coach-feed-apply-all"
                onClick={() =>
                  void onApplyAllDropIns(
                    dropInChanges
                      .filter((r) => r.change.inName)
                      .map((r) => ({
                        removeName: r.change.inName!,
                        addName: r.change.name,
                      }))
                  )
                }
              >
                <Check width={14} height={14} aria-hidden />
                Apply all {dropInChanges.length} drop-in{dropInChanges.length > 1 ? 's' : ''}
              </button>
            )}

            {/* Converge to target — bracket-fit filter, swap moves only */}
            {activeFilter === 'bracket-fit' && bracketSwaps.length > 0 && (
              <button
                type="button"
                className="coach-feed-apply-all"
                onClick={() =>
                  void onConvergeBracket(
                    bracketSwaps.map((r) => ({
                      removeName: r.change.inName!,
                      addName: r.change.name,
                    }))
                  )
                }
              >
                <Check width={14} height={14} aria-hidden />
                Apply all {bracketSwaps.length} swap{bracketSwaps.length > 1 ? 's' : ''}
              </button>
            )}
          </div>

          {/* Budget confidence legend — budget filter only */}
          {activeFilter === 'budget' && filteredAdds.length > 0 && (
            <div className="coach-feed-budget-strip">
              <span className="coach-feed-budget-summary">
                Badges rate how close each cheaper pick is to the card it replaces
              </span>
              <InfoTip
                label="budget confidence"
                text={
                  <>
                    <p className="info-tip-lead">
                      How close each cheaper pick is to the card it replaces:
                    </p>
                    <ul className="info-tip-list">
                      <li>
                        <strong>Drop-in</strong> — near-identical; swap freely.
                      </li>
                      <li>
                        <strong>Sidegrade</strong> — a lateral trade, a bit less played.
                      </li>
                      <li>
                        <strong>Budget</strong> — a real downgrade for the savings.
                      </li>
                    </ul>
                  </>
                }
              />
            </div>
          )}

          {/* Bracket strip — bracket-fit filter only */}
          {activeFilter === 'bracket-fit' && bracketFit && bracketFit.direction !== 'aligned' && (
            <div className="coach-feed-bracket-strip">
              <span className="coach-feed-bracket-summary">{bracketFit.summary}</span>
              {bracketFit.note && (
                <span className="coach-feed-bracket-note">{bracketFit.note}</span>
              )}
            </div>
          )}

          {/* Stand-ins strip — collection filter only */}
          {activeFilter === 'collection' && filteredAdds.length > 0 && (
            <div className="coach-feed-collection-strip">
              <span className="coach-feed-collection-summary">
                Cards you already own that cover staples this deck is missing.
              </span>
            </div>
          )}

          {/* Feed rows */}
          {filteredAdds.length > 0 ? (
            <ul className="coach-feed-rows">
              {filteredAdds.map(({ change }) => {
                const isLeaving = leavingIds.has(change.id);
                const showFit = onPreviewFit && change.type !== 'cut';
                return (
                  <li
                    key={change.id}
                    className={isLeaving ? 'coach-feed-row-leaving' : undefined}
                    onAnimationEnd={
                      isLeaving ? (e) => handleLeavingAnimationEnd(change.id, e) : undefined
                    }
                  >
                    <DeckCardRow
                      change={change}
                      commanderName={commanderName}
                      peekName={change.name}
                      onPreview={() => carousel.open(previewEntries, change.name)}
                      onAct={(c) => handleApplyWithLeave(c)}
                      acting={
                        busy.has(change.name) || (change.inName ? busy.has(change.inName) : false)
                      }
                      secondaryAction={
                        showFit
                          ? {
                              label: 'Fit?',
                              ariaLabel: `Will ${change.name} fit this deck?`,
                              onClick: () => onPreviewFit(change),
                            }
                          : undefined
                      }
                    />
                    {change.alternatives && change.alternatives.length > 0 && (
                      <SubstituteOptions
                        alternatives={change.alternatives}
                        commanderName={commanderName}
                        onPreview={(name) => carousel.open(previewEntries, name)}
                        onAct={(c) => handleApplyWithLeave(c)}
                        acting={(name) => busy.has(name)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            !isPending &&
            (isOwnedEmpty ? (
              <div className="coach-feed-empty-filter coach-feed-empty-owned">
                <p>
                  {hiddenByOwned === 1 ? 'The only' : `All ${hiddenByOwned}`}{' '}
                  {activeFilter === 'all' ? '' : FILTER_LABELS[activeFilter] + ' '}
                  suggestion{hiddenByOwned === 1 ? ' is a card' : 's are cards'} you don't own yet.
                </p>
                <button
                  type="button"
                  className="coach-feed-show-unowned"
                  onClick={() => onOwnedOnlyChange(false)}
                >
                  Show unowned too
                </button>
              </div>
            ) : (
              <p className="coach-feed-empty-filter">
                No {activeFilter === 'all' ? '' : FILTER_LABELS[activeFilter] + ' '}suggestions
                right now.
              </p>
            ))
          )}

          {/* Cuts disclosure group */}
          {cuts.length > 0 && (
            <details className="coach-feed-cuts">
              <summary className="coach-feed-cuts-title">
                <ChevronDown
                  width={14}
                  height={14}
                  aria-hidden
                  className="coach-feed-cuts-chevron"
                />
                Cuts ({cuts.length})
              </summary>
              <ul className="coach-feed-rows coach-feed-cuts-list">
                {cuts.map(({ change }) => {
                  const isLeaving = leavingIds.has(change.id);
                  return (
                    <li
                      key={change.id}
                      className={isLeaving ? 'coach-feed-row-leaving' : undefined}
                      onAnimationEnd={
                        isLeaving ? (e) => handleLeavingAnimationEnd(change.id, e) : undefined
                      }
                    >
                      <DeckCardRow
                        change={change}
                        commanderName={commanderName}
                        peekName={change.name}
                        onPreview={() => carousel.open(previewEntries, change.name)}
                        onAct={(c) => handleApplyWithLeave(c)}
                        acting={busy.has(change.name)}
                      />
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          {/* Aligned bracket state */}
          {activeFilter === 'bracket-fit' && bracketFit?.direction === 'aligned' && (
            <div className="coach-feed-bracket-aligned">
              <VerdictBadge tone="success" label="Aligned" />
            </div>
          )}
        </>
      )}

      {/* EDHREC theme browser */}
      {browser && (
        <details className="coach-feed-browser-section">
          <summary>
            <ChevronDown width={14} height={14} aria-hidden />
            Browse all EDHREC suggestions
          </summary>
          <div className="coach-feed-browser">{browser}</div>
        </details>
      )}

      {/* Desktop hover-peek — portaled to <body> so it escapes any
          container-type ancestor (e.g. .deck-bento--tune) that would
          make position:fixed relative to the container, not the viewport. */}
      {hoverPeek.peek &&
        peekUrl &&
        createPortal(
          <DeckHoverPeek
            imageUrl={peekUrl}
            left={hoverPeek.peek.left}
            top={hoverPeek.peek.top}
            width={hoverPeek.peek.width}
          />,
          document.body
        )}

      {/* Card carousel — tap-to-preview on touch */}
      {carousel.preview}
    </div>
  );
}
