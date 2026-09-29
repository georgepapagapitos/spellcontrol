import { logger } from '@/lib/logger';
import {
  Archetype,
  type ArchetypeProvenance,
  type DeckDataSource,
  type DeckSize,
  type ThemeResult,
  type EDHRECCommanderStats,
  type EDHRECCommanderData,
  type EDHRECTheme,
  type RoleTargetBreakdown,
} from '@/deck-builder/types';
import type { Pacing } from './pacingDetector';
import { getCardRole, type RoleKey } from '@/deck-builder/services/tagger/client';
import { classifyCard } from '@/deck-builder/services/synergy/classify';
import { tribalMembership, type AxisKey } from '@/deck-builder/services/synergy/axes';
import type { CardLike } from '@/deck-builder/services/synergy/text';
import { getByCardName } from '@/lib/card-text';
import {
  axisMassFrom,
  engineLeader,
  isEngineContender,
  isInvestedAxis,
  isSharpArchetype,
  readEngine,
  themeArchetype,
  themeAxes,
  type ArchetypeMass,
  type AxisMass,
  type EngineEntry,
  type EngineRead,
} from './strategyVocabulary';

// ─── EDHREC Blend Tuning ────────────────────────────────────────────
// Threshold for "cards in the typical deck for this commander" — a card above
// this inclusion % is played in roughly 1 of every 4 tracked decks.
export const EDHREC_INCLUSION_THRESHOLD = 25; // percent

// Weight for the EDHREC-derived role counts in the final blended target.
// Default 0.6 means 60% EDHREC / 40% archetype model. getDynamicRoleTargets
// still accepts an overrideBlendWeight param, but its only production caller
// (deckGenerator.ts) always passes null since E121 deleted the
// customization.advancedTargets override that used to supply it.
export const EDHREC_BLEND_WEIGHT = 0.6;

// ─── EDHREC-Derived Role Counts ─────────────────────────────────────
// For the current commander, count cards per role whose EDHREC inclusion
// meets the threshold. Lands are skipped (basics dominate the distribution
// and role classification doesn't apply). Cards whose role is undefined
// are assumed to be synergy/payoff pieces and correctly contribute nothing.
export function computeEdhrecRoleTargets(
  edhrecData: EDHRECCommanderData | null | undefined,
  threshold: number = EDHREC_INCLUSION_THRESHOLD
): Record<RoleKey, number> {
  const counts: Record<RoleKey, number> = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
  if (!edhrecData?.cardlists?.allNonLand) return counts;

  for (const card of edhrecData.cardlists.allNonLand) {
    if (card.inclusion < threshold) continue;
    const role = getCardRole(card.name);
    if (role) counts[role]++;
  }

  return counts;
}

// ─── Theme → Archetype Mapping ──────────────────────────────────────
// Sourced from the canonical strategy vocabulary so the theme→archetype and
// theme→label relationships can't drift apart. See strategyVocabulary.ts.

// ─── Archetype Role Multipliers ─────────────────────────────────────
// Applied to format-based baseline targets.
// >1.0 = archetype wants MORE of this role, <1.0 = wants LESS.

