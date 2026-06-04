import { logger } from '@/lib/logger';
import type {
  ScryfallCard,
  EDHRECCommanderData,
  DetectedCombo,
  GapAnalysisCard,
} from '@/deck-builder/types';
import type { ComboMatchResponse } from '@/types/combos';
import {
  getCardRole,
  getRampSubtype,
  getRemovalSubtype,
  getBoardwipeSubtype,
  getCardDrawSubtype,
} from '@/deck-builder/services/tagger/client';
import {
  getGameChangerNames,
  getCardsByNames,
  getFrontFaceTypeLine,
  searchCards,
} from '@/deck-builder/services/scryfall/client';
import { isBasicLandName } from '@/lib/allocations';
import { fetchCommanderData, fetchPartnerCommanderData } from '../edhrec/client';
import { estimateBracket, type BracketEstimation } from './bracketEstimator';
import {
  analyzeDeck,
  getDeckSummaryData,
  computeOptimizeSwaps,
  type CurvePhaseAnalysis,
  type DeckAnalysis,
  type OptimizeSwaps,
  type RecommendedCard,
} from './deckAnalyzer';
import { getDynamicRoleTargets } from './roleTargets';
import { buildGapAnalysis } from './gapAnalysisBuilder';
import { computePlanScore, type PlanScore, type StrategyEngineInput } from './planScore';
import { buildCostPlan, type CostPlan } from './costAnalyzer';
import { analyzeDeckSynergy, isLoadBearing, type DeckSynergy } from '../synergy/deckSynergy';
import {
  buildSynergyAnalysis,
  type SynergyAnalysis,
  type SynergyCandidate,
} from '../synergy/analysis';
import { deriveNeeds } from '../synergy/suggest';
import {
  axisSearchQuery,
  selectOracleCandidates,
  type OracleNeedResult,
} from '../synergy/oracleSearch';
import { detectWinConditions } from '../winConditions/detect';
import type { WinConditionAnalysis } from '../winConditions/types';

export interface DeckGrade {
  letter: string;
  headline: string;
}

// ── Role counting (shared with DeckDisplay's derivedRoles) ──────────────────

export interface RoleCountResult {
  roleCounts: Record<string, number>;
  rampSubtypeCounts: Record<string, number>;
  removalSubtypeCounts: Record<string, number>;
  boardwipeSubtypeCounts: Record<string, number>;
  cardDrawSubtypeCounts: Record<string, number>;
}

/**
 * Tag each non-land card by functional role + subtype. Mirrors the enricher's
 * rule of not counting lands toward role totals. Shared by the deck-stats
 * `derivedRoles` memo and the manual-deck analysis path so the two never drift.
 */
export function computeRoleCounts(
  cards: Array<{ name: string; type_line?: string }>
): RoleCountResult {
  const roleCounts: Record<string, number> = {
    ramp: 0,
    removal: 0,
    boardwipe: 0,
    cardDraw: 0,
  };
  const rampSubtypeCounts: Record<string, number> = {};
  const removalSubtypeCounts: Record<string, number> = {};
  const boardwipeSubtypeCounts: Record<string, number> = {};
  const cardDrawSubtypeCounts: Record<string, number> = {};

  for (const c of cards) {
    if ((c.type_line || '').toLowerCase().includes('land')) continue;
    const role = getCardRole(c.name);
    if (!role) continue;
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    switch (role) {
      case 'ramp': {
        const s = getRampSubtype(c.name);
        if (s) rampSubtypeCounts[s] = (rampSubtypeCounts[s] || 0) + 1;
        break;
      }
      case 'removal': {
        const s = getRemovalSubtype(c.name);
        if (s) removalSubtypeCounts[s] = (removalSubtypeCounts[s] || 0) + 1;
        break;
      }
      case 'boardwipe': {
        const s = getBoardwipeSubtype(c.name);
        if (s) boardwipeSubtypeCounts[s] = (boardwipeSubtypeCounts[s] || 0) + 1;
        break;
      }
      case 'cardDraw': {
        const s = getCardDrawSubtype(c.name);
        if (s) cardDrawSubtypeCounts[s] = (cardDrawSubtypeCounts[s] || 0) + 1;
        break;
      }
    }
  }

  return {
    roleCounts,
    rampSubtypeCounts,
    removalSubtypeCounts,
    boardwipeSubtypeCounts,
    cardDrawSubtypeCounts,
  };
}

