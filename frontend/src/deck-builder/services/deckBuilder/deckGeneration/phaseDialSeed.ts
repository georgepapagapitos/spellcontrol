// Staples <-> Synergy dial, the part a player can see: at the ends the dial
// seats a set of cards up front instead of only re-weighting the ranking.
//
// Re-weighting alone moved nothing measurable. Measured 2026-09-24 on the
// 15-deck panel, the full Staples end took overlap with EDHREC's own average
// deck from 63.4% to 65.3%, and the full Synergy end took mean EDHREC synergy
// from 0.215 to 0.218: the deck's skeleton (role targets and caps, type quotas,
// the curve, combo boosts, the repair phases) decides far more than a card's
// score, so at "Staples" Kozilek still shipped without Thran Dynamo (90% of
// his decks) and Yuriko without Brainstorm (83%).
//
// So the ends name a concrete list, seated before the type passes the way
// multi-copy cards are (their type targets shrink around it), and every user
// cap still applies — a seed is a candidate, not a forced pick:
//   Staples (0)          every spell in EDHREC's average deck
//   Leaning staples      the average deck's spells played in over half of decks
//   Leaning synergy      the commander's strongest-synergy cards (a few)
//   Synergy (1)          its high-synergy cards (more of them)
// Balanced, the default, seats nothing: generation is byte-identical.
import { logger } from '@/lib/logger';
import type { ScryfallCard } from '@/deck-builder/types';
import { fetchAverageDeckSpells } from '@/deck-builder/services/edhrec/client';
import {
  getCardsByNames,
  getCardPrice,
  getFrontFaceTypeLine,
} from '@/deck-builder/services/scryfall/client';
import { categorizeCards } from '../categorize';
import {
  constrainsToCollection,
  fitsColorIdentity,
  notInCollection,
  violatesUserCaps,
} from '../deckFilters';
import type { BudgetTracker } from '../budgetTracker';
import type { BracketGuard } from '../bracketGuard';
import { markUsed, type GenerationState } from './state';

/** Leaning staples: an average-deck card has to be in more than half of decks. */
export const CORE_STAPLE_INCLUSION = 50;
/** Synergy seeds: [min EDHREC synergy, max cards] for each synergy stop. */
export const SYNERGY_SEED = { lean: [0.4, 10], full: [0.25, 20] } as const;
// ponytail: a flat share of the deck budget, not a per-slot plan. The seeds are
// the highest-value cards and get most of the money; the other 30% has to
// cover the lands and whatever the seeds leave open.
const SEED_BUDGET_SHARE = 0.7;

export interface DialSeedContext {
  colorIdentity: string[];
  budgetTracker: BudgetTracker | null;
  bracketGuard?: BracketGuard;
  isSaltBlocked?: (name: string) => boolean;
}

export interface DialSeedResult {
  /** Build-report line for when there was nothing to seed from. */
  note?: string;
  /** Per-card provenance for the seeded cards. */
  reasons: Map<string, string>;
  /** The build-report line, given how many of the targeted cards are in the
   *  FINAL deck. Taken at the end of generation, not here: later phases can
   *  still trim a seed (a land count that leaves no room for all 68 of an
   *  average deck's spells), and a count taken at seating time once claimed
   *  "68 of its 68 spells made it in" over a deck missing eight of them. */
  describe?: (inFinalDeck: (name: string) => boolean) => string | undefined;
}

