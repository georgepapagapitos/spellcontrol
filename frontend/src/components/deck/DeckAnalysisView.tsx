// Full-width analysis views (Stats / Power / Tune tabs) rendered atop the
// deck card list. Split out of DeckDisplay.tsx purely to shrink the file —
// no logic changes.
import { useMemo } from 'react';
import type { ScryfallCard, Archetype } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import type { LaneId } from '@/lib/deck-change';
import { usePanelCascade, panelCascadeClass } from '@/lib/use-panel-cascade';
import {
  bracketLabel,
  type BracketEstimation,
} from '@/deck-builder/services/deckBuilder/bracketEstimator';
import type { PlanScore } from '@/deck-builder/services/deckBuilder/planScore';
import { computeRoleCounts } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import { computeRoleDensity } from '@/deck-builder/services/deckBuilder/roleDensity';
import type { ValidationResult } from '@/deck-builder/services/deckBuilder/validationChecklist';
import type { BuildReport } from '@/deck-builder/types';
import { MeterBar } from '../shared/MeterBar';
import { BuildReportPanel } from './BuildReportPanel';
import { BracketBreakdown } from './BracketBreakdown';
import { BracketVerdictStrip } from './BracketVerdictStrip';
import { DeckAnalysisSkeleton } from './DeckAnalysisSkeleton';
import { DeckColorPanel } from './DeckColorPanel';
import { DeckCurvePhases } from './DeckCurvePhases';
import { DeckTypeBreakdown } from './DeckTypeBreakdown';
import { SaltiestPanel } from './SaltiestPanel';
import { DeckIdentityCard } from './DeckIdentityCard';
import { type DeckManaData } from './deck-mana-types';
import type { AnalysisTabId } from './DeckDisplay';

/** Renders a single analysis view's content full-width (no header / tabs /
 *  collapse — the hub tab bar in the page does the switching). */
