import type { PlanScore, SubScoreKey } from './planScore';
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { DeckView } from '@/components/deck/DeckDisplay';
import type { ComboMatch } from '@/types/combos';

/**
 * One ranked, data-grounded suggestion for the single highest-leverage change
 * to a Commander deck. Tier orders priority (1 = structural, 2 = weak sub-score,
 * 3 = polish); the UI shows at most the top 3.
 */
export interface NextBestMove {
  /** Stable identity — also the primary dedup key. */
  id: string;
  tier: 1 | 2 | 3;
  /** Short imperative headline, e.g. "Trim 2 cards". */
  title: string;
  /** Concrete, data-grounded explanation naming the role/phase/card/number. */
  detail: string;
  /** Named card the move recommends — second dedup key (one card, one move). */
  cardName?: string;
  /** Analysis view this move deep-links to. */
  navigateTo?: DeckView;
}

export interface NextBestMoveInput {
  /** Live PlanScore on the deck (deck.planScore). Tier-2 + limited-data note. */
  planScore?: PlanScore;
  /** Actual role counts (deck.roleCounts). */
  roleCounts: Record<string, number>;
  /** Target role counts (deck.roleTargets). */
  roleTargets: Record<string, number>;
  /** Ranked EDHREC upgrade candidates not in the deck (deck.gapAnalysis). */
  gapAnalysis?: GapAnalysisCard[];
  /** Current mainboard size (deck.cards.length). */
  cardCount: number;
  /** Target mainboard size, e.g. 99 (DECK_FORMAT_CONFIGS[format].mainboardSize). */
  deckTarget: number;
  /** Near-miss combos — the `oneAway` slice of ComboMatchResponse. */
  oneAwayCombos?: ComboMatch[];
}

/** Display labels for the functional roles (mirrors planScore's ROLE_LABELS). */
const ROLE_LABELS: Record<string, string> = {
  ramp: 'ramp',
  removal: 'removal',
  boardwipe: 'board wipes',
  cardDraw: 'card draw',
};

/** Sub-score → the analysis view that surfaces it. */
const SUBSCORE_VIEW: Record<SubScoreKey, DeckView> = {
  strategy: 'improve',
  roles: 'improve',
  tempo: 'mana',
  cardFit: 'improve',
};

const WEAK_THRESHOLD = 75;
const MAX_MOVES = 3;

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Lowest current/target ratio among roles that have a genuine deficit. */
function mostDeficitRole(
  roleCounts: Record<string, number>,
  roleTargets: Record<string, number>
): { role: string; current: number; target: number } | null {
  let worst: { role: string; current: number; target: number } | null = null;
  let worstRatio = Infinity;
  for (const [role, target] of Object.entries(roleTargets)) {
    if (target <= 0) continue;
    const current = roleCounts[role] ?? 0;
    if (current >= target) continue;
    const ratio = current / target;
    if (ratio < worstRatio) {
      worstRatio = ratio;
      worst = { role, current, target };
    }
  }
  return worst;
}

/** First gap card matching `role` whose name isn't already claimed. */
function gapForRole(
  gapAnalysis: GapAnalysisCard[] | undefined,
  role: string,
  used: Set<string>
): GapAnalysisCard | undefined {
  return gapAnalysis?.find((g) => g.role === role && !used.has(g.name));
}

/** Highest-synergy gap card whose name isn't already claimed. */
function topSynergyGap(
  gapAnalysis: GapAnalysisCard[] | undefined,
  used: Set<string>
): GapAnalysisCard | undefined {
  return gapAnalysis
    ?.filter((g) => g.synergy > 0 && !used.has(g.name))
    .sort((a, b) => b.synergy - a.synergy)[0];
}

/**
 * Pure, isomorphic ranking of deck-improvement moves. Walks the tiers in
 * priority order, dedupes by id and by recommended card name, and returns the
 * top 3. No React/DOM/network — safe on server and client.
 */
