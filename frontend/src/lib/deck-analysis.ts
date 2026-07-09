/**
 * Pure deck-analysis utilities — composition, role classification, and
 * format-aware deficit / excess detection. Distinct from the deck-builder's
 * `deckAnalyzer` (which is bound to the generator's pacing model and assumes
 * generator metadata is present). This module works on any deck the user
 * has in front of them by reading ScryfallCard payloads + the global tagger.
 */

import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { getCardRole, getAllCardRoles, type RoleKey } from '@/deck-builder/services/tagger/client';

export type RoleStatus = 'low' | 'ok' | 'high';

export interface RoleHealth {
  /** Stable identifier — used as React keys + i18n labels. */
  key: RoleKey | 'lands';
  label: string;
  count: number;
  /** Recommended range [min, max] given the deck's format. */
  range: [number, number];
  status: RoleStatus;
  /** Short verdict the user can read at a glance, e.g. "Add 3-5 more". */
  message: string;
  /** Slot ids contributing to this count, in deck order. */
  contributingSlotIds: string[];
  /** How many of `count` came only from the user's own card tags (cards the
   *  tagger missed). 0 when the tagger and the user's tags agree. */
  taggedCount: number;
}

export interface CurveBucket {
  /** Bucketed CMC. `7` is the open-ended "7+" bucket. */
  cmc: number;
  count: number;
}

export interface CurveAnalysis {
  buckets: CurveBucket[];
  averageCmc: number;
  /** Max non-land CMC; informs the verdict. */
  peak: number;
  verdict: 'top-heavy' | 'curve-ok' | 'low-curve';
  message: string;
}

export interface TypeBreakdown {
  creatures: number;
  instants: number;
  sorceries: number;
  artifacts: number;
  enchantments: number;
  planeswalkers: number;
  battles: number;
  lands: number;
  other: number;
}

export interface ColorIdentityCheck {
  commanderColors: string[];
  offColorCards: { slotId: string; cardName: string; offColors: string[] }[];
}

export interface DeckAnalysisInput {
  format: DeckFormat;
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null;
  /** `tags` = the user's functional tags on the slot (deck-card-tags.ts
   *  palette). Mapped tags count toward role health — see TAG_TO_ROLE. */
  mainboard: { slotId: string; card: ScryfallCard; tags?: string[] }[];
}

export interface DeckAnalysisResult {
  totalNonCommander: number;
  expectedSize: number;
  sizeDelta: number; // negative = under, positive = over
  types: TypeBreakdown;
  curve: CurveAnalysis;
  roles: RoleHealth[];
  colorIdentity: ColorIdentityCheck;
  /** True when tagger data is loaded; role counts use the tagger.
   *  When false, only lands / curve / types are meaningful. */
  taggerReady: boolean;
}

/**
 * Recommended role ranges by format. Numbers reflect the conventional
 * Commander deckbuilding advice (e.g. 8–12 ramp / 8–12 draw / 5–8 spot
 * removal / 2–4 wipes) and scale down for 60-card formats.
 */
function getRoleTargets(format: DeckFormat): Record<RoleKey | 'lands', [number, number]> {
  const cfg = DECK_FORMAT_CONFIGS[format];
  const isCommanderLike = cfg.hasCommander && cfg.mainboardSize >= 99;
  if (isCommanderLike) {
    return {
      lands: cfg.landRange ?? [35, 38],
      ramp: [8, 12],
      cardDraw: [8, 12],
      removal: [5, 8],
      boardwipe: [2, 4],
    };
  }
  // 60-card formats (standard / pauper / brawl)
  return {
    lands: cfg.landRange ?? [22, 26],
    ramp: [0, 4],
    cardDraw: [4, 8],
    removal: [3, 6],
    boardwipe: [1, 3],
  };
}

// Canonical role labels. `cardDraw` standardizes on "Card Advantage" to match
// lib/role-badges.ts ROLE_TITLES (the app-wide source of truth) — see the
// deck-analysis IA redesign. `removal`/`boardwipe` keep the analysis-specific
// "Spot removal"/"Board wipes" wording, which is deliberately more precise here
// than the generic ROLE_TITLES labels.
const ROLE_LABELS: Record<RoleKey | 'lands', string> = {
  lands: 'Lands',
  ramp: 'Ramp',
  cardDraw: 'Card Advantage',
  removal: 'Spot removal',
  boardwipe: 'Board wipes',
};