export function DeckAnalysisView({
  view,
  allCards,
  manaData,
  bracketEstimation,
  deckCardsByName,
  bracketOverride,
  onSetBracketOverride,
  archetypeOverride,
  onSetArchetypeOverride,
  roleCounts,
  roleTargets,
  buildReport,
  rampSubtypeCounts,
  removalSubtypeCounts,
  boardwipeSubtypeCounts,
  cardDrawSubtypeCounts,
  averageSalt,
  saltiestCards,
  planScore,
  edhrecNumDecks,
  combosSlot,
  coachFeedSlot,
  engineSlot,
  winConditionSlot,
  powerHeroSlot,
  tableRecordSlot,
  aiReviewSlot,
  analysisState = 'ready',
  onNavigateToTune,
  onRetryAnalysis,
  commander,
  partnerCommander,
  deckName,
  format,
  deckColor,
  identity,
  scoreRevealKey,
  onAddSuggestedCard,
  addingSuggestedCardNames,
  oneAwayCombos,
  ownedOracleIds,
  landUpgradeCount,
  derivedRoles,
  validation,
}: {
  view: AnalysisTabId;
  allCards: ScryfallCard[];
  manaData: DeckManaData;
  bracketEstimation?: BracketEstimation;
  deckCardsByName?: ReadonlyMap<string, ScryfallCard>;
  bracketOverride?: 1 | 2 | 3 | 4 | 5 | null;
  onSetBracketOverride?: (bracket: 1 | 2 | 3 | 4 | 5 | null) => void;
  archetypeOverride?: Archetype | null;
  onSetArchetypeOverride?: (archetype: Archetype | null) => void;
  roleCounts?: Record<string, number>;
  roleTargets?: Record<string, number>;
  buildReport?: BuildReport;
  rampSubtypeCounts?: Record<string, number>;
  removalSubtypeCounts?: Record<string, number>;
  boardwipeSubtypeCounts?: Record<string, number>;
  cardDrawSubtypeCounts?: Record<string, number>;
  averageSalt?: number;
  saltiestCards?: Array<{ name: string; salt: number }>;
  planScore?: PlanScore;
  /** EDHREC's own sample size for this commander (its `numDecks`); feeds
   *  CommanderPopularityStat (social W4) in DeckIdentityCard. */
  edhrecNumDecks?: number | null;
  /** Folded-in panels from the page (own their data fetching). */
  combosSlot?: React.ReactNode;
  /** CoachFeed slot — replaces improveSlot/nextBestMoveSlot/costSlot/bracketFitSlot. */
  coachFeedSlot?: React.ReactNode;
  engineSlot?: React.ReactNode;
  winConditionSlot?: React.ReactNode;
  powerHeroSlot?: React.ReactNode;
  tableRecordSlot?: React.ReactNode;
  /** Opt-in AI review (T96) — brings its own panel chrome + hidden states. */
  aiReviewSlot?: React.ReactNode;
  /** The deck's legal color identity (commander union); drives the identity gate. */
  /** UX-310: 'pending' shows skeleton placeholders on Tune/Power while analysis loads.
   *  E162: 'error' shows a failure message + retry instead of skeletoning forever. */
  analysisState?: 'pending' | 'ready' | 'error';
  /** UX-311: deep-link from a DeckIdentityCard shortfall to the Tune lane that fixes it. */
  onNavigateToTune?: (lane: LaneId) => void;
  /** E162: retries a failed/stalled first analysis. */
  onRetryAnalysis?: () => void;
  /** Stronger owned lands found for this deck → the Mana base "Re-analyze lands" CTA. */
  landUpgradeCount?: number;
  /** Session-scoped reveal key for score animations. Null/undefined suppresses the reveal. */
  scoreRevealKey?: string | null;
  /** Commander card for DeckIdentityCard art + arc. */
  commander?: ScryfallCard | null;
  /** Partner commander card for DeckIdentityCard arc. */
  partnerCommander?: ScryfallCard | null;
  /** Deck name for DeckIdentityCard header. */
  deckName: string;
  /** Deck format label for DeckIdentityCard. */
  format: string;
  /** Deck color hex for DeckIdentityCard no-commander banner. */
  deckColor: string;
  /** Live-computed deck identity for DeckIdentityCard. */
  identity: import('@/deck-builder/services/deckBuilder/deckIdentity').DeckIdentity | null;
  /** One-tap add on a Build Report suggestion row. Omitted → rows stay read-only. */
  onAddSuggestedCard?: (cardName: string) => void;
  /** Card names with an add in flight from a Build Report row. */
  addingSuggestedCardNames?: ReadonlySet<string>;
  /** Live Spellbook one-away combos for the Build Report section (E78-P4). */
  oneAwayCombos?: ComboMatch[];
  /** Owned oracle ids — ranks owned-missing-piece combos first. */
  ownedOracleIds?: ReadonlySet<string>;
  /** Tagger-derived role counts for manual decks; null when the deck passed its own. */
  derivedRoles: ReturnType<typeof computeRoleCounts> | null;
  /** Deck-health checklist — computed once in DeckDisplay so the tab badge can't drift. */
  validation: ValidationResult;
}) {
  // Overlapping multi-role counts (a card counts toward every role it fills),
  // always derived from the live card list — complements the primary-role bars.
  const roleDensity = useMemo(() => computeRoleDensity(allCards), [allCards]);

  // Lower-cased in-deck names for the Build Report's "+ Add" gate (never
  // re-propose a card already in the deck — mirrors DeckEditorPage's
  // deckCardNames memo used by the Coach feed).
  const buildReportDeckNames = useMemo(
    () => new Set(allCards.map((c) => c.name.toLowerCase())),
    [allCards]
  );

  const effectiveRoleCounts = roleCounts ?? derivedRoles?.roleCounts;
  const effectiveRampSub = rampSubtypeCounts ?? derivedRoles?.rampSubtypeCounts;
  const effectiveRemovalSub = removalSubtypeCounts ?? derivedRoles?.removalSubtypeCounts;
  const effectiveBoardwipeSub = boardwipeSubtypeCounts ?? derivedRoles?.boardwipeSubtypeCounts;
  const effectiveDrawSub = cardDrawSubtypeCounts ?? derivedRoles?.cardDrawSubtypeCounts;
  const showRoles = effectiveRoleCounts !== undefined;

  const effectiveBracketValue = bracketOverride ?? bracketEstimation?.bracket;
  const bracketOverridden = bracketOverride != null;
  // The parent `.deck-display` is the tabpanel for the active view; this just
  // renders the view's content. `current` aliases `view` so the per-view blocks
  // below stay untouched.
  const current = view;

  // Panel cascade: staggered entrance when analysis first becomes ready.
  // Keyed to scoreRevealKey so it fires once per analysis delivery (same registry
  // as the score number reveals — remounts and tab switches don't replay).
  const cascade = usePanelCascade(scoreRevealKey ? `${scoreRevealKey}:cascade` : null);

  return (
    <div className="deck-analysis-view">
      {current === 'stats' && (
        <div className="deck-bento deck-bento--stats">
          {/* Deck identity hero — leads the stats tab with the deck's visual identity,
              functional verdict, and build health. Renders always (no checks guard).
              deck-analysis-slot spans the hero across the 2-col board (E158) —
              this cascade wrapper is the grid item, so DeckIdentityCard's own
              grid-column rule can't reach the board from one level down. */}
          <div
            className={`deck-analysis-slot ${panelCascadeClass(0, cascade.animating) ?? ''}`.trim()}
          >
            <DeckIdentityCard
              commander={commander ?? null}
              partnerCommander={partnerCommander}
              deckName={deckName}
              format={format}
              deckColor={deckColor}
              bracket={effectiveBracketValue}
              analysisState={analysisState}
              onRetryAnalysis={onRetryAnalysis}
              validation={validation}
              planScore={planScore ?? null}
              edhrecNumDecks={edhrecNumDecks ?? null}
              manaCurve={manaData.manaCurve}
              identity={identity}
              archetypeOverride={archetypeOverride}
              onSetArchetypeOverride={onSetArchetypeOverride}
              averageCmc={manaData.averageCmc}
              onNavigate={onNavigateToTune}
              cards={allCards}
              revealKey={scoreRevealKey}
            />
          </div>
          {/* Mana curve — full-width so the stacked curve reads well. */}
          <Panel title="Mana curve" wide className={panelCascadeClass(1, cascade.animating)}>
            <DeckCurvePhases
              manaCurve={manaData.manaCurve}
              curveByColor={manaData.curveByColor}
              averageCmc={manaData.averageCmc}
              cardsByCmc={manaData.cardsByCmc}
            />
          </Panel>
          {/* Color + Types — a compact pair (lone survivor spans full width). */}
          <div
            className={`deck-stats-pair${panelCascadeClass(2, cascade.animating) ? ` ${panelCascadeClass(2, cascade.animating)}` : ''}`}
          >
            <Panel title="Color">
              <DeckColorPanel
                colorDist={manaData.colorDist}
                manaProduction={manaData.manaProduction}
                cardsByColor={manaData.cardsByColor}
                manaCurve={manaData.manaCurve}
                landUpgradeCount={landUpgradeCount}
                onReanalyzeLands={onNavigateToTune ? () => onNavigateToTune('lands') : undefined}
              />
            </Panel>
            <Panel title="Types">
              <DeckTypeBreakdown
                typeCounts={manaData.typeBreakdown}
                cardsByType={manaData.cardsByType}
              />
            </Panel>
          </div>
          {/* Saltiest — lone, spans full width. */}
          <div
            className={`deck-stats-pair${panelCascadeClass(3, cascade.animating) ? ` ${panelCascadeClass(3, cascade.animating)}` : ''}`}
          >
            {saltiestCards && saltiestCards.length > 0 && (
              <Panel title="Saltiest cards">
                <SaltiestPanel cards={saltiestCards} averageSalt={averageSalt} />
              </Panel>
            )}
          </div>
          {/* Table record — this deck's real tracked W/L, full width. Always
              rendered (owns its own empty state for zero tracked games). */}
          {tableRecordSlot && (
            <Panel title="Table record" wide>
              {tableRecordSlot}
            </Panel>
          )}
          {/* Build report — full width, list-heavy. */}
          {buildReport && (
            <Panel title="Build report" wide className={panelCascadeClass(4, cascade.animating)}>
              <BuildReportPanel
                report={buildReport}
                onFixGaps={onNavigateToTune ? () => onNavigateToTune('fill-gaps') : undefined}
                onAddCard={onAddSuggestedCard}
                deckCardNames={buildReportDeckNames}
                addingCardNames={addingSuggestedCardNames}
                oneAwayCombos={oneAwayCombos}
                ownedOracleIds={ownedOracleIds}
              />
            </Panel>
          )}
        </div>
      )}

      {current === 'power' && (
        <div className="deck-bento deck-bento--power">
          {/* UX-310/E162: shimmer or failure+retry while the async analysis
              hasn't delivered anything yet. Only shown when analysis hasn't
              delivered a hero or any panel yet — an incomplete result (e.g.
              bracket landed but engine hasn't) still has real content to show. */}
          {(analysisState === 'pending' || analysisState === 'error') &&
            !powerHeroSlot &&
            !bracketEstimation &&
            !engineSlot && (
              <DeckAnalysisSkeleton status={analysisState} onRetry={onRetryAnalysis} />
            )}
          {powerHeroSlot}
          {/* Detailed breakdowns under the verdict hero. */}
          {/* Bracket + Roles — a compact pair (lone survivor spans full width). */}
          <div className="deck-stats-pair">
            {(bracketEstimation || bracketOverride != null) && (
              <Panel id="deck-power-bracket" title="Bracket">
                <div className="deck-stats-bracket">
                  <strong>
                    Bracket {effectiveBracketValue} —{' '}
                    {effectiveBracketValue != null ? bracketLabel(effectiveBracketValue) : '—'}
                    {bracketOverridden && <span className="deck-stats-bracket-tag"> manual</span>}
                  </strong>
                  <BracketVerdictStrip
                    target={bracketOverride}
                    detected={bracketEstimation?.bracket}
                  />
                  {/* Detected vs target now lives in the strip above; keep the
                      top hard-floor reason as context when on Auto. */}
                  {!bracketOverridden &&
                    bracketEstimation &&
                    bracketEstimation.hardFloors.length > 0 && (
                      <span className="deck-stats-bracket-note">
                        {bracketEstimation.hardFloors[0].reason}
                      </span>
                    )}
                  {/* UX-313: the target-bracket control moved to the PowerHero above
                      (the "Target: N ▾" SelectMenu). Keeping just a small note here
                      when a manual override is active so the Bracket panel stays
                      self-explaining without re-providing a redundant control. */}
                  {bracketOverridden && (
                    <p className="deck-stats-bracket-override-note">
                      Target set in Power level above.{' '}
                      {onSetBracketOverride && (
                        <button
                          type="button"
                          className="deck-stats-bracket-clear-btn"
                          onClick={() => onSetBracketOverride(null)}
                        >
                          Clear target
                        </button>
                      )}
                    </p>
                  )}
                  {bracketEstimation && (
                    <BracketBreakdown
                      estimation={bracketEstimation}
                      deckCardsByName={deckCardsByName}
                    />
                  )}
                </div>
              </Panel>
            )}
            {showRoles && (
              <Panel title="Roles">
                <RolesPanel
                  roleCounts={effectiveRoleCounts}
                  roleTargets={roleTargets}
                  density={roleDensity}
                  rampSubtypeCounts={effectiveRampSub}
                  removalSubtypeCounts={effectiveRemovalSub}
                  boardwipeSubtypeCounts={effectiveBoardwipeSub}
                  cardDrawSubtypeCounts={effectiveDrawSub}
                />
              </Panel>
            )}
          </div>
          {/* Engine — the synergy engine (lone, spans full width). */}
          {engineSlot && (
            <div className="deck-stats-pair">
              <Panel id="deck-power-engine" title="Engine">
                {engineSlot}
              </Panel>
            </div>
          )}
          {/* Win conditions — how the deck wins (lone, spans full width). */}
          {winConditionSlot && (
            <div className="deck-stats-pair">
              <Panel id="deck-power-wincon" title="Win conditions">
                {winConditionSlot}
              </Panel>
            </div>
          )}
          {/* Combos — full width (its own multi-column grid inside). */}
          {combosSlot && (
            <Panel title="Combos" wide>
              {combosSlot}
            </Panel>
          )}
        </div>
      )}

      {current === 'tune' && (
        <div className="deck-bento deck-bento--tune">
          {(analysisState === 'pending' || analysisState === 'error') && !coachFeedSlot && (
            <DeckAnalysisSkeleton status={analysisState} onRetry={onRetryAnalysis} />
          )}
          {coachFeedSlot}
          {/* AI review (T96 → T102) — the reading belongs with the coach, not
              the statistics. Additive: the slot brings its own panel chrome and
              renders nothing when the feature is unavailable, so no Panel
              wrapper here, and it sits below the coach's own suggestions. */}
          {aiReviewSlot}
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  children,
  wide,
  id,
  className,
}: {
  title: string;
  children: React.ReactNode;
  /** Span the full surface width (for list-heavy panels whose items lay out in
   *  their own multi-column grid, e.g. Cards to consider). */
  wide?: boolean;
  /** Stable id so the Power hero's summary lines can scroll to this panel. */
  id?: string;
  /** Additional CSS classes (e.g. cascade animation classes). */
  className?: string;
}) {
  const cls = ['deck-stats-panel', wide ? 'deck-stats-panel--wide' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <div id={id} className={cls}>
      <h4 className="deck-stats-panel-title">{title}</h4>
      {children}
    </div>
  );
}

function RolesPanel({
  roleCounts,
  roleTargets,
  density,
  rampSubtypeCounts,
  removalSubtypeCounts,
  boardwipeSubtypeCounts,
  cardDrawSubtypeCounts,
}: {
  roleCounts?: Record<string, number>;
  roleTargets?: Record<string, number>;
  /** Overlapping multi-role counts (a card counts in every role it fills). */
  density?: Record<string, number>;
  rampSubtypeCounts?: Record<string, number>;
  removalSubtypeCounts?: Record<string, number>;
  boardwipeSubtypeCounts?: Record<string, number>;
  cardDrawSubtypeCounts?: Record<string, number>;
}) {
  const ramp = roleCounts?.ramp ?? 0;
  const removal = roleCounts?.singleRemoval ?? roleCounts?.removal ?? 0;
  const wipes = roleCounts?.boardWipes ?? roleCounts?.boardwipe ?? 0;
  const draw = roleCounts?.cardDraw ?? roleCounts?.cardAdvantage ?? 0;

  // Targets share the canonical role keys with roleCounts; tolerate either casing.
  const rampWant = roleTargets?.ramp;
  const removalWant = roleTargets?.singleRemoval ?? roleTargets?.removal;
  const wipesWant = roleTargets?.boardWipes ?? roleTargets?.boardwipe;
  const drawWant = roleTargets?.cardDraw ?? roleTargets?.cardAdvantage;

  const subSummary = (counts: Record<string, number> | undefined): string => {
    if (!counts) return '';
    const entries = Object.entries(counts).filter(([, v]) => v > 0);
    return entries.map(([k, v]) => `${v} ${k}`).join(' · ');
  };

  // Density one-liner: how many cards fill each role counting overlaps, busiest
  // first. Totals exceed the deck size because a card can do several jobs.
  const densityLabels: Record<string, string> = {
    cardDraw: 'Draw',
    ramp: 'Ramp',
    removal: 'Removal',
    boardwipe: 'Wipes',
  };
  const densityEntries = density
    ? Object.entries(density)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
    : [];

  const items = [
    {
      label: 'Ramp',
      value: ramp,
      want: rampWant,
      sub: subSummary(rampSubtypeCounts),
      color: 'var(--accent)',
    },
    {
      label: 'Removal',
      value: removal,
      want: removalWant,
      sub: subSummary(removalSubtypeCounts),
      color: '#d8442a',
    },
    {
      label: 'Board wipes',
      value: wipes,
      want: wipesWant,
      sub: subSummary(boardwipeSubtypeCounts),
      color: '#d4a838',
    },
    {
      label: 'Card draw',
      value: draw,
      want: drawWant,
      sub: subSummary(cardDrawSubtypeCounts),
      color: '#3a85cc',
    },
  ];

  const max = Math.max(1, ...items.map((it) => Math.max(it.value, it.want ?? 0)));

  return (
    <>
      {densityEntries.length > 0 && (
        <div className="deck-roles-density">
          <span className="deck-roles-density-line">
            {densityEntries.map(([k, v]) => `${v} ${densityLabels[k] ?? k}`).join(' · ')}
          </span>
          <span className="deck-roles-density-note">cards fill multiple roles</span>
        </div>
      )}
      <ul className="deck-roles">
        {items.map((it) => {
          const hasTarget = typeof it.want === 'number';
          const short = hasTarget && it.value < (it.want as number);
          return (
            <li key={it.label}>
              <div className="deck-roles-row">
                <span className="deck-roles-name">{it.label}</span>
                <span className="deck-roles-count">
                  {hasTarget ? (
                    <span className={short ? 'deck-roles-count-short' : undefined}>
                      {it.value}/{it.want}
                      {short && (
                        <span
                          title={`${(it.want as number) - it.value} short of target`}
                          aria-label="below target"
                        >
                          {' '}
                          ▾
                        </span>
                      )}
                    </span>
                  ) : (
                    it.value
                  )}
                </span>
              </div>
              <MeterBar className="deck-roles-bar" value={it.value} max={max} color={it.color} />
              {it.sub && <div className="deck-roles-sub">{it.sub}</div>}
            </li>
          );
        })}
      </ul>
    </>
  );
}
