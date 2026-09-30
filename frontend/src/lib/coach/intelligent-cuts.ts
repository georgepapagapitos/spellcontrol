/**
 * Intelligent contextual cuts (E20).
 *
 * When a Commander deck is full (99/99) and the user adds a card, we have to cut
 * something to keep it legal. The old prompt offered a flat "weak slot" list —
 * the globally-weakest cards, unrelated to what you're adding (adding Young
 * Pyromancer offered Roaming Throne). This ranks cuts by how *related/replaceable*
 * they are to the card being added, across four signals:
 *
 *   - **Synergy-axis overlap** (the dominant signal) — the 23-axis oracle-text
 *     classifier. A token-maker relates to other token-makers even when the
 *     coarse 4-role tagger gives them no role. This is what makes the cut feel
 *     "related" rather than "globally weakest".
 *   - **Shared tagger role** (ramp / removal / boardwipe / cardDraw).
 *   - **Same primary card type** (creature ↔ creature).
 *   - **Similar mana cost / color overlap** — weak tiebreaks.
 *
 * It reuses the Coach's real per-card cut reasons (the optimizer's removals and
 * the cardFit misfits) instead of "weak slot", and never offers:
 *   - a card of the other slot type: a land makes room for a land, a spell for
 *     a spell (T171 lane L: 42 of 196 applied cuts traded a land for a spell or
 *     the reverse, because the flag list was read whatever the incoming type);
 *   - a premium card (premiumCards.ts) or a piece of a combo the deck has;
 *   - a card whose role is at or under its target, unless the add fills that
 *     same role and the role isn't short: a cut never opens a role gap, and an
 *     add that fills a gap never trades away another card in the same role
 *     (the collection panel's owned substitutes went in for a same-role cut,
 *     and the next pass traded them straight back);
 *   - for an add whose role is already met, a card of any other role: the
 *     swap stays inside the role instead of pushing it into surplus;
 *   - a card load-bearing for an engine the deck is invested in, unless the
 *     card being added reinforces that same engine (a true like-for-like swap).
 *
 * Pure & isomorphic-ish: only depends on the tagger/scryfall/synergy helpers.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import type { OptimizeCard } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import { ROLE_LABELS } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import type { MisfitSummary } from '@/deck-builder/services/deckBuilder/cardFit';
import { isPremiumCard } from '@/deck-builder/services/deckBuilder/premiumCards';
import {
  buildCommanderProfile,
  whyCardMatches,
} from '@/deck-builder/services/deckBuilder/commanderProfile';
import { roleIsIncidental } from '@/deck-builder/services/deckBuilder/incidentalRole';
import { isSurvivalPiece } from '@/deck-builder/services/deckBuilder/deckObjective/factsReading';
import { countsAsFinisher, getCardFacts } from '@/deck-builder/services/cardFacts';
import type { WinConditionAnalysis } from '@/deck-builder/services/winConditions/types';
import { isUtilityLand, landSlotMerit } from '@/deck-builder/services/deckBuilder/landUpgrades';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { isBasicLandName } from '@/lib/collection/allocations';
import { frontFaceName } from '@/lib/cards/card-text';
import {
  computeRoleCounts,
  countedRoleOf,
} from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import type { ComboMatch } from '@/types/combos';
import { analyzeDeckSynergy, type DeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { axisKeys, axisJaccard, sharedAxisNames, axisLabel } from './axis-overlap';
import { roleOf, primaryTypeOf, colorsOverlap } from './card-matching';
import { buildCutFactors, type WhyFactor } from './why-factors';

// Re-exported so existing import sites (`card-fit`, tests) stay stable now that the
// canonical definition lives in `card-matching`.
export { primaryTypeOf };

export interface CutCandidate {
  slotId: string;
  card: ScryfallCard;
}

export interface RankedCut {
  slotId: string;
  card: ScryfallCard;
  /** Plain-language "why this cut" for the row hint (the optimizer's real reason,
   *  or a relation-derived one when the card isn't flagged). */
  reason: string;
  /** True when this cut shares a role/type with the card being added — i.e. the
   *  swap reads as a genuine replacement, not just "cut your weakest card". */
  related: boolean;
  /** Grounded, tone-tagged breakdown behind `reason` (relatedness, play-rate)
   *  for the tappable <WhyBreakdown> disclosure. */
  factors: WhyFactor[];
}