export function buildNextBestMoves(input: NextBestMoveInput): NextBestMove[] {
  const { planScore, roleCounts, roleTargets, gapAnalysis, cardCount, deckTarget, oneAwayCombos } =
    input;

  const moves: NextBestMove[] = [];
  // Card names already claimed by a move — prevents two moves recommending the
  // same card across tiers.
  const usedCards = new Set<string>();

  // ── Tier 1: structural — deck size vs target ────────────────────────────
  const excess = cardCount - deckTarget;
  if (excess > 0) {
    moves.push({
      id: 'size-over',
      tier: 1,
      title: `Trim ${excess} card${excess === 1 ? '' : 's'}`,
      detail: `Your deck has ${cardCount} cards, ${excess} over the ${deckTarget}-card target. Cut your weakest ${excess === 1 ? 'card' : 'cards'} to make the deck legal.`,
      navigateTo: 'deck',
    });
  } else if (excess < 0) {
    const short = -excess;
    moves.push({
      id: 'size-under',
      tier: 1,
      title: `Add ${short} card${short === 1 ? '' : 's'}`,
      detail: `Your deck has ${cardCount} cards, ${short} under the ${deckTarget}-card target. Fill the remaining ${short === 1 ? 'slot' : 'slots'} to complete the deck.`,
      navigateTo: 'deck',
    });
  }

  // ── Tier 2: quality — weakest non-partial sub-score < 75 ────────────────
  if (planScore) {
    const weak: Array<{ key: SubScoreKey; value: number }> = [];
    for (const key of Object.keys(planScore.subscores) as SubScoreKey[]) {
      const s = planScore.subscores[key];
      if (s.partial) continue;
      if (s.value < WEAK_THRESHOLD) weak.push({ key, value: s.value });
    }
    weak.sort((a, b) => a.value - b.value);

    for (const { key } of weak) {
      const sub = planScore.subscores[key];

      if (key === 'roles') {
        const deficit = mostDeficitRole(roleCounts, roleTargets);
        if (!deficit) continue;
        const label = roleLabel(deficit.role);
        const gap = gapForRole(gapAnalysis, deficit.role, usedCards);
        moves.push({
          id: `roles-${deficit.role}`,
          tier: 2,
          title: `Add ${label}`,
          cardName: gap?.name,
          detail: gap
            ? `Light on ${label} (${deficit.current} of ${deficit.target}). Add ${gap.name} — in ${Math.round(gap.inclusion)}% of decks like this.`
            : `Light on ${label} (${deficit.current} of ${deficit.target}). Add more ${label} to hit the target.`,
          navigateTo: SUBSCORE_VIEW.roles,
        });
        if (gap) usedCards.add(gap.name);
        continue;
      }

      if (key === 'tempo') {
        moves.push({
          id: 'tempo',
          tier: 2,
          title: 'Fix the curve',
          detail: `${sub.surface} Adjust the mana curve to smooth out your tempo.`,
          navigateTo: SUBSCORE_VIEW.tempo,
        });
        continue;
      }

      if (key === 'cardFit') {
        moves.push({
          id: 'cardfit',
          tier: 2,
          title: 'Tighten card fit',
          detail: `${sub.surface} Swap low-fit cards for stronger options on the Improve view.`,
          navigateTo: SUBSCORE_VIEW.cardFit,
        });
        continue;
      }

      if (key === 'strategy') {
        const gap = topSynergyGap(gapAnalysis, usedCards);
        moves.push({
          id: 'strategy',
          tier: 2,
          title: 'Reinforce the plan',
          cardName: gap?.name,
          detail: gap
            ? `${sub.surface} Add ${gap.name} (synergy +${gap.synergy.toFixed(2)}, in ${Math.round(gap.inclusion)}% of builds) to lean into your strategy.`
            : `${sub.surface} Add more on-theme cards to lean into your strategy.`,
          navigateTo: SUBSCORE_VIEW.strategy,
        });
        if (gap) usedCards.add(gap.name);
        continue;
      }
    }
  }

  // ── Tier 3: polish — near-miss combo (exactly 1 missing card) ───────────
  if (oneAwayCombos) {
    for (const match of oneAwayCombos) {
      if (match.missingOracleIds.length !== 1) continue;
      const missingId = match.missingOracleIds[0];
      const missingCard = match.combo.cards.find((c) => c.oracleId === missingId);
      const missingName = missingCard?.cardName;
      if (!missingName || usedCards.has(missingName)) continue;
      const produces = match.combo.produces[0] ?? 'a combo';
      moves.push({
        id: `combo-${match.combo.id}`,
        tier: 3,
        title: 'Complete a combo',
        cardName: missingName,
        detail: `You're one card from ${produces}. Add ${missingName} to complete the combo.`,
        navigateTo: 'power',
      });
      usedCards.add(missingName);
      break;
    }
  }

  // limited-data info note (tier 3)
  if (planScore?.limitedData) {
    moves.push({
      id: 'limited-data',
      tier: 3,
      title: 'Limited data',
      detail:
        'Some sub-scores were excluded due to limited EDHREC data — the score may shift as the deck fills out.',
    });
  }

  // ── Dedup (by id, then by cardName), stable tier sort, top 3 ────────────
  const seenIds = new Set<string>();
  const seenCards = new Set<string>();
  const deduped = moves.filter((m) => {
    if (seenIds.has(m.id)) return false;
    seenIds.add(m.id);
    if (m.cardName) {
      if (seenCards.has(m.cardName)) return false;
      seenCards.add(m.cardName);
    }
    return true;
  });
  deduped.sort((a, b) => a.tier - b.tier);
  return deduped.slice(0, MAX_MOVES);
}
