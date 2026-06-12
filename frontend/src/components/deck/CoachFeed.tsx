import './CoachFeed.css';
import { type JSX, useMemo, useState, useEffect, useRef, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { DeckCardRow } from './DeckCardRow';
import { DeckHoverPeek } from './DeckHoverPeek';
import { NextBestMove as NextBestMoveComponent } from './NextBestMove';
import { VerdictBadge } from './VerdictBadge';
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
  collection: 'My collection',
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

const OWNED_ONLY_KEY = 'spellcontrol-improve-owned-only';

function readOwnedOnly(): boolean {
  try {
    return window.localStorage.getItem(OWNED_ONLY_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOwnedOnly(v: boolean): void {
  try {
    window.localStorage.setItem(OWNED_ONLY_KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable — non-fatal */
  }
}

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
  // Apply dispatch
  onApplyMove: (change: Change) => void | Promise<void>;
  onApplyAllDropIns: (
    swaps: Array<{ removeName: string; addName: string }>
  ) => void | Promise<void>;
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
  onApplyMove,
  onApplyAllDropIns,
  initialFilter,
  onFilterHandled,
  analysisState = 'ready',
  commanderName,
  browser,
  busyNames,
  nextBestMoves = [],
  combosLoading,
  onNbmNavigate,
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
  const [ownedOnly, setOwnedOnly] = useState<boolean>(readOwnedOnly);

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

    return [...mergedAdds, ...bracketAdds, ...comboChanges, ...swapsAndCuts];
  }, [gaps, optimize, synergy, substitutes, costPlan, bracketFit, oneAwayCombos, resolveOwnership]);

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

  const addsAndSwaps = useMemo(() => ranked.filter((r) => r.change.type !== 'cut'), [ranked]);
  const cuts = useMemo(() => ranked.filter((r) => r.change.type === 'cut'), [ranked]);

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

  const filterCounts = useMemo(() => {
    const counts: Record<FilterId, number> = {
      all: addsAndSwaps.length,
      'fill-gaps': 0,
      upgrade: 0,
      budget: 0,
      collection: 0,
      'bracket-fit': 0,
      combos: 0,
    };
    for (const r of addsAndSwaps) {
      const lane = r.change.lane as FilterId;
      if (lane in counts) counts[lane]++;
    }
    return counts;
  }, [addsAndSwaps]);

  // ── Drop-in budget changes for "Apply all" ───────────────────────────────

  const dropInChanges = useMemo(
    () =>
      addsAndSwaps.filter(
        (r) => r.change.lane === 'budget' && r.change.confidence === 'drop-in' && r.change.inName
      ),
    [addsAndSwaps]
  );

  // ── Carousel entries (all previewable changes for swipe support) ─────────

  const previewEntries = useMemo<CarouselEntry[]>(
    () =>
      [...addsAndSwaps, ...cuts].map(({ change }) => ({
        name: change.name,
        label:
          typeof change.inclusion === 'number'
            ? `In ${Math.round(change.inclusion)}% of decks`
            : 'Suggested',
      })),
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
                const count = filterCounts[f];
                if (f !== 'all' && count === 0) return null;
                return (
                  <button
                    key={f}
                    type="button"
                    className="coach-feed-filter-chip"
                    aria-pressed={activeFilter === f}
                    onClick={() => setActiveFilter(f)}
                  >
                    {FILTER_LABELS[f]}
                    {count > 0 && f !== 'all' && (
                      <span className="coach-feed-chip-count">{count}</span>
                    )}
                  </button>
                );
              })}
              <label className="coach-feed-owned-toggle">
                <input
                  type="checkbox"
                  className="field-checkbox"
                  checked={ownedOnly}
                  onChange={(e) => {
                    setOwnedOnly(e.target.checked);
                    writeOwnedOnly(e.target.checked);
                  }}
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
          </div>

          {/* Bracket strip — bracket-fit filter only */}
          {activeFilter === 'bracket-fit' && bracketFit && bracketFit.direction !== 'aligned' && (
            <div className="coach-feed-bracket-strip">
              <span className="coach-feed-bracket-summary">{bracketFit.summary}</span>
              {bracketFit.note && (
                <span className="coach-feed-bracket-note">{bracketFit.note}</span>
              )}
            </div>
          )}

          {/* Feed rows */}
          {filteredAdds.length > 0 ? (
            <ul className="coach-feed-rows">
              {filteredAdds.map(({ change }) => (
                <li key={change.id}>
                  <DeckCardRow
                    change={change}
                    commanderName={commanderName}
                    peekName={change.name}
                    onPreview={() => carousel.open(previewEntries, change.name)}
                    onAct={(c) => void onApplyMove(c)}
                    acting={
                      busy.has(change.name) || (change.inName ? busy.has(change.inName) : false)
                    }
                  />
                </li>
              ))}
            </ul>
          ) : (
            !isPending && (
              <p className="coach-feed-empty-filter">
                No {activeFilter === 'all' ? '' : FILTER_LABELS[activeFilter] + ' '}suggestions
                right now.
              </p>
            )
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
                {cuts.map(({ change }) => (
                  <li key={change.id}>
                    <DeckCardRow
                      change={change}
                      commanderName={commanderName}
                      peekName={change.name}
                      onPreview={() => carousel.open(previewEntries, change.name)}
                      onAct={(c) => void onApplyMove(c)}
                      acting={busy.has(change.name)}
                    />
                  </li>
                ))}
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

      {/* Desktop hover-peek — floats card art beside the pointer */}
      {hoverPeek.peek && peekUrl && (
        <DeckHoverPeek
          imageUrl={peekUrl}
          left={hoverPeek.peek.left}
          top={hoverPeek.peek.top}
          width={hoverPeek.peek.width}
        />
      )}

      {/* Card carousel — tap-to-preview on touch */}
      {carousel.preview}
    </div>
  );
}