function statusFor(count: number, range: [number, number]): RoleStatus {
  if (count < range[0]) return 'low';
  if (count > range[1]) return 'high';
  return 'ok';
}

function messageFor(role: string, count: number, range: [number, number]): string {
  const [lo, hi] = range;
  if (count < lo) {
    const delta = lo - count;
    if (role === 'lands') {
      return `${delta} below the floor of ${lo} for this format.`;
    }
    return `Add ${delta}${count + 1 < hi ? `–${hi - count}` : ''} more — ${lo}–${hi} is healthy.`;
  }
  if (count > hi) {
    return `${count - hi} over the typical ceiling of ${hi}. Consider trimming for flex slots.`;
  }
  return `In the healthy ${lo}–${hi} range.`;
}

/**
 * Classify the type line into a single primary bucket. Honors split / DFC
 * cards by reading the front face only — Scryfall's `type_line` already
 * joins faces with " // ".
 */
function bucketType(card: ScryfallCard): keyof TypeBreakdown {
  const front = (card.type_line ?? '').split('//')[0].toLowerCase();
  if (front.includes('land')) return 'lands';
  if (front.includes('creature')) return 'creatures';
  if (front.includes('planeswalker')) return 'planeswalkers';
  if (front.includes('battle')) return 'battles';
  if (front.includes('instant')) return 'instants';
  if (front.includes('sorcery')) return 'sorceries';
  if (front.includes('artifact')) return 'artifacts';
  if (front.includes('enchantment')) return 'enchantments';
  return 'other';
}

function isLand(card: ScryfallCard): boolean {
  return bucketType(card) === 'lands';
}

/**
 * Bucket a card's CMC into the curve. Lands are excluded entirely (their
 * cmc is 0 but it doesn't reflect tempo). MDFCs land-flipping spells are
 * still counted by CMC since you'll usually cast them.
 */
function curveCmc(card: ScryfallCard): number | null {
  if (isLand(card)) return null;
  const raw = card.cmc;
  if (raw == null || Number.isNaN(raw)) return null;
  const rounded = Math.round(raw);
  return rounded > 7 ? 7 : Math.max(0, rounded);
}

function buildCurve(cards: ScryfallCard[]): CurveAnalysis {
  const buckets: CurveBucket[] = Array.from({ length: 8 }, (_, cmc) => ({ cmc, count: 0 }));
  let total = 0;
  let weighted = 0;
  let peak = 0;
  for (const card of cards) {
    const cmc = curveCmc(card);
    if (cmc == null) continue;
    buckets[cmc].count += 1;
    total += 1;
    weighted += cmc;
    if (cmc > peak) peak = cmc;
  }
  const averageCmc = total > 0 ? weighted / total : 0;
  // Verdict: bucket the average against rough thresholds. These match the
  // common rule of thumb that EDH curves should average ~3.0–3.5; below
  // ~2.5 suggests a fast deck (or a misclassified land base), above ~3.8
  // suggests a top-heavy deck likely to brick on opening hands.
  let verdict: CurveAnalysis['verdict'] = 'curve-ok';
  let message = `Average mana value ${averageCmc.toFixed(2)} — comfortable middle.`;
  if (averageCmc >= 3.8) {
    verdict = 'top-heavy';
    message = `Average mana value ${averageCmc.toFixed(2)} — top-heavy. Expect slow starts.`;
  } else if (averageCmc > 0 && averageCmc < 2.5) {
    verdict = 'low-curve';
    message = `Average mana value ${averageCmc.toFixed(2)} — fast deck. Make sure threats stay relevant late.`;
  }
  return { buckets, averageCmc, peak, verdict, message };
}

function buildTypes(cards: ScryfallCard[]): TypeBreakdown {
  const out: TypeBreakdown = {
    creatures: 0,
    instants: 0,
    sorceries: 0,
    artifacts: 0,
    enchantments: 0,
    planeswalkers: 0,
    battles: 0,
    lands: 0,
    other: 0,
  };
  for (const card of cards) {
    out[bucketType(card)] += 1;
  }
  return out;
}

function buildColorIdentityCheck(input: DeckAnalysisInput): ColorIdentityCheck {
  const commanderColors = new Set<string>();
  for (const c of input.commander?.color_identity ?? []) commanderColors.add(c);
  for (const c of input.partnerCommander?.color_identity ?? []) commanderColors.add(c);
  const colors = [...commanderColors];
  // No commander → no constraint to check.
  if (colors.length === 0) {
    return { commanderColors: colors, offColorCards: [] };
  }
  const offColorCards: ColorIdentityCheck['offColorCards'] = [];
  for (const { slotId, card } of input.mainboard) {
    const ci = card.color_identity ?? [];
    const off = ci.filter((c) => !commanderColors.has(c));
    if (off.length > 0) {
      offColorCards.push({ slotId, cardName: card.name, offColors: off });
    }
  }
  return { commanderColors: colors, offColorCards };
}