// ── EDHREC inclusion lookup (shared with the generator) ─────────────────────

/** Index every EDHREC card (non-land + non-basic land) by name → inclusion %. */
export function buildInclusionIndex(edhrecData: EDHRECCommanderData): Map<string, number> {
  const index = new Map<string, number>();
  for (const c of edhrecData.cardlists.allNonLand) {
    index.set(c.name, c.inclusion);
  }
  for (const c of edhrecData.cardlists.lands) {
    if (!isBasicLandName(c.name)) index.set(c.name, c.inclusion);
  }
  return index;
}

/** Inclusion % for a card name, with a front-face fallback for DFCs. */
export function lookupInclusion(index: Map<string, number>, name: string): number | undefined {
  const direct = index.get(name);
  if (direct !== undefined) return direct;
  if (name.includes(' // ')) return index.get(name.split(' // ')[0]);
  return undefined;
}

/**
 * Build the `cardName → EDHREC inclusion %` map analyzeDeck consumes.
 * Basic lands are skipped (they have no meaningful inclusion signal).
 */
export function buildCardInclusionMap(
  edhrecData: EDHRECCommanderData,
  cardNames: string[]
): Record<string, number> {
  const index = buildInclusionIndex(edhrecData);
  const map: Record<string, number> = {};
  for (const name of cardNames) {
    if (isBasicLandName(name)) continue;
    map[name] = lookupInclusion(index, name) ?? 0;
  }
  return map;
}

/**
 * Build a `cardName → EDHREC synergy` map (synergy ∈ roughly [-1, 1]) for the
 * cards in the deck. Feeds the PlanScore "card fit" dimension — a card with
 * negative synergy and low inclusion reads as a misfit. Basics are skipped.
 */
export function buildCardSynergyMap(
  edhrecData: EDHRECCommanderData,
  cardNames: string[]
): Record<string, number> {
  const index = new Map<string, number>();
  for (const c of edhrecData.cardlists.allNonLand) {
    if (c.synergy != null) index.set(c.name, c.synergy);
  }
  const map: Record<string, number> = {};
  for (const name of cardNames) {
    if (isBasicLandName(name)) continue;
    const direct = index.get(name);
    const val = direct ?? (name.includes(' // ') ? index.get(name.split(' // ')[0]) : undefined);
    if (val != null) map[name] = val;
  }
  return map;
}

/**
 * Distil a DeckSynergy into the PlanScore strategy inputs: the primary engine
 * axis (busiest invested axis), its producer/payoff counts, and how many deck
 * cards participate in any invested axis. `primaryLabel` is null when the deck
 * has no real engine → the strategy dim scores `partial` and drops out.
 */
export function buildStrategyEngineInput(
  synergy: DeckSynergy,
  nonLandCount: number
): StrategyEngineInput {
  const primaryKey = synergy.invested[0];
  const primary = primaryKey ? synergy.axes.find((a) => a.axis === primaryKey) : undefined;
  const investedSet = new Set(synergy.invested);
  const engineNames = new Set<string>();
  for (const ax of synergy.axes) {
    if (!investedSet.has(ax.axis)) continue;
    for (const c of ax.producers) engineNames.add(c.name);
    for (const c of ax.payoffs) engineNames.add(c.name);
  }
  return {
    primaryLabel: primary?.label ?? null,
    primaryProducers: primary?.producers.length ?? 0,
    primaryPayoffs: primary?.payoffs.length ?? 0,
    engineCards: engineNames.size,
    nonLandCount,
  };
}

// ── Combo adaptation ────────────────────────────────────────────────────────

/**
 * Adapt the combos-panel match response into the `DetectedCombo` shape
 * `estimateBracket` expects. Only `inDeck` matters: estimateBracket counts
 * complete combos only, so partial (`oneAway`) combos are intentionally
 * dropped here.
 */
export function comboMatchesToDetected(
  resp: ComboMatchResponse | null | undefined
): DetectedCombo[] {
  if (!resp) return [];
  return resp.inDeck.map((m) => ({
    comboId: m.combo.id,
    cards: m.combo.cards.map((c) => c.cardName),
    results: m.combo.produces,
    isComplete: true,
    missingCards: [],
    deckCount: m.combo.popularity,
    bracket: m.combo.bracket != null ? String(m.combo.bracket) : 'unknown',
  }));
}

// ── Grade + bracket (shared by generator and manual editor) ─────────────────

