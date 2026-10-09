import '@/styles/deck-builder-analysis.css';
import './CoachFeed.css';
import { type JSX, useMemo, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { DeckCardRow } from './DeckCardRow';
import { SubstituteOptions } from './SubstituteOptions';
import { DeckHoverPeek } from './DeckHoverPeek';
import { NextBestMove as NextBestMoveComponent } from './NextBestMove';
import { UpgradePlanSheet } from './UpgradePlanSheet';
import type { UpgradePlanTools } from '@/lib/coach/upgrade-plan-tools';
import type { PlanStep } from '@/lib/coach/apply-upgrade-plan';
import { DeckAnalysisSkeleton } from './DeckAnalysisSkeleton';
import {
  BracketFitStrip,
  BudgetConfidenceStrip,
  CutsLaneStatus,
  UpgradePlanEntry,
} from './CoachFeedStrips';
import { VerdictBadge } from './VerdictBadge';
import { Button } from '@/components/shared/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { Surface } from '@/components/shared/Surface';
import { useDeckHoverPeek } from './use-deck-hover-peek';
import { useTouchPeek } from '@/lib/overlays/use-touch-peek';
import { useCardCarousel, type CarouselEntry } from './useCardCarousel';
import { useOwnedCardThumb } from '@/lib/cards/owned-printing';
import { classifyInclusion } from '@/lib/deck-analysis/inclusion-label';
import { buildCoachChanges } from '@/lib/coach/coach-changes';
import { isOffMetaChange, type Change, type ChangeOwnership } from '@/lib/coach/deck-change';
import { rankCoachMoves, type CoachContext, diversifyRankedMoves } from '@/lib/coach/coach-rank';
import { cutLane, isPairedCut } from '@/lib/coach/coach-cut-swaps';
import { useCutSwaps, type CutSwapSources } from '@/lib/coach/use-cut-swaps';
import { usePlanJudge } from '@/lib/coach/use-plan-judge';
import { useFilterCycle } from './use-filter-cycle';
import { useCoachFeedLabels } from './use-coach-feed-labels';
import { HiddenSuggestions } from './HiddenSuggestions';
import { useDismissedSuggestions, withoutDismissed } from '@/lib/coach/dismissed-suggestions';
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { OptimizeSwaps } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import type { SubstituteRow } from '@/deck-builder/services/deckBuilder/substituteFinder';
import type { CostPlan } from '@/deck-builder/services/deckBuilder/costAnalyzer';
import type { BracketFitPlan } from '@/deck-builder/services/deckBuilder/bracketFit';
import type { LandUpgradeMove } from '@/deck-builder/services/deckBuilder/landUpgrades';
import type { ComboMatch } from '@/types/combos';
import type { CrossDeckMove } from '@/lib/coach/cross-deck-moves';
import type { PlanScore } from '@/deck-builder/services/deckBuilder/planScore';
import type { MisfitSummary } from '@/deck-builder/services/deckBuilder/cardFit';
import type {
  NextBestMove,
  NextBestMoveFocus,
} from '@/deck-builder/services/deckBuilder/nextBestMove';
import type { DeckView } from './DeckDisplay';
import { Chip } from '@/components/shared/Chip';
import type { SettingsBreak } from '@/lib/coach/deck-settings-fit';
import {
  FILTER_LABELS,
  FOCUS_TO_FILTER,
  ROW_CAP,
  settingsEmptyHint,
  type FilterId,
} from './coach-feed-filters';

// ── Props ──────────────────────────────────────────────────────────────────

export interface CoachFeedProps {
  // Data sources
  gaps: GapAnalysisCard[];
  optimize?: OptimizeSwaps;
  /** E222: cardFit misfits (deck.misfits) — merged into the Cuts lane. */
  misfits?: MisfitSummary[];
  synergy: SynergySuggestion[];
  substitutes: SubstituteRow[];
  costPlan?: CostPlan;
  bracketFit?: BracketFitPlan;
  landUpgrades?: LandUpgradeMove[];
  oneAwayCombos?: ComboMatch[];
  /** E90: owned copies idle in a sibling deck that would feed an engine here,
   *  each with an owned patch for the deck it leaves. Applied by the page. */
  crossDeckMoves?: CrossDeckMove[];
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
  // Analysis state. E162: 'error' = the first analysis attempt failed/stalled.
  analysisState?: 'pending' | 'ready' | 'error';
  /** E162: retries a failed/stalled first analysis. Passed only when analysisState is 'error'. */
  onRetryAnalysis?: () => void;
  /**
   * The persisted analysis ran without EDHREC (unreachable / this commander
   * isn't indexed) — gaps/optimize/cost/synergy lanes are all EDHREC-derived,
   * so they're absent even though `analysisState` is 'ready'. Shows a
   * retryable notice where those lanes would be, instead of a silent empty feed.
   */
  edhrecMissing?: boolean;
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
  /** Add a card a Next-best-move names, directly from the hero. */
  onNbmApply?: (cardName: string) => void;
  /** Open "Fill the rest" (under-size Commander deck). */
  onNbmFill?: () => void;
  /** "Owned only" toggle — controlled by the parent so the Next-best-move hero
   *  (built upstream) respects the same filter as the feed. */
  ownedOnly: boolean;
  onOwnedOnlyChange: (ownedOnly: boolean) => void;
  /**
   * E274: the live AI refine reading's picks, incoming-card name → its why.
   * A feed row for the same card gets the "AI agrees" line. Display-only
   * join over output already in the browser — never changes what the model
   * sees, so it costs nothing (see `hashRefineInput`).
   */
  aiAgrees?: ReadonlyMap<string, string>;
  /** The saved setting a move breaks, or null (lib/coach/deck-settings-fit.ts). A
   *  move that breaks one is not shown; the empty state names the setting. */
  settingsBreak?: (change: Change) => SettingsBreak | null;
  /** False for an add the replace prompt has no cut for: it ranks last (replace-cuts.ts). */
  hasReplaceCut?: (change: Change) => boolean;
  /** The bracket the deck is held to; a game-ending combo is promoted only where combos count. */
  targetBracket?: number | 'all';
  /** An add that has a real protected cut, or needs none (replace-cuts.ts `hasProtectedCut`). */
  hasProtectedCut?: (change: Change) => boolean;
  /**
   * What the Cuts lane needs to pair each cut with its best replacement (E540
   * S6): the saved deck and its combos. Omit and the lane shows today's cuts.
   */
  cutSwaps?: CutSwapSources;
  /**
   * E458: the upgrade plan. The feed hosts it because the plan spends a
   * budget over this feed's own ranked list; the page owns the open flag (a
   * `?plan=1` deep link opens it) and the bracket tools. Omit to hide it.
   */
  upgradePlan?: {
    deckId: string;
    /** Null until the plan opens: building them runs the estimator. */
    tools: UpgradePlanTools | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onApply: (steps: PlanStep[], toCopy: boolean) => Promise<void>;
  };
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
  misfits,
  synergy,
  substitutes,
  costPlan,
  bracketFit,
  landUpgrades,
  oneAwayCombos,
  crossDeckMoves,
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
  onRetryAnalysis,
  edhrecMissing = false,
  commanderName,
  browser,
  busyNames,
  nextBestMoves = [],
  combosLoading,
  onNbmNavigate,
  onNbmApply,
  onNbmFill,
  ownedOnly,
  onOwnedOnlyChange,
  aiAgrees,
  settingsBreak,
  hasReplaceCut,
  targetBracket,
  hasProtectedCut,
  cutSwaps,
  upgradePlan,
}: CoachFeedProps): JSX.Element {
  const busy = busyNames ?? new Set<string>();
  // "Not for this deck" (E580): what the player hid never reaches the feed.
  const hidden = useDismissedSuggestions();
  // "In 71% of Sram decks": the rows read the commander by its short name, so
  // the played-in line holds one line in the table's column.
  const commanderShort = commanderName?.split(',')[0].trim();
  const carousel = useCardCarousel('Coach');
  // Cursor-anchored hover-peek — floats card art beside the pointer on
  // hover-capable viewports. Touch devices keep the tap→carousel flow.
  const hoverPeek = useDeckHoverPeek();
  // Full-size peek art resolved via CDN (cached + batched, never the
  // rate-limited API image host).
  const peekUrl = useOwnedCardThumb(hoverPeek.peek?.name, 'normal');
  // Touch parity (E129): long-press a row for the same glance. Covers every
  // `DeckCardRow` nested inside `.coach-feed` (including `SubstituteOptions`
  // a few components down) via one delegated container gesture — see
  // `useTouchPeek`'s coexistence contract.
  const touchPeek = useTouchPeek();
  const touchPeekUrl = useOwnedCardThumb(touchPeek.peek?.name, 'normal');

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

  // E64: cross-lane "Off-meta" toggle — spicy, off-the-beaten-path picks are
  // scattered across whichever lane produced them (lands, upgrades, gap
  // fills, …), not one lane, so this narrows alongside `activeFilter` rather
  // than being another entry in it. Local/unpersisted: purely a display
  // filter (unlike `ownedOnly`, it feeds no analysis context upstream), so it
  // doesn't need the parent-lifted state that prop gets.
  const [offMetaOnly, setOffMetaOnly] = useState(false);

  // Progressive disclosure: the feed shows one bounded page and the user asks
  // for the rest ("Show all N"). An unbounded "All" lane rendered 30–60 rows
  // and buried everything below it (the browse catalog, the AI panels). Reset
  // whenever the visible slice changes meaning — each lane/toggle starts back
  // at its first page. Render-phase adjustment (react.dev "storing information
  // from previous renders"), same pattern as departedIds below.
  const [showAllRows, setShowAllRows] = useState(false);
  const sliceKey = `${activeFilter}|${ownedOnly}|${offMetaOnly}`;
  const [prevSliceKey, setPrevSliceKey] = useState(sliceKey);
  if (prevSliceKey !== sliceKey) {
    setPrevSliceKey(sliceKey);
    if (showAllRows) setShowAllRows(false);
  }

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

  // ── Build all changes ────────────────────────────────────────────────────

  const unfiltered = useMemo<Change[]>(
    () =>
      buildCoachChanges(
        {
          gaps,
          optimize,
          misfits,
          synergy,
          substitutes,
          costPlan,
          bracketFit,
          landUpgrades,
          oneAwayCombos,
          crossDeckMoves,
        },
        resolveOwnership,
        deckNames,
        undefined,
        settingsBreak && ((c) => settingsBreak(c) === null)
      ),
    [
      gaps,
      optimize,
      misfits,
      synergy,
      substitutes,
      costPlan,
      bracketFit,
      landUpgrades,
      oneAwayCombos,
      crossDeckMoves,
      resolveOwnership,
      deckNames,
      settingsBreak,
    ]
  );
  // A move that breaks the deck's own settings is not shown (and not planned).
  const [allChanges, hiddenBy] = useMemo(() => {
    const reasons = settingsBreak ? unfiltered.map(settingsBreak) : [];
    const kept = settingsBreak ? unfiltered.filter((_, i) => reasons[i] === null) : unfiltered;
    return [
      withoutDismissed(kept, hidden.list),
      reasons.filter((r): r is SettingsBreak => r !== null),
    ] as const;
  }, [unfiltered, settingsBreak, hidden.list]);

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
      hasReplaceCut,
      targetBracket,
      hasProtectedCut,
    }),
    [
      planScore,
      roleCounts,
      roleTargets,
      deckSize,
      deckTarget,
      bracketOverridePresent,
      ownedNames,
      hasReplaceCut,
      targetBracket,
      hasProtectedCut,
    ]
  );

  // Rank, then dedupe add-type rows by card name keeping the highest-ranked
  // occurrence — mergeImprove only dedupes the three improve sources, so a card
  // suggested by both (say) the gap engine and a combo completion would
  // otherwise render twice in one feed.
  // Then diversify: a combo whose partner set is already shown twice defers
  // its remaining completions to the end of the list (behind "Show all"), so
  // the first fold is different ideas rather than eight "Krenko + Skirk
  // Prospector" rows.
  const ranked = useMemo(() => {
    const all = rankCoachMoves(allChanges, ctx);
    const seenAdds = new Set<string>();
    const deduped = all.filter((m) => {
      if (m.change.type !== 'add') return true;
      const key = m.change.name.toLowerCase();
      if (seenAdds.has(key)) return false;
      seenAdds.add(key);
      return true;
    });
    return diversifyRankedMoves(deduped);
  }, [allChanges, ctx]);

  // ── Separate adds/swaps from cuts ────────────────────────────────────────

  // Release departed ids once the deck update has genuinely dropped their rows
  // from the data — after that the id is stale bookkeeping, and if the row ever
  // legitimately returns (the apply was undone), it must not stay hidden.
  // Render-phase adjustment (react.dev "storing information from previous renders"):
  // guarded setState during render, NOT an effect, so no stale frame commits.
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

  // ── The Cuts lane: each cut with its best replacement ────────────────────
  // Legacy order stays; the pairing adds the replacement (verdicts land in one batch).
  const cutChanges = useMemo(() => cuts.map((r) => r.change), [cuts]);
  const env = { resolveOwnership, settingsBreak };
  const cutPairing = useCutSwaps(cutChanges, cutSwaps, env, combosLoading);
  const cutsLoading = cutPairing.state.status === 'loading' && cuts.length > 0;
  const planJudge = usePlanJudge(cutSwaps, upgradePlan?.open === true, combosLoading);
  // A replacement the player hid counts as unavailable, like one already in the deck.
  const lane = useMemo(
    () =>
      cutLane(
        cuts,
        cutPairing.state,
        hidden.inNames.size ? new Set([...deckNames, ...hidden.inNames]) : deckNames
      ),
    [cuts, cutPairing.state, deckNames, hidden.inNames]
  );

  // ── Filter ───────────────────────────────────────────────────────────────

  const filteredRows = useMemo(() => {
    // Cuts are a pseudo-lane keyed on change.type, not change.lane (a cut's
    // lane is its source engine, e.g. bracket-fit). They stay out of "All" —
    // trimming is a different intent than improving — and `ownedOnly` never
    // applies: every cut is a card already in the deck.
    if (activeFilter === 'cuts') return cutsLoading ? [] : lane.rows;
    let list = addsAndSwaps;
    if (ownedOnly) {
      list = list.filter((r) => r.change.ownership === 'owned');
    }
    if (activeFilter !== 'all') {
      list = list.filter((r) => r.change.lane === activeFilter);
    }
    if (offMetaOnly) {
      list = list.filter((r) => isOffMetaChange(r.change));
    }
    return list;
  }, [addsAndSwaps, lane, cutsLoading, activeFilter, ownedOnly, offMetaOnly]);

  // E64: global off-meta count — independent of `activeFilter` (a lane
  // switch shouldn't make the differentiator's own count flicker), but
  // respecting `ownedOnly` like every other chip's "shown" number so it
  // never promises more spicy picks than are actually visible.
  const offMetaCount = useMemo(
    () =>
      addsAndSwaps.filter(
        (r) => (!ownedOnly || r.change.ownership === 'owned') && isOffMetaChange(r.change)
      ).length,
    [addsAndSwaps, ownedOnly]
  );

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
      decks: 0,
      'bracket-fit': 0,
      combos: 0,
      lands: 0,
      cuts: 0,
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
    // Cuts pseudo-lane: in-deck cards, so `ownedOnly` never hides them and
    // they don't count toward "All" (adds/swaps only).
    // While the pairing runs the chip shows no number (the lane is about to lose
    // the cuts that have no replacement); once it lands the number is the lane's.
    shown.cuts = total.cuts = cutsLoading ? cuts.length : lane.rows.length;
    return { shownCounts: shown, totalCounts: total };
  }, [addsAndSwaps, cuts, lane, cutsLoading, ownedOnly]);

  // Body empty purely because `ownedOnly` hid every match in this lane — drives
  // the context-aware empty state (explain + one-tap relax) rather than a bare
  // "nothing here", which reads as a dead-end.
  const hiddenByOwned = totalCounts[activeFilter] - shownCounts[activeFilter];
  const isOwnedEmpty = ownedOnly && filteredRows.length === 0 && hiddenByOwned > 0;

  // E64: same instinct as isOwnedEmpty — when the Off-meta toggle is what
  // emptied the current lane (rows exist here, just none of them off-meta),
  // name that specifically instead of a generic "no suggestions" dead end.
  // Checked only once ownedOnly's own explanation doesn't already apply.
  // Cuts never carry the toggle (filteredRows returns `cuts` before the
  // off-meta filter ever runs), so it can't be the reason a cuts view is empty.
  const isOffMetaEmpty = useMemo(() => {
    if (!offMetaOnly || filteredRows.length !== 0 || isOwnedEmpty || activeFilter === 'cuts') {
      return false;
    }
    return addsAndSwaps.some(
      (r) =>
        (!ownedOnly || r.change.ownership === 'owned') &&
        (activeFilter === 'all' || r.change.lane === activeFilter)
    );
  }, [offMetaOnly, filteredRows, isOwnedEmpty, activeFilter, addsAndSwaps, ownedOnly]);

  // ── `f` key cycle + suggestion labels ────────────────────────────────────
  const cyclableList = useMemo<FilterId[]>(
    () =>
      (Object.keys(FILTER_LABELS) as FilterId[]).filter((f) => f === 'all' || totalCounts[f] > 0),
    [totalCounts]
  );
  useFilterCycle(cyclableList, setActiveFilter);
  const labelRows = useMemo(() => filteredRows.map((r) => r.change), [filteredRows]);
  const labels = useCoachFeedLabels(activeFilter, labelRows, cutsLoading);
  const act = (c: Change) => {
    labels.accept(c);
    handleApplyWithLeave(c);
  };

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
    // A move carries no play-rate; it'd read "Off-meta" (see isOffMetaChange).
    label: change.lane === 'decks' ? 'From your decks' : classifyInclusion(change.inclusion).label,
  });
  const previewEntries = useMemo<CarouselEntry[]>(
    () =>
      // Nested owned-substitute alternatives are previewable too, so the carousel
      // can swipe to them from their row.
      [...addsAndSwaps, ...lane.rows].flatMap(({ change }) => [
        entryFor(change),
        ...(change.alternatives ?? []).map(entryFor),
      ]),
    [addsAndSwaps, lane]
  );

  // ── Skeleton / error / EDHREC-missing ───────────────────────────────────
  // A partial analysis (EDHREC unreachable) has `analysisState === 'ready'`
  // (a real bracket exists), but every lane here — gaps, optimize, cost,
  // synergy — is EDHREC-derived, so `allChanges` stays empty. Same
  // notice-with-retry shape as pending/error, reworded.
  const skeletonStatus: 'pending' | 'error' | 'edhrec-missing' | null =
    analysisState === 'pending'
      ? 'pending'
      : analysisState === 'error'
        ? 'error'
        : edhrecMissing
          ? 'edhrec-missing'
          : null;

  // E458: one row that opens the plan, and the plan itself. Both render in
  // the skeleton branch too, so a deep link opened while the analysis runs
  // shows the plan loading instead of nothing.
  const planEntry = upgradePlan && (
    <UpgradePlanEntry onOpen={() => upgradePlan.onOpenChange(true)} />
  );
  const tierById = new Map(ranked.map((r) => [r.change.id, r.tier]));
  const planSheet = upgradePlan?.open && upgradePlan.tools && (
    <UpgradePlanSheet
      deckId={upgradePlan.deckId}
      moves={ranked.filter((r) => r.change.type !== 'cut').map((r) => r.change)}
      tierOf={(c) => tierById.get(c.id) ?? 3}
      cuts={allChanges.filter((c) => c.type === 'cut')}
      roleCounts={roleCounts ?? {}}
      roleTargets={roleTargets ?? {}}
      openSlots={Math.max(0, deckTarget - deckSize)}
      tools={upgradePlan.tools}
      commanderName={commanderName}
      // The plan's bracket and judge read the combos too, so it waits for them.
      analysisState={combosLoading || planJudge.status === 'loading' ? 'pending' : analysisState}
      judge={planJudge.status === 'ready' ? planJudge.judge : undefined}
      edhrecMissing={edhrecMissing}
      onRetry={onRetryAnalysis}
      onApply={(steps, toCopy) => {
        labels.acceptPlan(steps);
        return upgradePlan.onApply(steps, toCopy);
      }}
      onClose={() => upgradePlan.onOpenChange(false)}
    />
  );

  if (skeletonStatus && allChanges.length === 0) {
    return (
      <div className="coach-feed">
        {planEntry}
        {planSheet}
        {(nextBestMoves.length > 0 || combosLoading) && (
          <NextBestMoveComponent
            moves={nextBestMoves}
            onNavigate={onNbmNavigate}
            onApply={onNbmApply}
            onFill={onNbmFill}
            busyNames={busy}
            combosLoading={combosLoading}
            currentView="tune"
          />
        )}
        <DeckAnalysisSkeleton status={skeletonStatus} onRetry={onRetryAnalysis} />
      </div>
    );
  }

  // ── Empty state (tuned deck, no changes at all) ───────────────────────────

  const isPending = analysisState === 'pending';

  // EDHREC theme browser — rendered right under the header when the feed has
  // rows (below the fold it was never discovered), or after the empty state.
  const browserSection = browser && (
    <details className="coach-feed-browser-section">
      <summary>
        <ChevronDown width={14} height={14} strokeWidth={1.8} aria-hidden />
        Browse all EDHREC suggestions
      </summary>
      <div className="coach-feed-browser">{browser}</div>
    </details>
  );

  // The plan sheet is portaled, but React events still bubble to this div,
  // and its rows peek on their own layer above the sheet. While it's open the
  // feed's peeks stand down, or both would fire (the feed's behind the modal).
  const feedPeekHandlers = upgradePlan?.open
    ? {}
    : { ...hoverPeek.listHandlers, ...touchPeek.listHandlers };

  return (
    <div className="coach-feed" {...feedPeekHandlers}>
      {planEntry}
      {planSheet}
      {/* Next best move headline — always at top when data is available */}
      {(nextBestMoves.length > 0 || combosLoading) && (
        <NextBestMoveComponent
          moves={nextBestMoves}
          onNavigate={onNbmNavigate}
          onApply={onNbmApply}
          onFill={onNbmFill}
          busyNames={busy}
          combosLoading={combosLoading}
          currentView="tune"
        />
      )}

      {/* The suggestions zone wears the same panel chrome + title vocabulary as
          every other analysis panel (NBM above, the AI panels below) — bare
          chips-and-rows on the bento read as an unstructured wall and left the
          tab's core content its only unlabeled region. */}
      <Surface
        as="section"
        variant="framed"
        className="deck-stats-panel deck-stats-panel--wide coach-feed-panel"
        aria-labelledby="coach-feed-panel-title"
      >
        <h4 id="coach-feed-panel-title" className="deck-stats-panel-title">
          Suggestions
        </h4>
        {!isPending && allChanges.length === 0 ? (
          hiddenBy.length > 0 ? (
            <EmptyState
              tagline="Nothing to coach within this deck's settings."
              hint={settingsEmptyHint(hiddenBy)}
            />
          ) : (
            <EmptyState
              tagline="Nothing to coach. This deck looks tuned."
              hint="Try another power bracket, or browse themes below."
            />
          )
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
                  if (f !== 'all' && total === 0 && !(f === 'cuts' && activeFilter === 'cuts')) {
                    return null;
                  }
                  const ownedEmpty = f !== 'all' && shown === 0 && total > 0;
                  return (
                    <Chip
                      key={f}
                      className={
                        'filter-chip' + (ownedEmpty ? ' coach-feed-filter-chip--owned-empty' : '')
                      }
                      pressed={activeFilter === f}
                      onClick={() => setActiveFilter(f)}
                      trailing={
                        shown > 0 &&
                        f !== 'all' &&
                        !(f === 'cuts' && cutsLoading) && (
                          <span className="coach-feed-chip-count">{shown}</span>
                        )
                      }
                    >
                      {FILTER_LABELS[f]}
                    </Chip>
                  );
                })}
                {/* E64: spicy-pick discoverability. A cross-lane toggle, not
                  another lane — off-meta rows can land in any lane above, so
                  this narrows whichever lane is active rather than competing
                  with it. Renders nothing when the deck has no off-meta
                  picks at all (insight-surface "zero visible → render
                  nothing" rule), same as every other zero-count chip here. */}
                {offMetaCount > 0 && (
                  <Chip
                    className="filter-chip"
                    pressed={offMetaOnly}
                    aria-label={`Off-meta picks, ${offMetaCount}. Spicy, low-EDHREC-play picks for this lane.`}
                    onClick={() => setOffMetaOnly((v) => !v)}
                    trailing={<span className="coach-feed-chip-count">{offMetaCount}</span>}
                  >
                    Off-meta
                  </Chip>
                )}
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
                <Button
                  variant="primary"
                  icon={<Check width={14} height={14} strokeWidth={1.8} />}
                  onClick={() => {
                    labels.acceptAll(dropInChanges.map((r) => r.change));
                    void onApplyAllDropIns(
                      dropInChanges
                        .filter((r) => r.change.inName)
                        .map((r) => ({
                          removeName: r.change.inName!,
                          addName: r.change.name,
                        }))
                    );
                  }}
                >
                  Apply all {dropInChanges.length} drop-in{dropInChanges.length > 1 ? 's' : ''}
                </Button>
              )}

              {/* Converge to target — bracket-fit filter, swap moves only */}
              {activeFilter === 'bracket-fit' && bracketSwaps.length > 0 && (
                <Button
                  variant="primary"
                  icon={<Check width={14} height={14} strokeWidth={1.8} />}
                  onClick={() => {
                    labels.acceptAll(bracketSwaps.map((r) => r.change));
                    void onConvergeBracket(
                      bracketSwaps.map((r) => ({
                        removeName: r.change.inName!,
                        addName: r.change.name,
                      }))
                    );
                  }}
                >
                  Apply all {bracketSwaps.length} swap{bracketSwaps.length > 1 ? 's' : ''}
                </Button>
              )}
            </div>

            {activeFilter === 'budget' && filteredRows.length > 0 && <BudgetConfidenceStrip />}
            {activeFilter === 'bracket-fit' && bracketFit && bracketFit.direction !== 'aligned' && (
              <BracketFitStrip plan={bracketFit} />
            )}

            {/* Stand-ins strip — collection filter only */}
            {activeFilter === 'collection' && filteredRows.length > 0 && (
              <div className="coach-feed-collection-strip">
                <span className="coach-feed-collection-summary">
                  Cards you already own that cover staples this deck is missing.
                </span>
              </div>
            )}

            {activeFilter === 'cuts' && (
              <CutsLaneStatus
                lane={lane}
                loading={cutsLoading}
                rows={filteredRows.length}
                onRetry={cutPairing.retry}
              />
            )}

            {/* Feed rows — first page only until "Show all" is pressed. */}
            {/* Column names for the table layout (CoachFeed.css shows them
                from a 48rem feed); the list itself stays a list. */}
            {filteredRows.length > 0 && !cutsLoading && (
              <div className="coach-feed-rows-head" aria-hidden>
                <span>Card</span>
                <span>Why</span>
                <span>Played in</span>
              </div>
            )}
            {filteredRows.length > 0 && (
              <ul className="coach-feed-rows" aria-label="Deck suggestions">
                {(showAllRows ? filteredRows : filteredRows.slice(0, ROW_CAP)).map(({ change }) => {
                  const isLeaving = leavingIds.has(change.id);
                  // A move row's apply carries the donor's patch; the Fit audition
                  // adds through the plain path, so it would leave that out.
                  const paired = isPairedCut(change);
                  const showFit =
                    onPreviewFit && change.type !== 'cut' && change.lane !== 'decks' && !paired;
                  const aiWhy =
                    change.type === 'cut' || paired ? undefined : aiAgrees?.get(change.name);
                  return (
                    <li
                      key={change.id}
                      className={isLeaving ? 'coach-feed-row-leaving' : undefined}
                      onAnimationEnd={
                        isLeaving ? (e) => handleLeavingAnimationEnd(change.id, e) : undefined
                      }
                    >
                      <DeckCardRow
                        as="div"
                        change={aiWhy ? { ...change, aiWhy } : change}
                        commanderName={commanderShort}
                        peekName={change.name}
                        artThumb
                        onPreview={() => carousel.open(previewEntries, change.name)}
                        onPreviewOut={(c) =>
                          // The card being cut opens as a two-card trade: cut → incoming,
                          // so a swipe compares exactly what the swap exchanges.
                          carousel.open(
                            [{ name: c.inName!, label: `Cut for ${c.name}` }, entryFor(c)],
                            c.inName!
                          )
                        }
                        onAct={act}
                        onDismiss={hidden.canDismiss ? labels.dismiss : undefined}
                        actLabel={change.lane === 'decks' ? 'Move in' : undefined}
                        acting={
                          busy.has(change.name) || (change.inName ? busy.has(change.inName) : false)
                        }
                        secondaryAction={
                          showFit
                            ? {
                                label: 'Fit & cut',
                                ariaLabel: `Will ${change.name} fit this deck, and what would it replace?`,
                                onClick: () => onPreviewFit(change),
                              }
                            : undefined
                        }
                      />
                      {change.alternatives && change.alternatives.length > 0 && (
                        <SubstituteOptions
                          alternatives={change.alternatives}
                          commanderName={commanderShort}
                          onPreview={(name) => carousel.open(previewEntries, name)}
                          onAct={act}
                          acting={(name) => busy.has(name)}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {filteredRows.length > ROW_CAP && (
              <button
                type="button"
                className="coach-feed-show-all"
                aria-expanded={showAllRows}
                onClick={() => setShowAllRows((v) => !v)}
              >
                <ChevronDown width={14} height={14} strokeWidth={1.8} aria-hidden />
                {showAllRows
                  ? 'Show fewer'
                  : `Show all ${filteredRows.length} suggestion${filteredRows.length === 1 ? '' : 's'}`}
              </button>
            )}
            {filteredRows.length === 0 &&
              !isPending &&
              !cutsLoading &&
              !(activeFilter === 'cuts' && lane.withheld > 0) &&
              (isOwnedEmpty ? (
                <div className="coach-feed-empty-filter coach-feed-empty-owned">
                  <p>
                    {hiddenByOwned === 1 ? 'The only' : `All ${hiddenByOwned}`}{' '}
                    {activeFilter === 'all' ? '' : FILTER_LABELS[activeFilter] + ' '}
                    suggestion{hiddenByOwned === 1 ? ' is a card' : 's are cards'} you don't own
                    yet.
                  </p>
                  <Button variant="link" onClick={() => onOwnedOnlyChange(false)}>
                    Show unowned too
                  </Button>
                </div>
              ) : isOffMetaEmpty ? (
                <div className="coach-feed-empty-filter coach-feed-empty-owned">
                  <p>
                    No off-meta {activeFilter === 'all' ? '' : FILTER_LABELS[activeFilter] + ' '}
                    picks right now. This lane's suggestions are all played staples.
                  </p>
                  <Button variant="link" onClick={() => setOffMetaOnly(false)}>
                    Show all suggestions
                  </Button>
                </div>
              ) : (
                <p className="coach-feed-empty-filter">
                  No {activeFilter === 'all' ? '' : FILTER_LABELS[activeFilter] + ' '}suggestions
                  right now.
                </p>
              ))}

            {/* Aligned bracket state */}
            {activeFilter === 'bracket-fit' && bracketFit?.direction === 'aligned' && (
              <div className="coach-feed-bracket-aligned">
                <VerdictBadge tone="success" label="Aligned" />
              </div>
            )}
          </>
        )}
      </Surface>

      {/* EDHREC theme browser — the catalog sits AFTER the curated feed. It
          used to sit between the filter chips and the rows they filter, where
          its all-caps summary read as a heading for the feed below it. The
          bounded first page above keeps it discoverable near the fold. */}
      <HiddenSuggestions />

      {browserSection}

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

      {/* Touch long-press peek (E129) — unlike the hover peek above, renders
          as soon as the gesture fires (not gated on the art already being
          resolved): `variant="touch"` shows a loading shimmer / "no art"
          fallback itself instead of nothing, since a deliberate hold
          deserves visible feedback. */}
      {touchPeek.peek &&
        createPortal(
          <DeckHoverPeek
            variant="touch"
            imageUrl={touchPeekUrl}
            left={touchPeek.peek.left}
            top={touchPeek.peek.top}
            width={touchPeek.peek.width}
          />,
          document.body
        )}

      {/* Card carousel — tap-to-preview on touch */}
      {carousel.preview}
    </div>
  );
}