/** The persisted analysis fields the ranker reads (a Deck carries all of them). */
export interface CutAnalysis {
  optimizeSwaps?: { removals: OptimizeCard[] };
  misfits?: MisfitSummary[];
  cardInclusionMap?: Record<string, number>;
  /** Role targets: a cut never takes a role below its target (see below). */
  roleTargets?: Record<string, number>;
  /** The staples the deck is missing, with their play rate here: the incoming
   *  card's inclusion when it is one of them. */
  gapAnalysis?: { name: string; inclusion: number }[];
  /** The commander(s), whose own abilities mark a card's role as incidental. */
  commander?: ScryfallCard | null;
  partnerCommander?: ScryfallCard | null;
  /** The deck's win paths: an alt-win card is a finisher, never an overlap cut. */
  winConditions?: Pick<WinConditionAnalysis, 'primary' | 'secondary'> | null;
}

export interface RankReplacementCutsParams {
  /** The card the user is adding (we cut to make room for it). */
  addCard: ScryfallCard;
  /** In-deck cards eligible to cut (caller excludes the commander/partner). */
  deckCards: CutCandidate[];
  /** The deck's persisted analysis: optimizer removals and misfits flag weak
   *  slots, the inclusion map marks this commander's staples. */
  analysis?: CutAnalysis;
  /** Optimizer removals, for callers without a whole analysis (merged with it). */
  removals?: OptimizeCard[];
  /**
   * The deck's synergy engine analysis, for the load-bearing cut guard. Optional:
   * when omitted it's derived from `deckCards` (cheap, pure). Pass a precomputed
   * one to avoid re-classifying every card on a hot path.
   */
  deckSynergy?: DeckSynergy;
  /** Fully assembled combos already present in the deck: their pieces are never offered. */
  inDeckCombos?: ComboMatch[];
  /** Max suggestions to return (default 8). */
  limit?: number;
  /** False when swapping this card out would break the deck's own settings
   *  (a partial collection deck's owned share, say): it is not offered. */
  keepsSettings?: (cut: ScryfallCard) => boolean;
  /**
   * The incoming card completes a combo. It isn't an upgrade inside a role, so
   * it always gets a cut: the least valuable card that isn't protected (a plan
   * card, an engine piece, a finisher, a survival piece, a staple, a piece of
   * another combo). A Bracket 4 Yuriko's Demonic Consultation, the missing
   * Thassa's Oracle piece, had no cut at all (T171 round 3).
   */
  completesCombo?: boolean;
}

/** EDHREC-style inclusion proxy (0–100, higher = more played) for sort tiebreaks
 *  when this commander's page doesn't list the card: the analyzer's rank formula. */
function inclusionOf(card: ScryfallCard, pageInclusion: number | undefined): number {
  if (pageInclusion != null) return pageInclusion;
  if (card.edhrec_rank != null) return Math.max(1, 100 - Math.floor(card.edhrec_rank / 100));
  return 50;
}

/** A land slot: the front face is a land (an MDFC spell//land fills a spell slot). */
function isLandSlot(card: ScryfallCard): boolean {
  return getFrontFaceTypeLine(card).toLowerCase().includes('land');
}

interface Flag {
  reason: string;
  /** The flagging engine's play rate for the card, when it had one. */
  inclusion?: number;
}

const nameKey = (name: string): string => frontFaceName(name).toLowerCase();

/**
 * The play rate of the least-played staple the analysis lists as missing: a
 * card played here at least that much would join the list the moment it's
 * cut, and Coach would suggest adding it straight back. A 0% row (an off-meta
 * pick) isn't listed for its play rate, so it sets no floor. Undefined when
 * the list has no played staple.
 */