export interface GradeBracketInput {
  /** Every card name in the deck, including commander(s). */
  allCardNames: string[];
  detectedCombos?: DetectedCombo[];
  averageCmc: number;
  deckScore?: number;
  /**
   * Role counts fed to the bracket's interaction signal. The generator only
   * passes this when role targets were computed; pass undefined to skip it.
   */
  bracketRoleCounts?: Record<string, number>;
  gameChangerNames: Set<string>;
  /** Mainboard non-commander cards used for grade analysis. */
  allCards: ScryfallCard[];
  roleCounts: Record<string, number>;
  roleTargets?: Record<string, number> | null;
  edhrecData?: EDHRECCommanderData | null;
  deckSize: number;
  cardInclusionMap?: Record<string, number>;
  colorIdentity?: string[];
}

export interface GradeBracketResult {
  bracketEstimation: BracketEstimation;
  deckGrade?: DeckGrade;
  /**
   * Curve-phase analysis lifted out of the rich `analyzeDeck` pass (only set
   * when EDHREC data + role targets were available, i.e. the grade branch ran).
   * Surfaced so callers can feed the PlanScore "curve" dimension without
   * recomputing the whole analysis.
   */
  curvePhases?: CurvePhaseAnalysis[];
  /**
   * The full rich analysis, surfaced (transiently — never persisted) so the
   * manual-deck path can derive cut/add optimize swaps from it. Only set when
   * the grade branch ran (EDHREC data + role targets present).
   */
  analysis?: DeckAnalysis;
}

/**
 * Compute the bracket estimation (always) and letter grade (only when EDHREC
 * data and role targets are available). This is the single orchestration of
 * estimateBracket + analyzeDeck + getDeckSummaryData; both the generator and
 * the manual-deck editor go through it so the logic never diverges.
 */
export function computeGradeAndBracket(input: GradeBracketInput): GradeBracketResult {
  const bracketEstimation = estimateBracket(
    input.allCardNames,
    input.detectedCombos,
    input.averageCmc,
    input.deckScore,
    input.bracketRoleCounts,
    input.gameChangerNames
  );

  let deckGrade: DeckGrade | undefined;
  let curvePhases: CurvePhaseAnalysis[] | undefined;
  let richAnalysis: DeckAnalysis | undefined;
  if (input.edhrecData && input.roleTargets) {
    try {
      const analysis = analyzeDeck(
        input.edhrecData,
        input.allCards,
        input.roleCounts,
        input.roleTargets,
        input.deckSize,
        input.cardInclusionMap,
        input.colorIdentity
      );
      const summary = getDeckSummaryData(analysis);
      deckGrade = { letter: summary.gradeLetter, headline: summary.headline };
      curvePhases = analysis.curvePhases;
      richAnalysis = analysis;
    } catch {
      deckGrade = undefined;
    }
  }

  return { bracketEstimation, deckGrade, curvePhases, analysis: richAnalysis };
}

// ── Manual-deck entry point ─────────────────────────────────────────────────

/**
 * Result of the manual-deck analysis: grade + bracket, plus the live
 * role targets and "cards to consider" gap analysis the editor surfaces.
 * Extends GradeBracketResult so existing consumers keep working.
 */
export interface CommanderDeckAnalysisResult extends GradeBracketResult {
  /** Per-role target counts derived from EDHREC + archetype/pacing blend. */
  roleTargets?: Record<string, number>;
  /** Top EDHREC-recommended cards not already in the deck, ranked by inclusion. */
  gapAnalysis?: GapAnalysisCard[];
  /** Per-card EDHREC inclusion % keyed by card name (basics omitted). */
  cardInclusionMap?: Record<string, number>;
  /** 0-100 PlanScore (strategy/roles/curve/cardFit). Undefined if not computable. */
  planScore?: PlanScore;
  /** Balanced cut/add optimize suggestions (the "Optimize" surface). */
  optimizeSwaps?: OptimizeSwaps;
  /** Budget downgrade suggestions (cheaper role-equivalents). USD-canonical. */
  costPlan?: CostPlan;
  /** Native synergy engine analysis + off-meta suggestions (the "Engine" surface). */
  synergyAnalysis?: SynergyAnalysis;
  /** Win-condition detection (primary + secondary paths). */
  winConditions?: WinConditionAnalysis;
}