const ARCHETYPE_ROLE_MULTIPLIERS: Record<Archetype, Record<RoleKey, number>> = {
  [Archetype.AGGRO]: { ramp: 1.1, removal: 0.75, boardwipe: 0.67, cardDraw: 0.8 },
  [Archetype.CONTROL]: { ramp: 0.9, removal: 1.25, boardwipe: 1.67, cardDraw: 1.1 },
  [Archetype.COMBO]: { ramp: 1.0, removal: 0.88, boardwipe: 0.67, cardDraw: 1.2 },
  [Archetype.MIDRANGE]: { ramp: 1.0, removal: 1.0, boardwipe: 1.0, cardDraw: 1.0 },
  [Archetype.VOLTRON]: { ramp: 1.1, removal: 1.0, boardwipe: 0.33, cardDraw: 0.9 },
  [Archetype.SPELLSLINGER]: { ramp: 0.8, removal: 1.0, boardwipe: 1.0, cardDraw: 1.3 },
  // Tempo (unblockable/ninjutsu-style evasive-damage decks, e.g. Yuriko): a
  // lean low curve needs less ramp; cheap interaction to protect the clock
  // (bounce/counterspells) bumps removal above baseline; a boardwipe actively
  // hurts a deck that's racing on its OWN board of small evasive attackers;
  // card draw is the engine (ninjutsu returns/rebuys unblocked attackers,
  // each swing is a card-advantage trigger), so it leans the highest.
  [Archetype.TEMPO]: { ramp: 0.85, removal: 1.1, boardwipe: 0.4, cardDraw: 1.15 },
  [Archetype.TOKENS]: { ramp: 1.0, removal: 0.88, boardwipe: 0.67, cardDraw: 1.0 },
  [Archetype.ARISTOCRATS]: { ramp: 1.0, removal: 0.88, boardwipe: 0.67, cardDraw: 1.1 },
  [Archetype.REANIMATOR]: { ramp: 0.9, removal: 0.88, boardwipe: 1.0, cardDraw: 1.2 },
  [Archetype.TRIBAL]: { ramp: 1.0, removal: 0.88, boardwipe: 0.67, cardDraw: 1.0 },
  [Archetype.LANDFALL]: { ramp: 1.3, removal: 0.75, boardwipe: 1.0, cardDraw: 0.9 },
  [Archetype.ARTIFACTS]: { ramp: 1.1, removal: 0.88, boardwipe: 1.0, cardDraw: 1.0 },
  [Archetype.ENCHANTRESS]: { ramp: 0.9, removal: 0.88, boardwipe: 1.0, cardDraw: 1.2 },
  [Archetype.STORM]: { ramp: 1.1, removal: 0.63, boardwipe: 0.33, cardDraw: 1.4 },
  [Archetype.GOODSTUFF]: { ramp: 1.0, removal: 1.0, boardwipe: 1.0, cardDraw: 1.0 },
};

// ─── Board-Centric Plan Detection (E109) ─────────────────────────────
// A symmetric board wipe costs a deck whose own plan puts outsized value on
// its board (go-wide/token/tribal shells, attack-trigger commanders, or any
// creature-dense build) far more than a generic goodstuff deck — it torches
// the caster's own board along with its opponents'. ARCHETYPE_ROLE_MULTIPLIERS
// above already shaves the boardwipe TARGET for the archetypes whose whole
// plan is "many cheap bodies" (TOKENS/TRIBAL/ARISTOCRATS/AGGRO), but panel
// evidence shows that alone isn't enough — deckGenerator.ts additionally
// shaves the target by one more point and prefers one-sided wipes at pick
// time when this gate trips.
//
// Three independent signals, any one trips it:
//  - The archetype already blended EDHREC + archetype-model + user theme
//    picks (getDynamicRoleTargets's own `archetype` return) lands on one of
//    the four go-wide archetypes above.
//  - The commander's own EDHREC-typical build (typeTargets.creature, driven
//    by the commander's real EDHREC type breakdown — see
//    calculateTargetCounts) is creature-dense enough that the archetype
//    vote missing it (a split-strategy commander like Atraxa defaults to
//    GOODSTUFF when no single theme dominates — see DOMINANT_THEME_SHARE
//    above) shouldn't matter. 0.45 sits above the generic ~0.40 baseline
//    creature weight (rawTypeWeights in targetCounts.ts) so an ordinary
//    midrange goodstuff deck doesn't trip this by default — only a build
//    that's meaningfully more creature-heavy than typical. Live-panel
//    calibration (E109 fix round): kozilek (0.436) / yuriko (0.443)
//    delivered creature density sit just under 0.45 and correctly don't
//    trip — do not lower this threshold to chase a different deck; use the
//    attackTriggerCommander clause below instead.
//  - `attackTriggerCommander` (E109 fix round): the commander's payoff IS
//    attacking (Isshin doubles attack triggers, Aurelia/Karlach grant extra
//    combats) — that deck needs its attackers alive through a wipe by
//    construction, independent of archetype/creature-count. Isshin's
//    archetype vote landed GOODSTUFF when E109 shipped (its top EDHREC theme
//    held only 31.6% — under DOMINANT_THEME_SHARE; since E511 its cards read
//    as Tokens) and its PLANNED creature density
//    (pre-generation typeTargets, ~0.44) undercounts its DELIVERED density
//    (~0.475, only known after picking) — this clause catches it without
//    switching the density check to delivered counts or lowering the
//    threshold, either of which would also catch kozilek/yuriko above.
export const BOARD_CENTRIC_ARCHETYPES: ReadonlySet<Archetype> = new Set([
  Archetype.TOKENS,
  Archetype.TRIBAL,
  Archetype.ARISTOCRATS,
  Archetype.AGGRO,
]);
export const BOARD_CENTRIC_CREATURE_DENSITY = 0.45;

