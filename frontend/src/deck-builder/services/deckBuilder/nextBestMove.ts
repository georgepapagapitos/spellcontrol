import type { PlanScore, SubScoreKey } from './planScore';
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { DeckView } from '@/components/deck/DeckDisplay';
import type { ComboMatch } from '@/types/combos';
import type { WinConditionAnalysis } from '@/deck-builder/services/winConditions/types';

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
  /** After navigating to `navigateTo`, reveal a specific surface within that view.
   *  `'combos'` expands + scrolls the Power-tab Combos panel and opens its
   *  one-away tab; the lane ids expand + scroll the matching Tune intent lane. */
  focus?: NextBestMoveFocus;
}

/** Intent targets a move can deep-link to: the Power Combos panel, or one of the
 *  Tune intent lanes (so a within-Tune move opens the right lane). Includes
 *  'bracket-fit' for the third Tune lane (UX-313). */
export type NextBestMoveFocus =
  | 'combos'
  | 'fill-gaps'
  | 'upgrade'
  | 'budget'
  | 'collection'
  | 'bracket-fit';

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
  /** Live owned card names. When a role/synergy gap can be filled by a card the
   *  player already owns, the hero prefers it ("build it tonight" over "go buy").
   *  Re-derived live by the page — never the stale persisted `isOwned` snapshot. */
  ownedNames?: Set<string>;
  /** Win-condition analysis from detect.ts — drives the "no clear win condition" move. */
  winConditions?: WinConditionAnalysis;
  /** Whether Bracket Fit has card moves ready (bracketFit?.moves.length > 0). */
  bracketFitHasMoves?: boolean;
  /** Mirrors the Coach feed's "Owned only" toggle. When set, card-naming moves
   *  only name cards the player owns (role/synergy gaps fall back to generic
   *  advice; an unowned-only combo completion is dropped) so the hero never
   *  tells you to go buy a card while you've asked to see owned moves only. */
  ownedOnly?: boolean;
  /** Curve-derived land-count advice — the lands RoleHealth from
   *  lib/deck-analysis when its Karsten suggestion applied (commander deck,
   *  tagger ready, stable nonland sample). Absent → no land-count move. */
  landAdvice?: { count: number; suggested: number };
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
  strategy: 'tune',
  roles: 'tune',
  curve: 'stats',
  cardFit: 'tune',
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

/** Gap card matching `role` whose name isn't already claimed — preferring one
 *  the player already owns (owned-first), else the top (inclusion-ranked) match.
 *  Under `ownedOnly`, owned-first hardens to owned-only (unowned gaps drop out,
 *  so the move falls back to generic advice rather than naming a card to buy). */
function gapForRole(
  gapAnalysis: GapAnalysisCard[] | undefined,
  role: string,
  used: Set<string>,
  ownedNames?: Set<string>,
  ownedOnly?: boolean
): GapAnalysisCard | undefined {
  const matches =
    gapAnalysis?.filter(
      (g) =>
        g.role === role && !used.has(g.name) && (!ownedOnly || (ownedNames?.has(g.name) ?? false))
    ) ?? [];
  if (matches.length === 0) return undefined;
  return matches.find((g) => ownedNames?.has(g.name)) ?? matches[0];
}

/** Highest-synergy gap card whose name isn't already claimed — preferring one
 *  the player already owns (owned-first) among the positive-synergy candidates.
 *  Under `ownedOnly`, restricted to owned candidates only. */
function topSynergyGap(
  gapAnalysis: GapAnalysisCard[] | undefined,
  used: Set<string>,
  ownedNames?: Set<string>,
  ownedOnly?: boolean
): GapAnalysisCard | undefined {
  const positive =
    gapAnalysis
      ?.filter(
        (g) =>
          g.synergy > 0 && !used.has(g.name) && (!ownedOnly || (ownedNames?.has(g.name) ?? false))
      )
      .sort((a, b) => b.synergy - a.synergy) ?? [];
  return positive.find((g) => ownedNames?.has(g.name)) ?? positive[0];
}

/**
 * Pure, isomorphic ranking of deck-improvement moves. Walks the tiers in
 * priority order, dedupes by id and by recommended card name, and returns the
 * top 3. No React/DOM/network — safe on server and client.
 */