export interface AnalyzeCommanderDeckParams {
  commander: ScryfallCard;
  partnerCommander?: ScryfallCard | null;
  /** Mainboard cards excluding the commander(s). */
  cards: ScryfallCard[];
  /** Numeric mainboard size (99 for Commander). */
  deckSize: number;
  colorIdentity?: string[];
  /** Combos already matched by the editor's combos panel. */
  detectedCombos?: DetectedCombo[];
}

const RECOMMENDATION_SUPERTYPE = /^(Legendary|Basic|Snow|Tribal|Kindred|World|Ongoing)\s+/i;

/** First non-supertype word of a front-face type line ("Creature", "Land", …). */
function derivePrimaryType(typeLine: string): string {
  let t = typeLine.split('—')[0].trim();
  while (RECOMMENDATION_SUPERTYPE.test(t)) t = t.replace(RECOMMENDATION_SUPERTYPE, '');
  return t.split(/\s+/)[0] ?? '';
}

/**
 * EDHREC cardlist cards carry no price / cmc / primary_type — Scryfall fills
 * those only in the generator path, never in the manual-editor analysis. Left
 * unenriched, the Cost optimizer's candidate pool has no prices (→ zero swap
 * rows) and Optimize's curve-fill + cost confidence bands degrade (cmc
 * undefined → cmcDelta = Infinity). Backfill the gaps from Scryfall in place —
 * one batched, cache-backed `/cards/collection` call. Best-effort: on failure
 * the recommendations are left as-is (the prior behaviour).
 */
export async function enrichRecommendationPrices(recs: RecommendedCard[]): Promise<void> {
  const need = recs.filter(
    (r) => r.price == null || r.cmc == null || !r.primaryType || r.primaryType === 'Unknown'
  );
  if (need.length === 0) return;
  try {
    const cardMap = await getCardsByNames(need.map((r) => r.name));
    const byName = new Map<string, ScryfallCard>();
    for (const c of cardMap.values()) {
      byName.set(c.name.toLowerCase(), c);
      if (c.name.includes(' // ')) byName.set(c.name.split(' // ')[0].toLowerCase(), c);
    }
    for (const r of recs) {
      const c = byName.get(r.name.toLowerCase());
      if (!c) continue;
      if (r.cmc == null && c.cmc != null) r.cmc = c.cmc;
      if (!r.primaryType || r.primaryType === 'Unknown') {
        const pt = derivePrimaryType(getFrontFaceTypeLine(c));
        if (pt) r.primaryType = pt;
      }
      if (r.price == null) {
        const usd = c.prices?.usd ?? c.prices?.usd_foil ?? undefined;
        if (usd) r.price = usd;
      }
    }
  } catch (err) {
    logger.warn('[CommanderDeckAnalysis] Recommendation price enrichment failed:', err);
  }
}

/** Cap on how many Scryfall hits per need feed the off-meta selector. */
const ORACLE_HITS_PER_NEED = 40;

/**
 * Genuinely-off-meta candidates for the synergy suggester: for each engine
 * *need*, run a broad Scryfall oracle search inside the deck's color identity,
 * then keep only cards EDHREC never surfaced for this commander. Complements
 * (doesn't replace) the EDHREC long-tail pool. Best-effort — a failed search
 * for one need just contributes nothing.
 */
async function sourceOracleCandidates(
  deckSynergy: DeckSynergy,
  colorIdentity: string[],
  edhrecInclusion: Map<string, number>,
  inDeck: Set<string>
): Promise<SynergyCandidate[]> {
  const needs = deriveNeeds(deckSynergy);
  if (needs.length === 0) return [];

  const results: OracleNeedResult[] = [];
  for (const need of needs) {
    const query = axisSearchQuery(need.axis, need.side);
    if (!query) continue;
    try {
      const resp = await searchCards(query, colorIdentity);
      results.push({ need, cards: resp.data.slice(0, ORACLE_HITS_PER_NEED) });
    } catch (err) {
      logger.warn(`[CommanderDeckAnalysis] Oracle search failed for ${need.axis}:`, err);
    }
  }
  return selectOracleCandidates(results, { edhrecInclusion, inDeck });
}

/**
 * Compute grade + bracket for a manually-built commander deck. Fetches (cached)
 * EDHREC data for the commander and derives every other input the generator
 * normally has in memory. Returns null when there's no usable commander data
 * (e.g. EDHREC unreachable or commander not found) — callers should leave the
 * deck's existing grade/bracket untouched in that case.
 */