export function isBoardCentricPlan(
  archetype: Archetype,
  typeTargets: Record<string, number>,
  /** Reuses the EXACT E102 extra-combat commander gate (see
   *  deckGenerator.ts's `commanderWantsExtraCombat`: isExtraCombatPiece on
   *  the commander/partner OR commanderProfile's attack-trigger detector)
   *  rather than re-deriving a regex — a commander whose payoff is
   *  attacking is board-centric by definition. Defaults false for callers
   *  (tests, other call sites) that don't have the signal. */
  attackTriggerCommander: boolean = false
): boolean {
  if (attackTriggerCommander) return true;
  if (BOARD_CENTRIC_ARCHETYPES.has(archetype)) return true;
  const nonLandTotal = Object.values(typeTargets).reduce((s, v) => s + v, 0);
  if (nonLandTotal <= 0) return false;
  return (typeTargets.creature ?? 0) / nonLandTotal >= BOARD_CENTRIC_CREATURE_DENSITY;
}

// ─── Pacing Adjustments ─────────────────────────────────────────────
// Small secondary multipliers that fine-tune based on tempo.

export const PACING_ROLE_ADJUSTMENTS: Record<Pacing, Record<RoleKey, number>> = {
  'aggressive-early': { ramp: 1.1, removal: 0.9, boardwipe: 0.85, cardDraw: 0.9 },
  'fast-tempo': { ramp: 1.05, removal: 0.95, boardwipe: 0.9, cardDraw: 0.95 },
  midrange: { ramp: 1.0, removal: 1.0, boardwipe: 1.0, cardDraw: 1.0 },
  'late-game': { ramp: 0.9, removal: 1.05, boardwipe: 1.15, cardDraw: 1.1 },
  balanced: { ramp: 1.0, removal: 1.0, boardwipe: 1.0, cardDraw: 1.0 },
};

/** Multipliers for mana curve phases by pacing. Used by both generator and analyzer. */
export const PACING_CURVE_MULTIPLIERS: Record<
  Pacing,
  { early: number; mid: number; late: number }
> = {
  'aggressive-early': { early: 1.2, mid: 0.95, late: 0.75 },
  'fast-tempo': { early: 1.12, mid: 1.0, late: 0.82 },
  balanced: { early: 1.0, mid: 1.0, late: 1.0 },
  midrange: { early: 0.92, mid: 1.1, late: 0.95 },
  'late-game': { early: 0.85, mid: 0.95, late: 1.25 },
};

// ─── Pacing Estimation from EDHREC Stats ────────────────────────────

/**
 * Estimate pacing from EDHREC mana curve stats (before card selection).
 * Same thresholds as detectPacing() but computed from aggregate stats
 * without keyword analysis.
 */