export function missingStapleFloor(
  gaps: readonly { inclusion: number }[] | undefined
): number | undefined {
  const played = (gaps ?? []).map((g) => g.inclusion).filter((i) => i > 0);
  return played.length > 0 ? Math.min(...played) : undefined;
}

/** Why a card was flagged as weak: the optimizer's reason, else the misfit's first. */
function flagReasons(analysis: CutAnalysis, extra: OptimizeCard[]): Map<string, Flag> {
  const out = new Map<string, Flag>();
  for (const r of [...extra, ...(analysis.optimizeSwaps?.removals ?? [])]) {
    const key = r.name.toLowerCase();
    if (!out.has(key)) out.set(key, { reason: r.reason, inclusion: r.inclusion ?? undefined });
  }
  for (const m of analysis.misfits ?? []) {
    const key = m.name.toLowerCase();
    if (!out.has(key) && m.reasons[0])
      out.set(key, { reason: m.reasons[0].label, inclusion: m.inclusion });
  }
  return out;
}

function landCutReason(card: ScryfallCard, copies: number): string {
  if (isBasicLandName(card.name)) {
    const plural = /s$/i.test(card.name) ? card.name : `${card.name}s`;
    return copies > 1 ? `One of ${copies} ${plural}` : 'Basic land';
  }
  return 'Weakest land for this deck';
}

/**
 * Rank in-deck cards as replacement cuts for `addCard`, best-first.
 *
 * Only cards of the incoming card's slot type (land or spell) are candidates,
 * and never a premium card, a combo piece, a card whose role would drop below
 * its target, a staple the analysis still lists as missing (just added), or an
 * unflagged card played at least as much as the least-played missing staple
 * (Coach would suggest adding it straight back).
 * When the incoming card's role is at or over its target, the add is an
 * upgrade inside that role: the only cuts are strictly weaker cards of the
 * same counted role whose role isn't incidental to them, and the reason says
 * so ("Upgrade in ramp").
 *
 * Spells, best → worst:
 *  1. Flagged weak AND shares the add's role or engine — a real, on-theme swap.
 *  2. Flagged weak AND the same card type.
 *  3. Flagged weak, unrelated — a genuine weak slot (its real reason).
 *  4. Unflagged but related — relevant, though a fine card.
 *  5. Unflagged and unrelated, only when the incoming card is a staple played
 *     more here than it: the least-played card here first.
 * An unflagged card is never offered when it is played here at least as much
 * as the card coming in (when both play rates are known): that trades a
 * staple for a lesser card, and the next add would take the new card back
 * out. The caller's "pick another card" list still exposes every card. A card
 * that's load-bearing for an engine the deck is invested in is never suggested
 * unless the add reinforces that engine.
 *
 * Lands: flagged lands first, then the weakest for this deck (`landSlotMerit`),
 * the most-duplicated basic breaking ties. A land that does more than make mana
 * (`isUtilityLand`) is never offered.
 */
