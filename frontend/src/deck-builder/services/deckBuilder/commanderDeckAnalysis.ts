import { logger } from '@/lib/logger';
import type { ScryfallCard, EDHRECCommanderData, DetectedCombo } from '@/deck-builder/types';
import type { ComboMatchResponse } from '@/types/combos';
import {
  getCardRole,
  getRampSubtype,
  getRemovalSubtype,
  getBoardwipeSubtype,
  getCardDrawSubtype,
} from '@/deck-builder/services/tagger/client';
import { getGameChangerNames } from '@/deck-builder/services/scryfall/client';
import { isBasicLandName } from '@/lib/allocations';
import { fetchCommanderData, fetchPartnerCommanderData } from '../edhrec/client';
import { estimateBracket, type BracketEstimation } from './bracketEstimator';
import { analyzeDeck, getDeckSummaryData } from './deckAnalyzer';
import { getDynamicRoleTargets } from './roleTargets';

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
    } catch {
      deckGrade = undefined;
    }
  }

  return { bracketEstimation, deckGrade };
}

// ── Manual-deck entry point ─────────────────────────────────────────────────

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

/**
 * Compute grade + bracket for a manually-built commander deck. Fetches (cached)
 * EDHREC data for the commander and derives every other input the generator
 * normally has in memory. Returns null when there's no usable commander data
 * (e.g. EDHREC unreachable or commander not found) — callers should leave the
 * deck's existing grade/bracket untouched in that case.
 */
export async function analyzeCommanderDeck(
  params: AnalyzeCommanderDeckParams
): Promise<GradeBracketResult | null> {
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

    return computeGradeAndBracket({
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
  } catch (err) {
    logger.warn('[CommanderDeckAnalysis] Failed to analyze manual deck:', err);
    return null;
  }
}