export function estimatePacingFromStats(manaCurve: Record<number, number>): Pacing {
  const total = Object.values(manaCurve).reduce((s, v) => s + v, 0);
  if (total === 0) return 'balanced';

  const weightedCmc = Object.entries(manaCurve).reduce(
    (s, [cmc, count]) => s + Number(cmc) * count,
    0
  );
  const avgCmc = weightedCmc / total;

  let earlyCount = 0;
  let lateCount = 0;
  let midCount = 0;
  for (const [cmcStr, count] of Object.entries(manaCurve)) {
    const cmc = Number(cmcStr);
    if (cmc <= 2) earlyCount += count;
    else if (cmc >= 5) lateCount += count;
    else midCount += count;
  }

  const earlyPct = earlyCount / total;
  const latePct = lateCount / total;
  const midPct = midCount / total;

  if (avgCmc <= 2.5 && earlyPct >= 0.5) return 'aggressive-early';
  if (avgCmc <= 2.7 && earlyPct >= 0.42) return 'fast-tempo';
  if (avgCmc >= 3.8 || latePct >= 0.28) return 'late-game';
  if (avgCmc >= 2.8 && avgCmc < 3.8 && midPct >= 0.3) return 'midrange';
  return 'balanced';
}

// ─── Archetype Inference ────────────────────────────────────────────

// The build's archetype decides role targets (ARCHETYPE_ROLE_MULTIPLIERS),
// the type floor and the auto land count, so it's read before a card is
// picked. Precedence, highest first:
//  1. The user's first selected theme (`user-theme`).
//  2. The cards: the commander plus its EDHREC pool weighted by inclusion,
//     classified by the synergy axes and read by `readEngine`, the rule the
//     deck page applies to a finished list. A decisive engine decides
//     (`card-evidence`).
//  3. EDHREC's dominant theme, when the cards leave it room: it is one of the
//     comparable engines, or a strategy no axis reads in card text (ninjutsu,
//     extra combats). A dominant theme the cards can read but don't show is
//     dropped (`edhrec-dominant`).
//  4. The cards' leading engine when EDHREC's own leader agrees, though
//     neither clears its bar alone: two independent reads naming one strategy
//     (`card-evidence`).
//  5. Balanced Goodstuff when there's data but nothing leads (`neutral`).
//  6. The commander's oracle-text keyword vote when there's no EDHREC data at
//     all (`oracle-text`).
// EDHREC hand-tunes its theme pages, and a deck that is clearly a theme can
// miss the tag, so the list is a hint and the cards are the evidence.

// Share of the page's archetype-mapped taglink weight EDHREC's leading
// strategy must hold to be dominant. Themes that build the same strategy sum
// first (E417): Sram's Equipment, Voltron and Auras tags are one Voltron vote,
// not three competing ones. Value themes (Midrange, Goodstuff) never sum, the
// same rule `readEngine` applies to axes. The denominator counts only taglinks
// that resolve to an archetype, since flavor tags (Historic, Legends) don't
// compete as a strategy (NON_STRATEGY_THEMES). Calibrated per theme against
// the 10 panel commanders in E90: Atraxa's Infect 35.7% fails, Meren's
// Aristocrats 40.1% passes. Re-measured on the E511 vocabulary and summing
// (September 2026 pages): Atraxa's Aggro tags 28.7% and Edgar's typal tags
// 32.6% fail, Meren's graveyard family 40.5% and Krenko's typal 41.3% pass.
const DOMINANT_THEME_SHARE = 0.38;

/** EDHREC's leading strategy, with the themes that voted for it. */
export interface EdhrecThemeHint {
  archetype: Archetype;
  share: number;
  /** Holds {@link DOMINANT_THEME_SHARE} of the page's mapped weight. */
  dominant: boolean;
  /** The page's theme names behind it, in page order. */
  themeNames: string[];
}

/**
 * EDHREC's leading strategy on a commander page: the heaviest competitor by
 * summed taglink count, dominant or not. Goodstuff-mapped themes count toward
 * the denominator but never lead. Undefined when nothing maps.
 */