export async function analyzeCommanderDeck(
  params: AnalyzeCommanderDeckParams
): Promise<CommanderDeckAnalysisResult | null> {
  try {
    const edhrecData = params.partnerCommander
      ? await fetchPartnerCommanderData(params.commander.name, params.partnerCommander.name)
      : await fetchCommanderData(params.commander.name);

    const { roleCounts } = computeRoleCounts(params.cards);
    const { targets: roleTargets } = getDynamicRoleTargets(
      params.deckSize,
      undefined,
      edhrecData.stats,
      edhrecData
    );

    const nonLand = params.cards.filter((c) => !(c.type_line || '').toLowerCase().includes('land'));
    const averageCmc =
      nonLand.length > 0 ? nonLand.reduce((s, c) => s + (c.cmc ?? 0), 0) / nonLand.length : 0;

    const gameChangerNames = await getGameChangerNames();
    const cardInclusionMap = buildCardInclusionMap(
      edhrecData,
      params.cards.map((c) => c.name)
    );

    const allCardNames = [...params.cards.map((c) => c.name), params.commander.name];
    if (params.partnerCommander) allCardNames.push(params.partnerCommander.name);

    const gradeBracket = computeGradeAndBracket({
      allCardNames,
      detectedCombos: params.detectedCombos,
      averageCmc,
      deckScore: undefined,
      bracketRoleCounts: roleCounts,
      gameChangerNames,
      allCards: params.cards,
      roleCounts,
      roleTargets,
      edhrecData,
      deckSize: params.deckSize,
      cardInclusionMap,
      colorIdentity: params.colorIdentity,
    });

    // Gap analysis dedupes against every card name in the list, commanders
    // included. Ownership is intentionally left unset here — the UI marks
    // `isOwned` later against the live collection.
    const gapAnalysis = buildGapAnalysis(edhrecData, allCardNames);

    // PlanScore (0-100, four weighted dimensions). The curve dim needs the curve-phase
    // analysis lifted out of the grade pass; if the grade branch didn't run
    // (no curvePhases), skip — the dashboard falls back to the letter grade.
    // Per-card EDHREC synergy — feeds both the PlanScore cardFit dim and the
    // Optimize cut guard (commander-defining payoffs are never auto-cut).
    const cardSynergyMap = buildCardSynergyMap(
      edhrecData,
      params.cards.map((c) => c.name)
    );

    // Native synergy engine over the deck's real oracle text. Drives both the
    // PlanScore "strategy" dimension (producer↔payoff balance, not EDHREC
    // conformance) and the Optimize cut guard (load-bearing cards never cut).
    const deckSynergy = analyzeDeckSynergy(params.cards);
    const strategyEngine = buildStrategyEngineInput(deckSynergy, nonLand.length);

    let planScore: PlanScore | undefined;
    if (gradeBracket.curvePhases) {
      const commanderNames = [params.commander.name];
      if (params.partnerCommander) commanderNames.push(params.partnerCommander.name);
      planScore = computePlanScore({
        roleCounts,
        roleTargets,
        curvePhases: gradeBracket.curvePhases,
        misfitInputs: {
          cards: params.cards,
          cardInclusionMap,
          cardSynergyMap,
          gapCandidates: gapAnalysis,
          commanderNames,
        },
        gapCount: gapAnalysis.length,
        // Strategy from the deck's own producer↔payoff engine (oracle-text
        // grounded). Scores `partial` when no engine is detected.
        strategyEngine,
        sampleSize: edhrecData.stats?.numDecks ?? null,
      });
    }

    // Balanced cut/add optimize plan. Needs the full rich analysis (its
    // recommendations + role/curve/color/mana data drive the swaps); only
    // available when the grade branch ran. Manual decks have no must-include /
    // banned set, so those are empty.
    let optimizeSwaps: OptimizeSwaps | undefined;
    let costPlan: CostPlan | undefined;
    if (gradeBracket.analysis) {
      // Backfill price/cmc/type onto the EDHREC recommendation pool so the Cost
      // optimizer has priced alternatives and Optimize's curve-fill/confidence
      // bands work (the manual path doesn't get the generator's enrichment).
      await enrichRecommendationPrices(gradeBracket.analysis.recommendations);
      // Protect cards load-bearing for an invested axis (a token producer in a
      // token deck, etc.) from the EDHREC-inclusion cutter. Reuses the synergy
      // analysis computed above.
      const synergyProtectedNames = new Set(
        params.cards.filter((c) => isLoadBearing(c, deckSynergy)).map((c) => c.name)
      );
      optimizeSwaps = computeOptimizeSwaps(
        gradeBracket.analysis,
        params.cards,
        cardInclusionMap,
        params.commander.name,
        params.partnerCommander?.name,
        new Set<string>(),
        new Set<string>(),
        params.detectedCombos,
        cardSynergyMap,
        synergyProtectedNames
      );
      // Budget downgrades: cheaper role-equivalents drawn from the same EDHREC
      // recommendation pool. USD-canonical (matches the baked recommendation
      // prices); currency localization is a future refinement.
      costPlan = buildCostPlan(
        params.cards,
        params.commander.name,
        params.partnerCommander?.name,
        gradeBracket.analysis.recommendations
      );
    }

    // Native synergy engine analysis + off-meta suggestions. Candidates come
    // from two pools: the EDHREC long tail (off-meta inclusion window, enriched
    // with oracle text) and a Scryfall oracle search per engine *need* that
    // surfaces genuinely off-meta cards the crowd never aggregated. The
    // classifier reads what each does; the suggester picks producer↔payoff
    // fills. Best-effort.
    let synergyAnalysis: SynergyAnalysis | undefined;
    try {
      const inDeck = new Set(params.cards.map((c) => c.name.toLowerCase()));
      inDeck.add(params.commander.name.toLowerCase());
      if (params.partnerCommander) inDeck.add(params.partnerCommander.name.toLowerCase());
      const edhrecInclusion = new Map<string, number>();
      for (const c of edhrecData.cardlists.allNonLand)
        edhrecInclusion.set(c.name.toLowerCase(), c.inclusion);
      const candidateMeta = edhrecData.cardlists.allNonLand
        .filter(
          (c) =>
            c.inclusion >= 2 &&
            c.inclusion <= 35 &&
            !inDeck.has(c.name.toLowerCase()) &&
            !isBasicLandName(c.name)
        )
        .sort((a, b) => b.inclusion - a.inclusion)
        .slice(0, 80);
      const candidates: SynergyCandidate[] = [];
      if (candidateMeta.length > 0) {
        const cardMap = await getCardsByNames(candidateMeta.map((c) => c.name));
        const byName = new Map<string, ScryfallCard>();
        for (const sc of cardMap.values()) byName.set(sc.name.toLowerCase(), sc);
        for (const meta of candidateMeta) {
          const sc = byName.get(meta.name.toLowerCase());
          if (sc) candidates.push({ card: sc, inclusion: meta.inclusion });
        }
      }
      const colorIdentity = params.colorIdentity ?? params.commander.color_identity ?? [];
      const oracleCandidates = await sourceOracleCandidates(
        deckSynergy,
        colorIdentity,
        edhrecInclusion,
        inDeck
      );
      synergyAnalysis = buildSynergyAnalysis(deckSynergy, [...candidates, ...oracleCandidates]);
    } catch (err) {
      logger.warn('[CommanderDeckAnalysis] Synergy analysis failed:', err);
      synergyAnalysis = buildSynergyAnalysis(deckSynergy, []);
    }

    // Win-condition detection — pure, composes existing signals (combos,
    // synergy axes, oracle text). Best-effort: failure leaves winConditions absent.
    let winConditions: WinConditionAnalysis | undefined;
    try {
      winConditions = detectWinConditions({
        cards: params.cards,
        commander: params.commander,
        combosInDeck: (params.detectedCombos ?? []).map((c) => ({
          results: c.results,
          cards: c.cards,
        })),
        deckSynergy,
        format: 'commander',
      });
    } catch (err) {
      logger.warn('[CommanderDeckAnalysis] Win-condition detection failed:', err);
    }

    // Return only the lean, persistable fields — the rich `analysis` and
    // `curvePhases` were transient inputs and must not leak into the store.
    return {
      bracketEstimation: gradeBracket.bracketEstimation,
      deckGrade: gradeBracket.deckGrade,
      roleTargets,
      gapAnalysis,
      cardInclusionMap,
      planScore,
      optimizeSwaps,
      costPlan,
      synergyAnalysis,
      winConditions,
    };
  } catch (err) {
    logger.warn('[CommanderDeckAnalysis] Failed to analyze manual deck:', err);
    return null;
  }
}
