// E1116: give a role back the page card a build-around pick took the slot of.
//
// An off-page card a seed brings in can carry a counted role: Etherium
// Sculptor and Foundry Inspector read as ramp (cost reducers), so in Talrand
// they filled the ramp slots and Mind Stone (40% of Talrand decks) and
// Heraldic Banner never got one. The same trade cost Yuriko a Talisman and
// The Ur-Dragon its two-mana ramp. Making those picks roleless was tried and
// failed its panel: the freed slots went to weaker ramp in the earlier type
// passes, and the picks lost the role boost that seated them (The Ur-Dragon's
// package went from three cards to none).
//
// So this runs LAST, like the staple guarantee, and trades one card at a time:
// for each role-bearing pick, the role's best unseated page card comes in and
// the deck's weakest generic card goes out. Nothing upstream moves. Inert
// without build-around picks.
//
// Two limits, both from the first panel of this pass:
// - Only while the commander's own cards in the role are under the role's cap.
//   The picks themselves do not count: they are why the suite is short. Without
//   this The Ur-Dragon, already seven over its ramp target, got another dork.
// - The card going out is never protection, a theme or high-synergy card, a
//   land-side card, or a card the seeds lift. The lowest-inclusion roleless
//   card was Lightning Greaves twice, and Genji Glove in an equipment build.
import { getCardByName, isMdfcLand } from '@/deck-builder/services/scryfall/client';
import {
  getCardRole,
  isFreeInteraction,
  readsAsProtection,
  type RoleKey,
} from '@/deck-builder/services/tagger/client';
import { getByCardName } from '@/lib/cards/card-text';
import type { CoherenceRepair, DeckCategory, ScryfallCard } from '@/deck-builder/types';
import {
  constrainsToCollection,
  exceedsMaxPrice,
  fitsColorIdentity,
  isOwnedBudgetExempt,
  notInCollection,
  violatesUserCaps,
} from '../deckFilters';
import { categorizeCards, stampRoleSubtypes } from '../categorize';
import { isHighSynergyCard } from '../cardPicking';
import { roleCapLimit } from '../roleCapAllowance';
import { seedLift } from './buildAround';
import { evictionKeeper } from './evictionKeeper';
import { markBanned, markUsed, protectedMustIncludeNames, type GenerationState } from './state';

/** A page card worth trading a weak card for: in this share of the commander's decks. */
export const RESTORE_MIN_INCLUSION = 30;
/** The card going out has to be played this many points less than the one coming in. */
export const RESTORE_MIN_GAP = 10;
/** One trade per role-bearing pick, and no more than this many a build. */
export const RESTORE_MAX_SWAPS = 3;

const ROLE_WORD: Record<RoleKey, string> = {
  ramp: 'ramp',
  removal: 'removal',
  boardwipe: 'board wipe',
  cardDraw: 'card draw',
};

export async function seedRoleRestorePhase(
  state: GenerationState,
  roleTargets: Record<RoleKey, number> | null
): Promise<CoherenceRepair[]> {
  const { cfg, context, categories, usedNames } = state;
  const admits = state.seedAdmitInclusion;
  if (!admits || admits.size === 0 || !state.edhrecData) return [];
  // ponytail: skipped on a total budget, where every dollar is already spoken
  // for. Trade within the budget (price in <= price out) if budget builds want it.
  if (cfg.deckBudget != null) return [];

  const page = state.edhrecData.cardlists.allNonLand;
  const rows = new Map(page.map((c) => [c.name, c]));
  const inclusionOf = (name: string) => getByCardName(rows, name)?.inclusion ?? 0;
  const seeds = seedLift(state);
  // A card the page or the seeds single out is not generic, whatever its play rate.
  const singledOut = (card: ScryfallCard) => {
    const row = getByCardName(rows, card.name);
    return (
      (row ? isHighSynergyCard(row) : false) ||
      !!card.isThemeSynergyCard ||
      seeds.scoreOf(card.name) > 0 ||
      readsAsProtection(card) ||
      isFreeInteraction(card) ||
      isMdfcLand(card)
    );
  };
  const mustInclude = protectedMustIncludeNames(state);
  // The seeds are must-includes already; named here so the cut can never fall on one.
  const seedNames = new Set((cfg.buildAround ?? []).map((n) => n.toLowerCase()));
  const keeps = evictionKeeper(state);
  const held = () =>
    (Object.keys(categories) as DeckCategory[])
      .filter((category) => category !== 'lands')
      .flatMap((category) => categories[category].map((card) => ({ card, category })));

  // One claim per role-bearing pick still in the deck.
  const owed: RoleKey[] = [];
  for (const { card } of held()) {
    const role = admits.has(card.name) ? getCardRole(card.name) : null;
    if (role) owed.push(role);
  }

  const repairs: CoherenceRepair[] = [];
  for (const role of owed) {
    if (repairs.length >= RESTORE_MAX_SWAPS) break;
    // The commander's own cards in the role, the picks left out.
    const own = held().filter(
      ({ card }) => !admits.has(card.name) && getCardRole(card.name) === role
    ).length;
    const target = roleTargets?.[role];
    if (target == null || own >= roleCapLimit(target)) continue;
    const incoming = page
      .filter(
        (c) =>
          c.inclusion >= RESTORE_MIN_INCLUSION &&
          !usedNames.has(c.name) &&
          !state.bannedCards.has(c.name) &&
          getCardRole(c.name) === role &&
          !(
            constrainsToCollection(cfg.collectionStrategy) &&
            notInCollection(c.name, context.collectionNames)
          )
      )
      .sort((a, b) => b.inclusion - a.inclusion || a.name.localeCompare(b.name))[0];
    if (!incoming) continue;

    // The weakest card nothing protects and no role counts on.
    const victim = held()
      .filter(
        ({ card }) =>
          !mustInclude.has(card.name.toLowerCase()) &&
          !seedNames.has(card.name.toLowerCase()) &&
          !admits.has(card.name) &&
          !cfg.ownedQuotaProtects?.(card.name) &&
          !keeps(card) &&
          !getCardRole(card.name) &&
          !singledOut(card) &&
          inclusionOf(card.name) + RESTORE_MIN_GAP <= incoming.inclusion
      )
      .sort(
        (a, b) =>
          inclusionOf(a.card.name) - inclusionOf(b.card.name) ||
          a.card.name.localeCompare(b.card.name)
      )[0];
    if (!victim) continue;

    let card: ScryfallCard;
    try {
      card = await getCardByName(incoming.name, cfg.arenaOnly);
    } catch {
      continue;
    }
    if (
      !fitsColorIdentity(card, context.colorIdentity) ||
      violatesUserCaps(card, cfg, context.collectionNames) ||
      (!isOwnedBudgetExempt(card.name, context.collectionNames, cfg.ignoreOwnedBudget) &&
        exceedsMaxPrice(card, cfg.maxCardPrice, cfg.currency))
    )
      continue;

    categories[victim.category] = categories[victim.category].filter((c) => c !== victim.card);
    usedNames.delete(victim.card.name);
    markBanned(state, victim.card.name);
    markUsed(state, card.name);
    categorizeCards([card], categories);
    state.currentRoleCounts[role]++;
    card.deckRole = role;
    stampRoleSubtypes(card);
    repairs.push({
      cut: victim.card.name,
      added: card.name,
      reason: `Swapped ${victim.card.name} for ${card.name}: a card brought in for the cards you named took a ${ROLE_WORD[role]} slot, and ${card.name} is in ${Math.round(incoming.inclusion)}% of this commander's decks.`,
    });
  }
  return repairs;
}