export function readEdhrecThemeHint(themes?: EDHRECTheme[]): EdhrecThemeHint | undefined {
  const entries = new Map<string, { archetype: Archetype; count: number; themeNames: string[] }>();
  let total = 0;
  for (const theme of themes ?? []) {
    const archetype = themeArchetype(theme.name);
    if (!archetype) continue;
    total += theme.count;
    const key = isSharpArchetype(archetype) ? archetype : `theme:${theme.name.toLowerCase()}`;
    const entry = entries.get(key) ?? { archetype, count: 0, themeNames: [] };
    entry.count += theme.count;
    entry.themeNames.push(theme.name);
    entries.set(key, entry);
  }
  let best: { archetype: Archetype; count: number; themeNames: string[] } | undefined;
  for (const entry of entries.values()) {
    if (entry.archetype === Archetype.GOODSTUFF) continue;
    // Strict: on a tie the page-order-first competitor keeps the lead.
    if (!best || entry.count > best.count) best = entry;
  }
  if (!best || total <= 0) return undefined;
  const share = best.count / total;
  return {
    archetype: best.archetype,
    share,
    dominant: share >= DOMINANT_THEME_SHARE,
    themeNames: best.themeNames,
  };
}

/** EDHREC's dominant strategy alone, or undefined when none dominates. */
export function inferArchetypeFromEdhrecThemes(themes?: EDHRECTheme[]): Archetype | undefined {
  const hint = readEdhrecThemeHint(themes);
  return hint?.dominant ? hint.archetype : undefined;
}

// ─── Card evidence ──────────────────────────────────────────────────

/** A card with the weight it carries in an engine read. */
export interface WeightedCard {
  card: CardLike;
  weight: number;
}

/**
 * Producer and payoff weight per synergy axis, through `axisMassFrom`, the
 * function the deck page reads a finished list with. At weight 1 per card
 * these are `analyzeDeckSynergy`'s counts. At inclusion weights they are the
 * expected counts in an average deck.
 */
export function weightedAxisMass(cards: readonly WeightedCard[]): AxisMass[] {
  const classified = cards.map(({ card }) => classifyCard(card));
  const entries: EngineEntry[] = cards.flatMap(({ weight }, i) => [
    ...classified[i].producers.map((p) => ({
      axis: p.axis,
      side: 'producer' as const,
      reason: p.reason,
      weight,
    })),
    ...classified[i].payoffs.map((o) => ({
      axis: o.axis,
      side: 'payoff' as const,
      reason: o.reason,
      weight,
    })),
  ]);
  // E511: members of the tribes the set's typal cards name are tribal fuel,
  // by the same capped rule analyzeDeckSynergy applies to a finished list.
  const membership = tribalMembership(
    cards.map(({ card, weight }, i) => ({ card, weight, ...classified[i] }))
  );
  for (const m of membership.members) {
    entries.push({
      axis: 'tribal',
      side: 'producer',
      reason: membership.reasonFor(m.tribe),
      weight: m.weight,
    });
  }
  return axisMassFrom(entries);
}

/** One card of the commander's EDHREC pool with its inclusion, in percent. */
export interface PoolEntry {
  name: string;
  inclusion: number;
}

/**
 * A pool that is what this commander's decks play: one of its own EDHREC
 * pages. The alternative generators' pools and the Scryfall fallback rank
 * cards by other means, and their inclusion is synthetic.
 */
export function isCommanderEdhrecPool(source: DeckDataSource | null | undefined): boolean {
  return (
    source === 'theme+bracket' ||
    source === 'theme' ||
    source === 'base+bracket' ||
    source === 'base'
  );
}

/**
 * What this commander's decks play: every nonland and land card on its EDHREC
 * page, deduped by name. Cards injected from elsewhere (a theme's tag page, a
 * similar commander's decks) are left out, since they aren't this
 * commander's decks.
 */
export function cardEvidencePool(data: EDHRECCommanderData): PoolEntry[] {
  const seen = new Set<string>();
  const out: PoolEntry[] = [];
  for (const card of [...data.cardlists.allNonLand, ...data.cardlists.lands]) {
    if (card.blendSource || seen.has(card.name)) continue;
    seen.add(card.name);
    out.push({ name: card.name, inclusion: card.inclusion });
  }
  return out;
}