/**
 * User tags (deck-card-tags.ts palette) that map onto analysis roles.
 * Additive only: a tag fills a role the tagger missed for that card; it never
 * removes an auto-detected role. Interaction folds into removal alongside the
 * tagger's own counterspell/bounce subtypes. Wincon/Synergy/Setup/Payoff are
 * deck-plan intent with no role analog, so they don't count here.
 */
const TAG_TO_ROLE: Record<string, RoleKey> = {
  Ramp: 'ramp',
  Draw: 'cardDraw',
  Removal: 'removal',
  Interaction: 'removal',
};

/**
 * Compute deck role health using the tagger. Each non-land card is counted
 * once per role it matches (so a "Beast Within"-style ramp+removal hybrid
 * shows up in both buckets). Lands get their own dedicated count. The user's
 * own card tags also count (via TAG_TO_ROLE) — they're the user's read of the
 * card, so they apply even before the tagger loads.
 */
function buildRoles(input: DeckAnalysisInput, taggerReady: boolean): RoleHealth[] {
  const targets = getRoleTargets(input.format);
  const slotsByRole: Record<RoleKey | 'lands', string[]> = {
    lands: [],
    ramp: [],
    cardDraw: [],
    removal: [],
    boardwipe: [],
  };
  const taggedByRole: Record<RoleKey | 'lands', number> = {
    lands: 0,
    ramp: 0,
    cardDraw: 0,
    removal: 0,
    boardwipe: 0,
  };
  for (const { slotId, card, tags } of input.mainboard) {
    if (isLand(card)) {
      slotsByRole.lands.push(slotId);
      continue;
    }
    const autoRoles = taggerReady ? getAllCardRoles(card.name) : [];
    for (const role of autoRoles) {
      slotsByRole[role].push(slotId);
    }
    const taggedRoles = new Set<RoleKey>();
    for (const tag of tags ?? []) {
      const mapped = TAG_TO_ROLE[tag];
      if (mapped && !autoRoles.includes(mapped)) taggedRoles.add(mapped);
    }
    for (const role of taggedRoles) {
      slotsByRole[role].push(slotId);
      taggedByRole[role] += 1;
    }
  }
  const order: (RoleKey | 'lands')[] = ['lands', 'ramp', 'cardDraw', 'removal', 'boardwipe'];
  return order.map((key) => {
    const contributingSlotIds = slotsByRole[key];
    const count = contributingSlotIds.length;
    const range = targets[key];
    return {
      key,
      label: ROLE_LABELS[key],
      count,
      range,
      status: statusFor(count, range),
      message: messageFor(key, count, range),
      contributingSlotIds,
      taggedCount: taggedByRole[key],
    };
  });
}

export function analyzeDeck(input: DeckAnalysisInput, taggerReady: boolean): DeckAnalysisResult {
  const cards = input.mainboard.map((m) => m.card);
  const cfg = DECK_FORMAT_CONFIGS[input.format];
  const expectedSize = cfg.mainboardSize;
  return {
    totalNonCommander: cards.length,
    expectedSize,
    sizeDelta: cards.length - expectedSize,
    types: buildTypes(cards),
    curve: buildCurve(cards),
    roles: buildRoles(input, taggerReady),
    colorIdentity: buildColorIdentityCheck(input),
    taggerReady,
  };
}

/** Helper for the suggestions panel — returns the role keys the deck is
 *  *short* on, ordered by severity (largest deficit first). Excludes
 *  lands since EDHREC land recs are noisy without color-fixing info. */
export function getRoleDeficits(analysis: DeckAnalysisResult): (RoleKey | 'lands')[] {
  return analysis.roles
    .filter((r) => r.status === 'low' && r.key !== 'lands')
    .sort((a, b) => b.range[0] - b.count - (a.range[0] - a.count))
    .map((r) => r.key);
}

/**
 * Filter a candidate card name to the role buckets the deck most needs.
 * Used by the suggestions panel to surface a "Top picks for what you lack"
 * list. Returns the matched role key or null.
 */
export function classifyCandidate(cardName: string): RoleKey | null {
  return getCardRole(cardName);
}
