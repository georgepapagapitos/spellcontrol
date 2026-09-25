// Full-width analysis views (Stats / Power / Tune tabs) rendered atop the
// deck card list. Split out of DeckDisplay.tsx purely to shrink the file —
// no logic changes.
import { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ScryfallCard, Archetype } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import type { LaneId } from '@/lib/deck-change';
import { usePanelCascade, panelCascadeClass } from '@/lib/use-panel-cascade';
import {
  bracketSource,
  type BracketEstimation,
} from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { bracketSourceSentence } from '@/lib/format-bracket-label';
import type { PlanScore } from '@/deck-builder/services/deckBuilder/planScore';
import { ROLE_TITLES } from '@/lib/role-badges';
import { ARCHETYPE_LABEL } from '@/deck-builder/services/deckBuilder/strategyVocabulary';
import type { ValidationResult } from '@/deck-builder/services/deckBuilder/validationChecklist';
import type { BuildReport } from '@/deck-builder/types';
import { MeterBar } from '../shared/MeterBar';
import { BuildReportPanel } from './BuildReportPanel';
import { BracketBreakdown } from './BracketBreakdown';
import type { ClockCard } from '@/lib/opening-hand-sim';
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
  illegalCardNames = [],
  formatLabel = 'Commander',
  bracketOverride,
  bracketMissesCombos,
  onSetBracketOverride,
  clockLibrary,
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
  edhrecMissing = false,
  commander,
  partnerCommander,
  format,
  identity,
  scoreRevealKey,
  onAddSuggestedCard,
  addingSuggestedCardNames,
  oneAwayCombos,
  ownedOracleIds,
  landUpgradeCount,
  validation,
}: {
  view: AnalysisTabId;
  allCards: ScryfallCard[];
  manaData: DeckManaData;
  bracketEstimation?: BracketEstimation;
  deckCardsByName?: ReadonlyMap<string, ScryfallCard>;
  /** Cards not legal in the format (banned included). A bracket describes a
   *  legal deck, so the Bracket panel says these come first. */
  illegalCardNames?: string[];
  /** The format's display name, for that note ("Commander"). */
  formatLabel?: string;
  bracketOverride?: 1 | 2 | 3 | 4 | 5 | null;
  /** The estimate was made before the combo match answered, so it is a floor
   *  (combos only raise a bracket). See useCommanderBracketAnalysis. */
  bracketMissesCombos?: boolean;
  onSetBracketOverride?: (bracket: 1 | 2 | 3 | 4 | 5 | null) => void;
  /** Mainboard, one entry per copy: lets the Bracket judgment quote the combo clock. */
  clockLibrary?: readonly ClockCard[];
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
  /** The persisted analysis was computed without EDHREC — grade/plan score
   *  are absent even though `analysisState` is 'ready'. */
  edhrecMissing?: boolean;
  /** Stronger owned lands found for this deck → the Mana base "Re-analyze lands" CTA. */
  landUpgradeCount?: number;
  /** Session-scoped reveal key for score animations. Null/undefined suppresses the reveal. */
  scoreRevealKey?: string | null;
  /** Commander card, for DeckIdentityCard's commander popularity. */
  commander?: ScryfallCard | null;
  /** Partner commander card, for the same commander key. */
  partnerCommander?: ScryfallCard | null;
  /** Deck format label for DeckIdentityCard. */
  format: string;
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
  /** Deck-health checklist — computed once in DeckDisplay so the tab badge can't drift. */
  validation: ValidationResult;
}) {
  // Lower-cased in-deck names for the Build Report's "+ Add" gate (never
  // re-propose a card already in the deck — mirrors DeckEditorPage's
  // deckCardNames memo used by the Coach feed).
  const buildReportDeckNames = useMemo(
    () => new Set(allCards.map((c) => c.name.toLowerCase())),
    [allCards]
  );

  const showRoles = roleCounts !== undefined;

  // The commander (and partner): the Types panel files them as their own row,
  // the way the deck list does.
  const commandZone = useMemo(
    () => [commander, partnerCommander].filter((c): c is ScryfallCard => !!c),
    [commander, partnerCommander]
  );

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
              format={format}
              analysisState={analysisState}
              onRetryAnalysis={onRetryAnalysis}
              edhrecMissing={edhrecMissing}
              validation={validation}
              planScore={planScore ?? null}
              edhrecNumDecks={edhrecNumDecks ?? null}
              identity={identity}
              archetypeOverride={archetypeOverride}
              onSetArchetypeOverride={onSetArchetypeOverride}
              onNavigate={onNavigateToTune}
              cards={allCards}
            />
          </div>
          {/* The panels sit on two rows sized to what they hold (§ Deck stats
              sit under the list): the curve beside the type counts, then
              colour beside the salt and the table record. Each row is a flex
              line whose wide member takes two shares; under ~900px of board
              the rows stack. A panel that has nothing to show is simply
              absent, and its row closes up. */}
          <div className={`deck-stats-row ${panelCascadeClass(1, cascade.animating) ?? ''}`.trim()}>
            <Panel title="Mana curve" className="deck-stats-row-main">
              <DeckCurvePhases
                manaCurve={manaData.manaCurve}
                curveByColor={manaData.curveByColor}
                averageCmc={manaData.averageCmc}
                cardsByCmc={manaData.cardsByCmc}
              />
            </Panel>
            <Panel title="Types">
              <DeckTypeBreakdown
                typeCounts={manaData.typeBreakdown}
                cardsByType={manaData.cardsByType}
                commandZone={commandZone}
              />
            </Panel>
          </div>
          <div className={`deck-stats-row ${panelCascadeClass(2, cascade.animating) ?? ''}`.trim()}>
            <Panel title="Color" className="deck-stats-row-main">
              <DeckColorPanel
                colorDist={manaData.colorDist}
                manaProduction={manaData.manaProduction}
                cardsByColor={manaData.cardsByColor}
                manaCurve={manaData.manaCurve}
                landUpgradeCount={landUpgradeCount}
                onReanalyzeLands={onNavigateToTune ? () => onNavigateToTune('lands') : undefined}
              />
            </Panel>
            {saltiestCards && saltiestCards.length > 0 && (
              <Panel title="Saltiest cards">
                <SaltiestPanel cards={saltiestCards} averageSalt={averageSalt} />
              </Panel>
            )}
            {/* Table record: this deck's real tracked W/L. Owns its own
                compact empty state for a never-played deck. */}
            {tableRecordSlot && <Panel title="Table record">{tableRecordSlot}</Panel>}
          </div>
          {/* Build report: how the generator built this deck. It is a record
              of the build, not a stat, so it rests as one row naming the
              archetype the generator used and opens in place (every "+ Add"
              and the "Fix gaps" link still work inside). A disclosure rather
              than a sheet because the public shared deck renders these same
              stats and has no sheet to open. */}
          {buildReport && (
            <details
              className={`deck-stats-report ${panelCascadeClass(3, cascade.animating) ?? ''}`.trim()}
            >
              <summary className="deck-stats-report-summary">
                <span className="deck-stats-report-eyebrow">Build report</span>
                <span className="deck-stats-report-line">
                  {/* The generator's archetype set the role targets and land
                      count; "Plays as" above reads the deck's cards. Worded as
                      targets so the two don't read as a contradiction. */}
                  {buildReport.archetype
                    ? `Generated with ${ARCHETYPE_LABEL[buildReport.archetype]} targets`
                    : 'How the generator built this deck'}
                </span>
                <ChevronDown className="deck-stats-report-chevron" aria-hidden={true} />
              </summary>
              <div className="deck-stats-report-body">
                <BuildReportPanel
                  report={buildReport}
                  onFixGaps={onNavigateToTune ? () => onNavigateToTune('fill-gaps') : undefined}
                  onAddCard={onAddSuggestedCard}
                  deckCardNames={buildReportDeckNames}
                  addingCardNames={addingSuggestedCardNames}
                  oneAwayCombos={oneAwayCombos}
                  ownedOracleIds={ownedOracleIds}
                />
              </div>
            </details>
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
                {/* No repeated "Bracket N · Label" title here: the Power hero
                    above already says it, and the verdict strip carries the
                    bracket/estimate pair (including a stated bracket). */}
                <div className="deck-stats-bracket">
                  {illegalCardNames.length > 0 && (
                    <p className="deck-stats-bracket-illegal" role="note">
                      {illegalCardNames.length === 1
                        ? `${illegalCardNames[0]} isn't legal in ${formatLabel}. `
                        : `${illegalCardNames.length} cards aren't legal in ${formatLabel} (${illegalCardNames.join(', ')}). `}
                      The deck can't be played at any bracket until{' '}
                      {illegalCardNames.length === 1 ? 'it is' : 'they are'} cut.
                    </p>
                  )}
                  {/* The stated-vs-estimate strip only when there is a stated
                      bracket to compare. On Auto the Power hero's headline IS
                      the estimate (§ Bracket: the owner's word), and the strip
                      read "Bracket Auto · Estimate B4 · Auto · No bracket set",
                      saying "Auto" twice to state one number again. */}
                  {bracketOverride != null && (
                    <BracketVerdictStrip
                      bracket={bracketOverride}
                      estimate={bracketEstimation?.bracket}
                      estimateIsFloor={bracketMissesCombos}
                    />
                  )}
                  {/* One sentence naming where the ESTIMATE comes from (a hard
                      floor, the power signal, or neither), whether or not the
                      owner has stated a bracket above it. */}
                  {/* Held while combos aren't counted: "nothing pushes it past
                      Core" is exactly what an uncounted combo can disprove, and
                      the strip above already says the estimate may rise. */}
                  {bracketEstimation && !bracketMissesCombos && (
                    <p className="deck-stats-bracket-source">
                      {bracketSourceSentence(bracketSource(bracketEstimation))}
                    </p>
                  )}
                  {/* UX-313: the bracket control moved to the PowerHero above
                      (the "Bracket: N ▾" SelectMenu). Keeping just a small note
                      here when a stated bracket is active so the Bracket panel
                      stays self-explaining without re-providing a redundant
                      control. */}
                  {bracketOverridden && (
                    <p className="deck-stats-bracket-override-note">
                      Bracket set in Power level.{' '}
                      {onSetBracketOverride && (
                        <button
                          type="button"
                          className="deck-stats-bracket-clear-btn"
                          onClick={() => onSetBracketOverride(null)}
                        >
                          Use the estimate
                        </button>
                      )}
                    </p>
                  )}
                  {bracketEstimation && (
                    <BracketBreakdown
                      estimation={bracketEstimation}
                      deckCardsByName={deckCardsByName}
                      combosUncounted={bracketMissesCombos}
                      bracketOverride={bracketOverride ?? null}
                      onSetBracketOverride={onSetBracketOverride}
                      clockLibrary={clockLibrary}
                    />
                  )}
                </div>
              </Panel>
            )}
            {showRoles && (
              <Panel title="Roles">
                <RolesPanel
                  roleCounts={roleCounts}
                  roleTargets={roleTargets}
                  rampSubtypeCounts={rampSubtypeCounts}
                  removalSubtypeCounts={removalSubtypeCounts}
                  boardwipeSubtypeCounts={boardwipeSubtypeCounts}
                  cardDrawSubtypeCounts={cardDrawSubtypeCounts}
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
  rampSubtypeCounts,
  removalSubtypeCounts,
  boardwipeSubtypeCounts,
  cardDrawSubtypeCounts,
}: {
  roleCounts?: Record<string, number>;
  roleTargets?: Record<string, number>;
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

  const items = [
    {
      label: ROLE_TITLES.ramp,
      value: ramp,
      want: rampWant,
      sub: subSummary(rampSubtypeCounts),
      color: 'var(--accent)',
    },
    {
      label: ROLE_TITLES.removal,
      value: removal,
      want: removalWant,
      sub: subSummary(removalSubtypeCounts),
      color: '#d8442a',
    },
    {
      label: ROLE_TITLES.boardwipe,
      value: wipes,
      want: wipesWant,
      sub: subSummary(boardwipeSubtypeCounts),
      color: '#d4a838',
    },
    {
      label: ROLE_TITLES.cardDraw,
      value: draw,
      want: drawWant,
      sub: subSummary(cardDrawSubtypeCounts),
      color: '#3a85cc',
    },
  ];

  const max = Math.max(1, ...items.map((it) => Math.max(it.value, it.want ?? 0)));

  return (
    <>
      {/* These are the deck's one role count, the same numbers as the role
          chips above the list and the deck checks: each mainboard card once,
          under its main role. They used to sit under an overlapping tally
          (every role a card fills) that disagreed with the chips and the
          bars; one count replaced the note explaining three. */}
      <p className="deck-roles-note">Each card counted once, under its main role.</p>
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
              {/* The want is a tick on the bar, so have-vs-want reads as one
                  mark against a line rather than two numbers to compare. */}
              <MeterBar
                className="deck-roles-bar"
                value={it.value}
                max={max}
                color={it.color}
                tick={hasTarget ? (it.want as number) : undefined}
              />
              {it.sub && <div className="deck-roles-sub">{it.sub}</div>}
            </li>
          );
        })}
      </ul>
    </>
  );
}