/**
 * Minimum share of the pool's inclusion weight that must resolve to card text
 * before the average deck is read. Below it (a failed or partial fetch) the
 * read would describe the cards that happened to load, so there is no read.
 */
export const EVIDENCE_MIN_COVERAGE = 0.8;

export interface CardEvidence {
  read: EngineRead;
  /** Share of the pool's inclusion weight whose card text was read. */
  coverage: number;
}

/**
 * Read the average deck for this commander: the commander (and partner) at
 * weight 1, since they're in every deck, plus each pool card at its inclusion
 * as a fraction. `cards` holds the fetched card text, keyed by the pool's
 * names. Undefined when too little of the pool resolved to read it honestly.
 */
export function readCardEvidence(input: {
  commanders: readonly CardLike[];
  pool: readonly PoolEntry[];
  cards: ReadonlyMap<string, CardLike>;
}): CardEvidence | undefined {
  const weighted: WeightedCard[] = input.commanders.map((card) => ({ card, weight: 1 }));
  let total = 0;
  let resolved = 0;
  for (const entry of input.pool) {
    const weight = entry.inclusion / 100;
    if (!(weight > 0)) continue;
    total += weight;
    const card = getByCardName(input.cards, entry.name);
    if (!card) continue;
    resolved += weight;
    weighted.push({ card, weight });
  }
  if (total <= 0 || resolved / total < EVIDENCE_MIN_COVERAGE) return undefined;
  return { read: readEngine(weightedAxisMass(weighted)), coverage: resolved / total };
}

/**
 * Fetch the card text for the commander's own EDHREC pool and read it
 * (`readCardEvidence`). Undefined for any other pool, where inclusion is
 * synthetic or absent, and when there is no pool.
 */
export async function loadCardEvidence(input: {
  commanders: readonly CardLike[];
  data: EDHRECCommanderData | null | undefined;
  source: DeckDataSource | null | undefined;
  fetchCards: (names: string[]) => Promise<ReadonlyMap<string, CardLike>>;
}): Promise<CardEvidence | undefined> {
  if (!input.data || !isCommanderEdhrecPool(input.source)) return undefined;
  const pool = cardEvidencePool(input.data);
  if (pool.length === 0) return undefined;
  const cards = await input.fetchCards(pool.map((e) => e.name));
  return readCardEvidence({ commanders: input.commanders, pool, cards });
}

// ─── Build-archetype decision ───────────────────────────────────────

/**
 * The archetype implied by the user's FIRST selected theme, if it resolves to
 * one. Uses the theme's own `archetype` field if populated, else looks up its
 * name. Undefined (not GOODSTUFF) when nothing is selected or the name
 * resolves to nothing, so callers can tell "no signal" apart from "explicitly
 * resolved to GOODSTUFF".
 */
function firstSelectedThemeArchetype(selectedThemes?: ThemeResult[]): Archetype | undefined {
  const selected = (selectedThemes ?? []).filter((t) => t.isSelected);
  if (!selected.length) return undefined;
  return selected[0].archetype ?? themeArchetype(selected[0].name);
}

/**
 * Infer the archetype from the user's selected EDHREC themes. `fallback` is
 * used whenever the first selected theme resolves to nothing (or nothing is
 * selected): pass the archetype `decideBuildArchetype` settled from the cards
 * and EDHREC. Defaults to GOODSTUFF for callers with no fallback.
 */
export function inferArchetype(
  selectedThemes?: ThemeResult[],
  fallback: Archetype = Archetype.GOODSTUFF
): Archetype {
  return firstSelectedThemeArchetype(selectedThemes) ?? fallback;
}

/**
 * Whether a dominant hint may decide: the cards can't observe any of its
 * themes (no synergy axis reads ninjutsu or extra combats), or its archetype
 * is one of the engines the cards leave comparable. With no card read at all,
 * EDHREC is the only data and the hint stands, as it did before the cards
 * were read.
 */