export function rankReplacementCuts({
  addCard,
  deckCards,
  analysis = {},
  removals = [],
  deckSynergy,
  inDeckCombos = [],
  limit = 8,
  keepsSettings,
  completesCombo = false,
}: RankReplacementCutsParams): RankedCut[] {
  const flagged = flagReasons(analysis, removals);
  const gapInclusion = new Map((analysis.gapAnalysis ?? []).map((g) => [g.name, g.inclusion]));
  const pageInclusion = (name: string): number | undefined =>
    analysis.cardInclusionMap?.[name] ?? gapInclusion.get(name);
  const addInclusion = pageInclusion(addCard.name);
  const comboPieces = new Set(
    inDeckCombos.flatMap((m) => m.combo.cards.map((c) => c.cardName.toLowerCase()))
  );
  const addIsLand = isLandSlot(addCard);
  const targets = analysis.roleTargets;
  const counts = targets ? computeRoleCounts(deckCards.map((d) => d.card)).roleCounts : {};
  const addCounted = countedRoleOf(addCard);
  const addFillsGap =
    !!targets && !!addCounted && (counts[addCounted] ?? 0) < (targets[addCounted] ?? 0);
  const opensGap = (card: ScryfallCard): boolean => {
    const role = targets ? countedRoleOf(card) : null;
    if (!role || targets?.[role] === undefined) return false;
    if ((counts[role] ?? 0) > targets[role]) return false; // over target: room to trim
    return role !== addCounted || addFillsGap;
  };
  // An add whose role is at or over its target is an upgrade inside that role
  // (T171 round 3). A cut from another role leaves the surplus where it was:
  // Boros Signet came in for Battle Angels of Tyr as "Excess Ramp" and ramp
  // stayed at 16/13. So the cut is a strictly weaker card of the same counted
  // role, and never one whose role is incidental to what it is (a commander's
  // attack-trigger payoff tagged ramp for its Treasure).
  const addRoleMet = !!addCounted && targets?.[addCounted] !== undefined && !addFillsGap;
  const profile = analysis.commander
    ? buildCommanderProfile(analysis.commander, analysis.partnerCommander)
    : null;
  const feedsCommander = (card: ScryfallCard): boolean =>
    !!profile && whyCardMatches(card, profile).length > 0;
  const addFeedsCommander = feedsCommander(addCard);
  const inRole = (card: ScryfallCard): boolean =>
    countedRoleOf(card) === addCounted && !roleIsIncidental(card, addCounted, profile);
  // A staple the analysis still lists as missing is in the deck now: the user
  // just added it, most likely on Coach's advice. Offering it as the next cut
  // undoes that move (a Bracket 4 Yuriko added Mockingbird, then the next add
  // cut it, in the T171 re-gate).
  const justAdded = new Set((analysis.gapAnalysis ?? []).map((g) => nameKey(g.name)));
  // The least-played staple the analysis lists as missing. An unflagged card
  // played here at least that much would join that list the moment it's cut,
  // and Coach would suggest adding it straight back (the T171 re-gate's second
  // pass re-suggested 32 such cuts, most of them 25 to 40% staples).
  const gapFloor = missingStapleFloor(analysis.gapAnalysis);

  // Never a cut, on any path: the card itself, a card of the other slot type,
  // a combo piece, a card just added, one the deck settings rule out, a premium card.
  const cuttable = ({ card }: CutCandidate): boolean =>
    card.name !== addCard.name &&
    isLandSlot(card) === addIsLand &&
    !comboPieces.has(card.name.toLowerCase()) &&
    !justAdded.has(nameKey(card.name)) &&
    !(keepsSettings && !keepsSettings(card)) &&
    !isPremiumCard(card, { inclusion: pageInclusion(card.name) });
  const eligible = deckCards.filter(
    (d) => cuttable(d) && !opensGap(d.card) && !(addRoleMet && !inRole(d.card))
  );

  if (addIsLand) return rankLandCuts(deckCards, eligible, flagged, limit);

  const addRole = roleOf(addCard);
  const addType = primaryTypeOf(addCard);
  const addCmc = addCard.cmc ?? 0;
  const addAxes = axisKeys(addCard);
  // Derive the engine analysis once if the caller didn't supply it.
  const deckSyn = deckSynergy ?? analyzeDeckSynergy(deckCards.map((d) => d.card));
  const investedAxes = new Set<string>(deckSyn.invested);
  const hasEngine = investedAxes.size > 0;
  const loadBearingOf = (card: ScryfallCard): boolean =>
    hasEngine && [...axisKeys(card)].some((k) => investedAxes.has(k.slice(0, k.indexOf(':'))));
  // A finisher (the card facts' counted finisher, the win-line reading's) or an
  // alt-win card: what the deck wins with is never an overlap cut. Starfield
  // of Nyx went as "Overlapping Enchantress" for a one-shot recursion spell.
  const altWins = new Set(
    [analysis.winConditions?.primary, ...(analysis.winConditions?.secondary ?? [])]
      .filter((w) => w?.category === 'alt-win')
      .flatMap((w) => w!.evidence)
  );
  const isFinisher = (card: ScryfallCard): boolean => {
    const facts = getCardFacts(card);
    return altWins.has(card.name) || (!!facts && countsAsFinisher(facts));
  };

  if (completesCombo) {
    const commanders = [analysis.commander, analysis.partnerCommander].filter(
      (c): c is ScryfallCard => !!c
    );
    const survival = (card: ScryfallCard): boolean => {
      const facts = getCardFacts(card);
      return !!facts && isSurvivalPiece(card, facts, commanders);
    };
    const pool = deckCards.filter(
      (d) =>
        cuttable(d) &&
        !feedsCommander(d.card) &&
        !loadBearingOf(d.card) &&
        !isFinisher(d.card) &&
        !survival(d.card)
    );
    // Keep every role at its target when the deck can; the combo still gets a cut when it can't.
    const inFloor = pool.filter((d) => !opensGap(d.card));
    return rankComboCuts(inFloor.length > 0 ? inFloor : pool, flagged, pageInclusion, limit);
  }

  type Scored = RankedCut & { tier: number; relScore: number; inclusion: number };
  const scored: Scored[] = [];

  for (const { slotId, card } of eligible) {
    const flag = flagged.get(card.name.toLowerCase());
    const flagReason = flag?.reason;

    const cardAxes = axisKeys(card);
    const shared = sharedAxisNames(addAxes, cardAxes);
    const sameAxis = shared.length > 0;
    const axisOverlap = axisJaccard(addAxes, cardAxes); // 0–1

    const sameRole = !!addRole && roleOf(card) === addRole;
    const sameType = !!addType && primaryTypeOf(card) === addType;
    const cmcClose = Math.abs((card.cmc ?? 0) - addCmc) <= 1;
    const colorClose = colorsOverlap(addCard, card);
    const related = sameAxis || sameRole || sameType;

    // Cut guard: don't propose trimming a card holding up one of the deck's
    // invested engines — unless the card being added plays that same engine, in
    // which case it's a legitimate like-for-like swap. (Reuses cardAxes rather
    // than re-classifying via isLoadBearing.)
    const loadBearing =
      hasEngine && [...cardAxes].some((k) => investedAxes.has(k.slice(0, k.indexOf(':'))));
    if (loadBearing && !sameAxis) continue;
    // A card that feeds the commander's own ability goes only for another that
    // does: Flawless Maneuver cut Drakuseth, an Isshin attack-trigger payoff,
    // as "Played in 13% of decklists" (T171 round 3).
    if (!addFeedsCommander && feedsCommander(card)) continue;

    // Axis overlap is the dominant relatedness signal (up to 6), then role, type,
    // color, cost. Mirrors the synergy-first weighting of the similar-cards scorer.
    const relScore =
      axisOverlap * 6 +
      (sameRole ? 4 : 0) +
      (sameType ? 2 : 0) +
      (colorClose ? 0.5 : 0) +
      (cmcClose ? 1 : 0);

    const candInclusion = pageInclusion(card.name);
    const playedLess =
      addInclusion !== undefined && (candInclusion === undefined || candInclusion < addInclusion);
    if (!flagReason && candInclusion !== undefined && addInclusion !== undefined && !playedLess)
      continue; // an unflagged card played here as much as the add stays
    if (!flagReason && candInclusion !== undefined && gapFloor !== undefined)
      if (candInclusion >= gapFloor) continue; // cut, it would head Coach's missing staples
    if (!flagReason && isFinisher(card)) continue; // what the deck wins with is no overlap
    // An upgrade replaces a strictly weaker card: played here less than the
    // add, or, when the add's play rate is unknown, flagged weak by the analysis.
    const weaker = addInclusion !== undefined ? (candInclusion ?? 0) < addInclusion : !!flagReason;
    if (addRoleMet && !weaker) continue;

    let tier: number;
    if (flagReason && (sameRole || sameAxis)) tier = 1;
    else if (flagReason && sameType) tier = 2;
    else if (flagReason) tier = 3;
    else if (related) tier = 4;
    else if (playedLess) tier = 5;
    else continue; // unflagged + unrelated, no evidence the add is better → not a suggestion

    const reason = addRoleMet
      ? `Upgrade in ${ROLE_LABELS[addCounted!].toLowerCase()}`
      : (flagReason ??
        (sameAxis
          ? `Overlapping ${axisLabel(shared[0])}`
          : sameRole
            ? 'Overlapping role'
            : sameType
              ? 'Overlapping type'
              : candInclusion === undefined
                ? "Not played in this commander's decks"
                : `Played in ${Math.round(candInclusion)}% of decklists`));

    const inclusion = candInclusion ?? inclusionOf(card, flag?.inclusion);
    const factors = buildCutFactors({
      sameAxis,
      axisLabel: sameAxis ? axisLabel(shared[0]) : undefined,
      sameRole,
      roleLabel: addRole ? ROLE_LABELS[addRole] : undefined,
      sameType,
      typeLabel: sameType ? addType : undefined,
      inclusion,
    });

    scored.push({ slotId, card, reason, related, factors, tier, relScore, inclusion });
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    // Related tiers favor the stronger relation first; tiers 3 and 5 are flat weakest-first lists.
    if (a.tier !== 3 && a.tier !== 5 && a.relScore !== b.relScore) return b.relScore - a.relScore;
    return a.inclusion - b.inclusion; // weaker (less-played) cut wins ties
  });

  return scored.slice(0, limit).map(({ slotId, card, reason, related, factors }) => ({
    slotId,
    card,
    reason,
    related,
    factors,
  }));
}

