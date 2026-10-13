// E1006: one generic "target missed" channel. The deck-invariant checker
// already knows when a number the user asked for did not come out; this turns
// those findings into data the build report and the post-generation sheet show
// first, instead of each miss growing its own bespoke note.
//
// Pure and late: it reads the finished deck and changes nothing about it.
import type { GeneratedDeck } from '@/deck-builder/types';
import type { TargetMiss } from '@/deck-builder/types/targetMiss';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { frontFaceName } from '@/lib/cards/card-text';
import { checkDeckInvariants, type InvariantCheck, type InvariantContext } from './deckInvariants';
import { constrainsToCollection, isOwnedBudgetExempt } from './deckFilters';
import { isDefaultLandCount } from './targetCounts';
import {
  countRepairSwapsToBasic,
  nonbasicShortfall,
  nonbasicShortfallReason,
  REASON_CLAUSE,
} from './deckGeneration/nonbasicShortfallNote';

/**
 * Every invariant check, and the user target it grades (null = not a number
 * the user typed). Typed as a Record so a new check cannot be added without
 * deciding which side it is on; the test walks this map.
 */
export const TARGET_OF_CHECK: Record<InvariantCheck, TargetMiss['key'] | null> = {
  count: null,
  singleton: null,
  'face-name-collision': null,
  'face-name-impostor': null,
  identity: null,
  'dead-in-identity': null,
  'commander-in-99': null,
  'commander-legality': null,
  legality: null,
  banned: null,
  // A forced pick the user chose over a cap carries its own override note.
  'must-include': null,
  'max-price': null,
  budget: 'budget',
  rarity: null,
  'tiny-leaders': null,
  arena: null,
  permanents: null,
  lands: 'lands',
  nonbasic: 'nonbasic',
  'land-in-spell-slot': null,
  'spell-in-land-slot': null,
  // Graded against the generator's own plan, not a typed number.
  'land-count': null,
  // Owned-only strategies are disclosed by collectionRelaxedNames; the partial
  // owned share is the typed target.
  collection: 'owned',
  roles: null,
  'report-roles': null,
  'report-subtypes': null,
  stats: null,
  'game-changers': null,
  'bracket-game-changers': null,
  'empty-buckets': null,
  'theme-fidelity': null,
  errors: null,
};

/** Why a deck ran out of spells and padded with basics, from what limited it. */
export function poolExhaustionCause(params: {
  collectionConstrains: boolean;
  hasScryfallQuery: boolean;
}): string {
  if (params.collectionConstrains) return 'your collection';
  if (params.hasScryfallQuery) return 'your Scryfall filter';
  return 'your budget and card limits';
}

/** Why the budget converge stopped over budget: the first clause of what it
 *  recorded (the price-data tail stays in budgetNote), else the pool that
 *  limited the swaps. Null when nothing says. */
function budgetCause(
  residual: string | undefined,
  ownedOnly: boolean,
  hasScryfallQuery: boolean
): string | null {
  const first = residual?.split('. ')[0]?.replace(/\.$/, '');
  if (first) return first;
  if (ownedOnly) return 'your collection has no cheaper card that fits';
  if (hasScryfallQuery) return 'your Scryfall filter has no cheaper card that fits';
  return null;
}

const isBasic = (c: { type_line: string }) => c.type_line.includes('Basic');