function hintStands(hint: EdhrecThemeHint, evidence: CardEvidence | undefined): boolean {
  if (!evidence) return true;
  const observable = hint.themeNames.some((name) => themeAxes(name).length > 0);
  return !observable || isEngineContender(evidence.read, hint.archetype);
}

/** The deciding engine for the disclosure: the busiest real engine among the
 *  leader's axes, as expected counts. */
function evidenceOf(leader: ArchetypeMass): ArchetypeEvidence {
  const lead = leader.axes.find(isInvestedAxis) ?? leader.axes[0];
  return { axis: lead.axis, producers: lead.producers, payoffs: lead.payoffs };
}

/** The engine that decided a `card-evidence` archetype: one synergy axis's
 *  producer and payoff weight in the commander's average deck (expected
 *  counts, so fractional). */
export interface ArchetypeEvidence {
  axis: AxisKey;
  producers: number;
  payoffs: number;
}

export interface BuildArchetypeDecision {
  /** The archetype generation builds as. */
  archetype: Archetype;
  /** What the build falls back to without a user theme: pass it to
   *  `getDynamicRoleTargets` so its own `inferArchetype` lands on `archetype`. */
  fallback: Archetype;
  provenance: ArchetypeProvenance;
  /** Nothing but the neutral default or the keyword vote decided, and the user
   *  selected no theme. Softens the land-count note's copy. */
  isLowConfidence: boolean;
  /** For `card-evidence`: the engine that decided, as expected counts in the
   *  average deck. */
  evidence?: ArchetypeEvidence;
}

export function decideBuildArchetype(input: {
  selectedThemes?: ThemeResult[];
  edhrecThemes?: EDHRECTheme[];
  /** Undefined when the pool isn't EDHREC's or its card text didn't load. */
  cardEvidence?: CardEvidence;
  /** `commanderProfile.primaryArchetype`, the last resort. */
  oracleTextArchetype: Archetype;
}): BuildArchetypeDecision {
  const read = input.cardEvidence?.read;
  const decisive = read?.decisive;
  const leader = read ? engineLeader(read) : undefined;
  const hint = readEdhrecThemeHint(input.edhrecThemes);
  const hasData = (input.edhrecThemes?.length ?? 0) > 0 || !!input.cardEvidence;

  let fallback: Archetype;
  let provenance: ArchetypeProvenance;
  let evidence: ArchetypeEvidence | undefined;
  if (decisive) {
    fallback = decisive.archetype;
    provenance = 'card-evidence';
    evidence = evidenceOf(decisive);
  } else if (hint?.dominant && hintStands(hint, input.cardEvidence)) {
    fallback = hint.archetype;
    provenance = 'edhrec-dominant';
  } else if (leader && hint?.archetype === leader.archetype) {
    fallback = leader.archetype;
    provenance = 'card-evidence';
    evidence = evidenceOf(leader);
  } else if (hasData) {
    fallback = Archetype.GOODSTUFF;
    provenance = 'neutral';
  } else {
    fallback = input.oracleTextArchetype;
    provenance = 'oracle-text';
  }

  const userArchetype = firstSelectedThemeArchetype(input.selectedThemes);
  const anySelected = (input.selectedThemes ?? []).some((t) => t.isSelected);
  if (userArchetype !== undefined) {
    return { archetype: userArchetype, fallback, provenance: 'user-theme', isLowConfidence: false };
  }
  return {
    archetype: fallback,
    fallback,
    provenance,
    isLowConfidence: !anySelected && (provenance === 'neutral' || provenance === 'oracle-text'),
    evidence,
  };
}

// ─── Base Targets (format-only, backward compat) ────────────────────

export function getBaseRoleTargets(format: DeckSize): Record<RoleKey, number> {
  if (format >= 99) return { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 };
  if (format >= 60) return { ramp: 4, removal: 5, boardwipe: 2, cardDraw: 4 };
  if (format >= 40) return { ramp: 2, removal: 3, boardwipe: 1, cardDraw: 2 };
  const ratio = format / 99;
  return {
    ramp: Math.max(1, Math.round(10 * ratio)),
    removal: Math.max(1, Math.round(8 * ratio)),
    boardwipe: Math.max(0, Math.round(3 * ratio)),
    cardDraw: Math.max(1, Math.round(10 * ratio)),
  };
}