export function buildNextBestMoves(input: NextBestMoveInput): NextBestMove[] {
  const {
    planScore,
    roleCounts,
    roleTargets,
    gapAnalysis,
    cardCount,
    deckTarget,
    oneAwayCombos,
    ownedNames,
    winConditions,
    ownedOnly,
  } = input;

  const moves: NextBestMove[] = [];
  // Card names already claimed by a move — prevents two moves recommending the
  // same card across tiers.
  const usedCards = new Set<string>();

  // ── Tier 1: structural — no detectable win path ─────────────────────────
  if (winConditions?.noClearWinCondition) {
    moves.push({
      id: 'no-win-condition',
      tier: 1,
      title: 'Define a win condition',
      detail:
        'This deck has no clear path to victory. Add combo pieces, an infect package, a mill plan, or build around a dominant synergy to give the deck a win condition.',
      navigateTo: 'power',
    });
  }

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

  // ── Tier 2: mana base — land count vs the deck's own curve ──────────────
  // `suggested` is Karsten's formula computed from the real deck (see
  // lib/deck-analysis). Within ±1 is healthy; only a 2+ land gap earns a
  // hero slot so a one-land quibble never displaces a sharper move.
  if (input.landAdvice) {
    const { count, suggested } = input.landAdvice;
    const delta = suggested - count;
    if (delta >= 2) {
      moves.push({
        id: 'land-count',
        tier: 2,
        title: `Add ${delta} lands`,
        detail: `${count} lands is light for this curve — it wants ~${suggested}. Add ${delta} lands (basics are fine) to hit your land drops.`,
        navigateTo: 'stats',
      });
    } else if (delta <= -2) {
      moves.push({
        id: 'land-count',
        tier: 2,
        title: `Trim ${-delta} lands`,
        detail: `${count} lands is heavy for this curve — ~${suggested} is enough. Swap ${-delta} lands for spells to cut flood draws.`,
        navigateTo: 'stats',
      });
    }
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
        const gap = gapForRole(gapAnalysis, deficit.role, usedCards, ownedNames, ownedOnly);
        const owns = gap != null && (ownedNames?.has(gap.name) ?? false);
        moves.push({
          id: `roles-${deficit.role}`,
          tier: 2,
          title: `Add ${label}`,
          cardName: gap?.name,
          detail: gap
            ? owns
              ? `Light on ${label} (${deficit.current} of ${deficit.target}). You own ${gap.name} — add it tonight (in ${Math.round(gap.inclusion)}% of decks like this).`
              : `Light on ${label} (${deficit.current} of ${deficit.target}). Add ${gap.name} — in ${Math.round(gap.inclusion)}% of decks like this.`
            : `Light on ${label} (${deficit.current} of ${deficit.target}). Add more ${label} to hit the target.`,
          navigateTo: SUBSCORE_VIEW.roles,
          focus: 'fill-gaps',
        });
        if (gap) usedCards.add(gap.name);
        continue;
      }

      if (key === 'curve') {
        moves.push({
          id: 'curve',
          tier: 2,
          title: 'Fix the curve',
          detail: `${sub.surface} Adjust the mana curve to fill the underweight phase.`,
          navigateTo: SUBSCORE_VIEW.curve,
        });
        continue;
      }

      if (key === 'cardFit') {
        moves.push({
          id: 'cardfit',
          tier: 2,
          title: 'Tighten card fit',
          detail: `${sub.surface} Swap low-fit cards for stronger options.`,
          navigateTo: SUBSCORE_VIEW.cardFit,
          focus: 'upgrade',
        });
        continue;
      }

      if (key === 'strategy') {
        const gap = topSynergyGap(gapAnalysis, usedCards, ownedNames, ownedOnly);
        const owns = gap != null && (ownedNames?.has(gap.name) ?? false);
        moves.push({
          id: 'strategy',
          tier: 2,
          title: 'Reinforce the plan',
          cardName: gap?.name,
          detail: gap
            ? owns
              ? `${sub.surface} You own ${gap.name} (synergy +${gap.synergy.toFixed(2)}, in ${Math.round(gap.inclusion)}% of builds) — add it to lean into your strategy.`
              : `${sub.surface} Add ${gap.name} (synergy +${gap.synergy.toFixed(2)}, in ${Math.round(gap.inclusion)}% of builds) to lean into your strategy.`
            : `${sub.surface} Add more on-theme cards to lean into your strategy.`,
          navigateTo: SUBSCORE_VIEW.strategy,
          focus: 'upgrade',
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
      const partnerNames = match.combo.cards
        .filter((c) => c.oracleId !== missingId)
        .map((c) => c.cardName);
      const partnerStr =
        partnerNames.length <= 2
          ? partnerNames.join(' + ')
          : `${partnerNames.slice(0, 2).join(' + ')} +${partnerNames.length - 2} more`;
      const alreadyOwns = input.ownedNames?.has(missingName) ?? false;
      // Owned-only: can't complete this combo without buying — skip and keep
      // scanning for one the player can finish with cards in hand.
      if (ownedOnly && !alreadyOwns) continue;
      const detail = alreadyOwns
        ? `You already own ${missingName} — add it to complete ${partnerStr} → ${produces}.`
        : `Completes ${partnerStr} → ${produces}. Add ${missingName} to finish the combo.`;
      moves.push({
        id: `combo-${match.combo.id}`,
        tier: 3,
        title: `Add ${missingName}`,
        cardName: missingName,
        detail,
        navigateTo: 'power',
        focus: 'combos',
      });
      usedCards.add(missingName);
      break;
    }
  }

  // ── Tier 3: polish — bracket-fit (target set, moves exist) ──────────────
  if (input.bracketFitHasMoves && !moves.some((m) => m.focus === 'bracket-fit')) {
    moves.push({
      id: 'bracket-fit',
      tier: 3,
      title: 'Fit your bracket target',
      detail: 'Bracket Fit has card moves ready to close the gap to your target bracket.',
      navigateTo: 'tune',
      focus: 'bracket-fit',
    });
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