const norm = (n: string) =>
  n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export async function dialSeedPhase(
  state: GenerationState,
  ctx: DialSeedContext
): Promise<DialSeedResult> {
  const reasons = new Map<string, string>();
  const brew = state.cfg.brewLevel;
  if (brew > 0.25 && brew < 0.75) return { reasons };

  const { commander, partnerCommander } = state.context;
  const label = partnerCommander
    ? `${commander.name} and ${partnerCommander.name}`
    : commander.name;
  const pool = state.edhrecData?.cardlists.allNonLand ?? [];
  const inclusionOf = new Map(pool.map((c) => [c.name, c.inclusion]));

  let names: string[];
  let reason: string;
  let describe: (present: number, total: number) => string;
  if (brew <= 0.25) {
    const avg = await fetchAverageDeckSpells(
      [commander.name, ...(partnerCommander ? [partnerCommander.name] : [])],
      {
        themeSlug: state.cfg.selectedThemesWithSlugs[0]?.slug,
        targetBracket: state.cfg.targetBracket,
        budgetOption: state.cfg.budgetOption,
      }
    );
    if (!avg) {
      return {
        reasons,
        note: `Couldn't load EDHREC's average deck for ${label}, so this build favored the most-played cards instead.`,
      };
    }
    const core = brew > 0;
    names = avg.names
      .filter((n) => !core || (inclusionOf.get(n) ?? 0) > CORE_STAPLE_INCLUSION)
      .sort((a, b) => (inclusionOf.get(b) ?? 0) - (inclusionOf.get(a) ?? 0));
    const page = avg.page === 'base' ? '' : ` ${avg.page === 'theme' ? 'theme' : avg.page}`;
    reason = core
      ? `In over half of EDHREC's ${commander.name} decks`
      : `In EDHREC's average ${commander.name} deck`;
    describe = (present, total) =>
      (core
        ? `Started from the ${total} cards played in over half of EDHREC's ${label} decks: ${present} are in this one.`
        : `Started from EDHREC's average${page} deck for ${label}: ${present} of its ${total} spells are in this one.`) +
      (present < total
        ? ' The rest were over your settings or lost their slot to the land count.'
        : '');
  } else {
    const [minSynergy, max] = brew >= 1 ? SYNERGY_SEED.full : SYNERGY_SEED.lean;
    names = pool
      .filter((c) => (c.synergy ?? 0) >= minSynergy)
      .sort((a, b) => (b.synergy ?? 0) - (a.synergy ?? 0))
      .slice(0, max)
      .map((c) => c.name);
    reason = `One of the cards ${commander.name} decks play far more than other decks do`;
    describe = (present) =>
      `Built around ${present} of ${label}'s highest-synergy cards, the ones its decks play far more than other decks in its colors.`;
  }
  if (names.length === 0) return { reasons };

  const resolved = await getCardsByNames(names, undefined, state.cfg.preferredSet, {
    arenaOnly: state.cfg.arenaOnly,
  });
  const byNorm = new Map<string, ScryfallCard>();
  for (const c of resolved.values()) {
    byNorm.set(norm(c.name), c);
    byNorm.set(norm(c.name.split(' // ')[0]), c);
  }

  const { collectionNames } = state.context;
  const deckBudget = state.cfg.deckBudget;
  let spent = 0;
  let seated = 0;
  let skipped = 0;
  for (const name of names) {
    const card = resolved.get(name) ?? byNorm.get(norm(name));
    if (!card) continue;
    if (state.usedNames.has(card.name)) {
      seated++; // already in the deck (a must-include or multi-copy card)
      continue;
    }
    const isGameChanger = state.gameChangerNames.has(card.name);
    const price = parseFloat(getCardPrice(card, state.cfg.currency) ?? '') || 0;
    const blocked =
      state.bannedCards.has(card.name) ||
      getFrontFaceTypeLine(card).toLowerCase().includes('land') ||
      !fitsColorIdentity(card, ctx.colorIdentity) ||
      violatesUserCaps(card, state.cfg, collectionNames) ||
      (constrainsToCollection(state.cfg.collectionStrategy) &&
        notInCollection(card.name, collectionNames)) ||
      (isGameChanger && state.gameChangerCount.value >= state.cfg.maxGameChangers) ||
      !!ctx.bracketGuard?.exceedsCeiling(card.name) ||
      !!ctx.isSaltBlocked?.(card.name) ||
      (deckBudget !== null && spent + price > deckBudget * SEED_BUDGET_SHARE);
    if (blocked) {
      skipped++;
      continue;
    }

    markUsed(state, card.name);
    card.isMustInclude = true;
    card.mustIncludeSource = 'dial';
    if (isGameChanger) {
      card.isGameChanger = true;
      state.gameChangerCount.value++;
    }
    ctx.bracketGuard?.record(card.name);
    ctx.budgetTracker?.deductCard(card);
    spent += price;
    const typeLine = getFrontFaceTypeLine(card).toLowerCase();
    if (typeLine.includes('creature')) state.categories.creatures.push(card);
    else if (typeLine.includes('planeswalker')) state.categories.utility.push(card);
    else categorizeCards([card], state.categories);
    const cmc = Math.min(Math.floor(card.cmc), 7);
    state.currentCurveCounts[cmc] = (state.currentCurveCounts[cmc] ?? 0) + 1;
    reasons.set(card.name, reason);
    seated++;
  }
  logger.debug(`[DeckGen] Dial seed: ${seated} seated, ${skipped} skipped`);
  const targeted = names.map((n) => (resolved.get(n) ?? byNorm.get(norm(n)))?.name ?? n);
  return {
    reasons,
    describe: (inFinalDeck) => {
      const present = targeted.filter(inFinalDeck).length;
      return present > 0 ? describe(present, targeted.length) : undefined;
    },
  };
}