// ─── Dynamic Role Targets (the main export) ─────────────────────────

const ROLE_KEYS: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw'];

export function getDynamicRoleTargets(
  format: DeckSize,
  selectedThemes?: ThemeResult[],
  edhrecStats?: EDHRECCommanderStats,
  edhrecData?: EDHRECCommanderData | null,
  overrideBlendWeight?: number | null,
  overrideThreshold?: number | null,
  /** The archetype to build as when the user's first theme resolves to none:
   *  `decideBuildArchetype`'s `fallback` (the cards, EDHREC, or the
   *  commander's keyword vote). */
  primaryArchetype?: Archetype
): {
  targets: Record<RoleKey, number>;
  archetype: Archetype;
  pacing: Pacing;
  breakdown: Record<RoleKey, RoleTargetBreakdown>;
} {
  const base = getBaseRoleTargets(format);

  const archetype = inferArchetype(selectedThemes, primaryArchetype);
  const archetypeMults = ARCHETYPE_ROLE_MULTIPLIERS[archetype];

  const pacing: Pacing = edhrecStats?.manaCurve
    ? estimatePacingFromStats(edhrecStats.manaCurve)
    : 'balanced';
  const pacingMults = PACING_ROLE_ADJUSTMENTS[pacing];

  // EDHREC-derived counts (zero-filled when edhrecData is missing)
  const edhrecCounts = edhrecData
    ? computeEdhrecRoleTargets(edhrecData, overrideThreshold ?? EDHREC_INCLUSION_THRESHOLD)
    : null;

  const blendWeight = Math.min(1, Math.max(0, overrideBlendWeight ?? EDHREC_BLEND_WEIGHT));

  const result = {} as Record<RoleKey, number>;
  const breakdown = {} as Record<RoleKey, RoleTargetBreakdown>;
  let total = 0;

  for (const role of ROLE_KEYS) {
    const archetypeTarget = base[role] * archetypeMults[role];
    const blendedPrePacing = edhrecCounts
      ? blendWeight * edhrecCounts[role] + (1 - blendWeight) * archetypeTarget
      : archetypeTarget;
    const afterPacing = blendedPrePacing * pacingMults[role];

    const floor = role === 'boardwipe' ? 0 : 1;
    const finalCount = Math.max(floor, Math.round(afterPacing));
    result[role] = finalCount;
    total += finalCount;

    breakdown[role] = {
      edhrecCount: edhrecCounts ? edhrecCounts[role] : null,
      archetypeTarget: Math.round(archetypeTarget),
      pacingMultiplier: pacingMults[role],
      blended: finalCount,
    };
  }

  // Cap total to reasonable range (scaled by format)
  const maxTotal = Math.round(format * 0.35); // ~34 for 99
  const minTotal = Math.round(format * 0.28); // ~28 for 99

  if (total > maxTotal) {
    const scale = maxTotal / total;
    for (const role of ROLE_KEYS) {
      const floor = role === 'boardwipe' ? 0 : 1;
      result[role] = Math.max(floor, Math.round(result[role] * scale));
      breakdown[role].blended = result[role];
    }
  } else if (total < minTotal) {
    const scale = minTotal / total;
    for (const role of ROLE_KEYS) {
      const floor = role === 'boardwipe' ? 0 : 1;
      result[role] = Math.max(floor, Math.round(result[role] * scale));
      breakdown[role].blended = result[role];
    }
  }

  logger.debug(
    `[DeckGen] Dynamic role targets: archetype=${archetype}, pacing=${pacing}, blend=${blendWeight}`,
    result,
    `(total=${Object.values(result).reduce((s, v) => s + v, 0)}, edhrecCounts=${edhrecCounts ? JSON.stringify(edhrecCounts) : 'null'})`
  );

  return { targets: result, archetype, pacing, breakdown };
}