export function computeTargetMisses(
  deck: GeneratedDeck,
  ctx: InvariantContext,
  built: { effectiveNonBasicLandCount?: number; budgetResidualReason?: string } = {}
): TargetMiss[] {
  const flagged = new Set<TargetMiss['key']>();
  for (const v of checkDeckInvariants(deck, ctx)) {
    const key = TARGET_OF_CHECK[v.check];
    if (key) flagged.add(key);
  }
  const cz = ctx.customization;
  const lands = deck.categories.lands ?? [];
  const misses: TargetMiss[] = [];
  const owned = ctx.collectionNames;
  const ownedOnly = constrainsToCollection(cz.collectionStrategy ?? 'full') && !!owned;
  const cards = Object.values(deck.categories).flat();
  const currency = cz.currency ?? 'USD';

  let spend = 0;
  const exempt = !!(cz.ignoreOwnedBudget && owned);
  for (const c of cards) {
    if (isOwnedBudgetExempt(c.name, owned as Set<string> | undefined, exempt)) continue;
    const p = getCardPrice(c, currency);
    spend += p ? parseFloat(p) || 0 : 0;
  }

  if (flagged.has('nonbasic')) {
    const asked = built.effectiveNonBasicLandCount ?? cz.nonBasicLandCount;
    const short = nonbasicShortfall(lands, asked);
    if (short > 0) {
      const reason = nonbasicShortfallReason({
        short,
        repairSwaps: countRepairSwapsToBasic(deck.coherenceRepairs),
        cz,
        ownedOnly,
        spend,
      });
      misses.push({
        key: 'nonbasic',
        asked: Math.min(asked, lands.length),
        got: lands.filter((c) => !isBasic(c)).length,
        cause: REASON_CLAUSE[reason].replace(/\.$/, ''),
      });
    }
  }

  if (flagged.has('lands')) {
    // An untouched land count is the auto-tune's to move; a typed one is the ask.
    const planned = deck.composition?.lands ?? cz.landCount;
    const asked = isDefaultLandCount(cz) ? planned : cz.landCount;
    const got = lands.length;
    if (got !== asked) {
      let cause: string | null = null;
      if (got === planned) cause = 'the count is outside the range this deck size allows';
      else if (got > planned) {
        cause = `${poolExhaustionCause({
          collectionConstrains: ownedOnly,
          hasScryfallQuery: !!cz.scryfallQuery,
        })} left too few spells to fill the deck`;
      } else if (got < asked && ownedOnly && !deck.landCountNote) {
        // E1009: Sythis, owned-only, 8 free Forest and 8 free Plains, shipped 32
        // of 34 lands with no cause. The free basics and the owned nonbasics
        // that fit ran out, and the rest of the deck became spells. A land
        // count the generator explained itself (landCountNote) needs no second one.
        cause = 'your collection has too few lands that fit this deck';
      }
      misses.push({ key: 'lands', asked, got, cause });
    }
  }

  if (flagged.has('budget') && cz.deckBudget) {
    misses.push({
      key: 'budget',
      asked: cz.deckBudget,
      got: Math.round(spend * 100) / 100,
      cause: budgetCause(built.budgetResidualReason, ownedOnly, !!cz.scryfallQuery),
      currency,
    });
  }

  if (flagged.has('owned') && cz.collectionStrategy === 'partial' && owned) {
    const nonLand = cards.filter((c) => !/Land/.test(c.type_line.split(' // ')[0]));
    const held = nonLand.filter((c) => owned.has(c.name) || owned.has(frontFaceName(c.name)));
    const got = nonLand.length > 0 ? Math.round((100 * held.length) / nonLand.length) : 100;
    const asked = cz.collectionOwnedPercent ?? 0;
    if (got < asked) {
      const eligible = deck.partialOwnedEligibleCount;
      misses.push({
        key: 'owned',
        asked,
        got,
        cause:
          eligible !== undefined
            ? `only ${eligible} of your cards fit this deck`
            : "the cards you own don't fit the deck",
      });
    }
  }

  return misses;
}

/** One miss as a sentence: "Asked for 26 nonbasic lands, got 22, because …". */
export function describeTargetMiss(m: TargetMiss): string {
  const money = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: m.currency ?? 'USD' }).format(n);
  let head: string;
  switch (m.key) {
    case 'nonbasic':
      head = `Asked for ${m.asked} nonbasic ${m.asked === 1 ? 'land' : 'lands'}, got ${m.got}`;
      break;
    case 'lands':
      head = `Asked for ${m.asked} ${m.asked === 1 ? 'land' : 'lands'}, got ${m.got}`;
      break;
    case 'budget':
      head = `Budget of ${money(m.asked)}, deck costs ${money(m.got)}`;
      break;
    case 'owned':
      head = `Asked for ${m.asked}% of your own cards, got ${m.got}%`;
      break;
  }
  return m.cause ? `${head}: ${m.cause}.` : `${head}.`;
}