/** A combo completion's cuts: flagged weak first, then the least played here. */
function rankComboCuts(
  pool: CutCandidate[],
  flagged: Map<string, Flag>,
  pageInclusion: (name: string) => number | undefined,
  limit: number
): RankedCut[] {
  return pool
    .map(({ slotId, card }) => {
      const flag = flagged.get(card.name.toLowerCase());
      const played = pageInclusion(card.name);
      return {
        slotId,
        card,
        flagged: flag ? 0 : 1,
        // Off the commander's page reads as the least played.
        inclusion: played ?? -1,
        reason:
          flag?.reason ??
          (played === undefined
            ? "Not played in this commander's decks"
            : `Played in ${Math.round(played)}% of decklists`),
      };
    })
    .sort((a, b) => a.flagged - b.flagged || a.inclusion - b.inclusion)
    .slice(0, limit)
    .map(({ slotId, card, reason }) => ({ slotId, card, reason, related: false, factors: [] }));
}

function rankLandCuts(
  deckCards: CutCandidate[],
  eligible: CutCandidate[],
  flagged: Map<string, Flag>,
  limit: number
): RankedCut[] {
  // Judge each land's merit in the deck's own colors.
  const identity = new Set(deckCards.flatMap(({ card }) => card.color_identity ?? []));
  const copies = new Map<string, number>();
  for (const { card } of eligible) copies.set(card.name, (copies.get(card.name) ?? 0) + 1);

  const seen = new Set<string>();
  const scored = eligible
    .filter(({ card }) => !isUtilityLand(card))
    .filter(({ card }) => (seen.has(card.name) ? false : (seen.add(card.name), true)))
    .map(({ slotId, card }) => {
      const flagReason = flagged.get(card.name.toLowerCase())?.reason;
      return {
        slotId,
        card,
        flagged: flagReason ? 0 : 1,
        merit: landSlotMerit(card, identity),
        copies: copies.get(card.name) ?? 1,
        reason: flagReason ?? landCutReason(card, copies.get(card.name) ?? 1),
      };
    })
    .sort((a, b) => a.flagged - b.flagged || a.merit - b.merit || b.copies - a.copies);

  return scored.slice(0, limit).map(({ slotId, card, reason }) => ({
    slotId,
    card,
    reason,
    related: true,
    factors: [],
  }));
}
