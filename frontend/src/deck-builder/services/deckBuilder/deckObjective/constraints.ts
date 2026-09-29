/**
 * Hard constraints: predicates, never terms. A deck that breaks one is
 * infeasible whatever its score, and two infeasible decks compare by how far
 * they break (`magnitude`), so a local search can walk out of an infeasible
 * seed. Each check mirrors the rule deckInvariants.ts enforces on shipped
 * decks and reuses its helpers and the deckFilters predicates, so "legal" can
 * only mean one thing. What differs is deliberate: the invariant checker also
 * accepts a DISCLOSED break (a forced pick named in a note, a relaxation in
 * collectionRelaxedNames) because it judges a finished build with its report;
 * the objective judges a card list, and a list either keeps the user's
 * constraint or doesn't.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/card-text';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import {
  constrainsToCollection,
  exceedsMaxRarity,
  fitsColorIdentity,
  isDeadInIdentity,
  isOwnedBudgetExempt,
  isOwnedRarityExempt,
  notLegalForFormat,
} from '../deckFilters';
import { bracketCeilings, type BracketCeilings } from '../bracketGuard';
// ponytail: deckInvariants.ts value-imports deckGenerator.ts (for one
// constant), so wiring the objective INTO the generator would close an import
// cycle through this line — push normalizeCardName and copyLimit down into a
// leaf module (import-cycles.test.ts will say so) before the E513 search lands.
import { copyLimit, normalizeCardName } from '../deckInvariants';
import type { ConstraintViolation, ObjectiveContext, ObjectiveDeck } from './types';
import { isBasicLand, isLandCard } from './context';

function owns(names: ReadonlySet<string> | undefined, card: ScryfallCard): boolean {
  if (!names) return false;
  return names.has(card.name) || names.has(frontFaceName(card.name));
}

function priceOf(card: ScryfallCard, currency: 'USD' | 'EUR'): number | null {
  const raw = getCardPrice(card, currency);
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Owned share of the NONLAND cards, the basis the partial-owned target is set
 * on (deckInvariants check 18). Null when there is no collection.
 */
export function ownedShare(deck: ObjectiveDeck, ctx: ObjectiveContext): number | null {
  if (!ctx.ownedNames) return null;
  const spells = deck.cards.filter((c) => !isLandCard(c));
  if (spells.length === 0) return 100;
  return (100 * spells.filter((c) => owns(ctx.ownedNames, c)).length) / spells.length;
}

/** The first bracket-floor category a card falls in, as BracketGuard counts it. */
function bracketCategory(name: string, ctx: ObjectiveContext): keyof BracketCeilings | null {
  if (ctx.gameChangerNames.has(name) || ctx.gameChangerNames.has(frontFaceName(name)))
    return 'gameChangers';
  if (ctx.tags.isMassLandDenial(name)) return 'massLandDenial';
  if (ctx.tags.isExtraTurn(name)) return 'extraTurns';
  if (ctx.tags.isStaxPiece(name)) return 'stax';
  return null;
}

export function checkConstraints(
  deck: ObjectiveDeck,
  ctx: ObjectiveContext
): ConstraintViolation[] {
  const out: ConstraintViolation[] = [];
  const add = (v: ConstraintViolation) => out.push(v);
  const cz = ctx.customization;
  const cards = deck.cards;
  const currency = cz.currency ?? 'USD';
  const identity = [...ctx.colorIdentity];
  const owned = ctx.ownedNames;
  const ignoreOwnedBudget = !!(cz.ignoreOwnedBudget && owned);
  const ignoreOwnedRarity = !!(cz.ignoreOwnedRarity && owned);
  const ownedSet = owned as Set<string> | undefined;

  // Size: deckFormat 99 is the "100-card deck" sentinel.
  const format = cz.deckFormat ?? 99;
  const expected = (format === 99 ? 100 : format) - deck.commanders.length;
  if (cards.length !== expected) {
    add({
      check: 'size',
      magnitude: Math.abs(cards.length - expected),
      cards: [],
      detail: `${cards.length} cards, expected ${expected}`,
    });
  }

  // Singleton by front face ("A // B" and "A" are one card).
  const byFront = new Map<string, ScryfallCard[]>();
  for (const c of cards) {
    const key = normalizeCardName(frontFaceName(c.name));
    byFront.set(key, [...(byFront.get(key) ?? []), c]);
  }
  for (const group of byFront.values()) {
    const limit = Math.min(...group.map(copyLimit));
    if (group.length > limit) {
      add({
        check: 'singleton',
        magnitude: group.length - limit,
        cards: [group[0].name],
        detail: `${group[0].name} ×${group.length} (limit ${limit})`,
      });
    }
  }

  const offIdentity = cards.filter((c) => !fitsColorIdentity(c, identity));
  if (offIdentity.length) {
    add({
      check: 'identity',
      magnitude: offIdentity.length,
      cards: offIdentity.map((c) => c.name),
      detail: `outside [${identity.join('')}]`,
    });
  }
  const dead = cards.filter((c) => isDeadInIdentity(c, identity));
  if (dead.length) {
    add({
      check: 'dead-in-identity',
      magnitude: dead.length,
      cards: dead.map((c) => c.name),
      detail: 'discounts a colour the deck cannot cast',
    });
  }

  const commanderKeys = new Set(
    deck.commanders.map((c) => normalizeCardName(frontFaceName(c.name)))
  );
  const cmdIn99 = cards.filter((c) => commanderKeys.has(normalizeCardName(frontFaceName(c.name))));
  if (cmdIn99.length) {
    add({
      check: 'commander-in-99',
      magnitude: cmdIn99.length,
      cards: cmdIn99.map((c) => c.name),
      detail: 'the commander is also in the 99',
    });
  }

  const illegal = cards.filter((c) => !isBasicLand(c) && notLegalForFormat(c, cz.mtgFormat));
  if (illegal.length) {
    add({
      check: 'legality',
      magnitude: illegal.length,
      cards: illegal.map((c) => c.name),
      detail: `not legal in ${cz.mtgFormat ?? 'commander'}`,
    });
  }

  const banned = new Set<string>();
  for (const n of [...(cz.bannedCards ?? []), ...(cz.tempBannedCards ?? [])])
    banned.add(normalizeCardName(n));
  for (const list of cz.banLists ?? [])
    if (list.enabled) for (const n of list.cards) banned.add(normalizeCardName(n));
  const bannedIn = cards.filter(
    (c) =>
      banned.has(normalizeCardName(c.name)) || banned.has(normalizeCardName(frontFaceName(c.name)))
  );
  if (bannedIn.length) {
    add({
      check: 'banned',
      magnitude: bannedIn.length,
      cards: bannedIn.map((c) => c.name),
      detail: 'on a ban list',
    });
  }

  const seated = new Set<string>();
  for (const c of [...deck.commanders, ...cards]) {
    seated.add(normalizeCardName(c.name));
    seated.add(normalizeCardName(frontFaceName(c.name)));
  }
  // User must-includes only: combo-sourced temp picks skip by design.
  const missing = (cz.mustIncludeCards ?? []).filter(
    (n) => !banned.has(normalizeCardName(n)) && !seated.has(normalizeCardName(n))
  );
  if (missing.length) {
    add({
      check: 'must-include',
      magnitude: missing.length,
      cards: missing,
      detail: 'a must-include is not in the deck',
    });
  }

  const maxPrice = cz.maxCardPrice;
  if (maxPrice != null) {
    const over = cards.filter((c) => {
      if (isBasicLand(c)) return false;
      if (isOwnedBudgetExempt(c.name, ownedSet, ignoreOwnedBudget)) return false;
      const p = priceOf(c, currency);
      return p !== null && p > maxPrice;
    });
    if (over.length) {
      add({
        check: 'max-price',
        magnitude: over.length,
        cards: over.map((c) => c.name),
        detail: `over the ${maxPrice} ${currency} card cap`,
      });
    }
  }

  if (cz.deckBudget) {
    let spend = 0;
    for (const c of cards) {
      if (isBasicLand(c)) continue;
      if (isOwnedBudgetExempt(c.name, ownedSet, ignoreOwnedBudget)) continue;
      spend += priceOf(c, currency) ?? 0;
    }
    if (spend > cz.deckBudget) {
      add({
        check: 'budget',
        magnitude: Math.round((spend - cz.deckBudget) * 100) / 100,
        cards: [],
        detail: `spend ${spend.toFixed(2)} ${currency} > budget ${cz.deckBudget}`,
      });
    }
  }

  if (cz.maxRarity) {
    const rare = cards.filter(
      (c) =>
        !isBasicLand(c) &&
        !isOwnedRarityExempt(c.name, ownedSet, ignoreOwnedRarity) &&
        exceedsMaxRarity(c, cz.maxRarity ?? null)
    );
    if (rare.length) {
      add({
        check: 'rarity',
        magnitude: rare.length,
        cards: rare.map((c) => c.name),
        detail: `above ${cz.maxRarity}`,
      });
    }
  }

  if (cz.tinyLeaders) {
    const big = cards.filter((c) => !isLandCard(c) && (c.cmc ?? 0) > 3);
    if (big.length) {
      add({
        check: 'tiny-leaders',
        magnitude: big.length,
        cards: big.map((c) => c.name),
        detail: 'mana value over 3',
      });
    }
  }

  if (cz.arenaOnly) {
    const off = cards.filter((c) => !isBasicLand(c) && !c.games?.includes('arena'));
    if (off.length) {
      add({
        check: 'arena',
        magnitude: off.length,
        cards: off.map((c) => c.name),
        detail: 'not on Arena',
      });
    }
  }

  // Game Changers: the user's limit, then the target bracket's ceilings.
  const gcs = cards.filter((c) => bracketCategory(c.name, ctx) === 'gameChangers');
  const gcLimit =
    cz.gameChangerLimit === 'none'
      ? 0
      : cz.gameChangerLimit === 'unlimited' || cz.gameChangerLimit === undefined
        ? Infinity
        : cz.gameChangerLimit;
  if (gcs.length > gcLimit) {
    add({
      check: 'game-changers',
      magnitude: gcs.length - gcLimit,
      cards: gcs.map((c) => c.name),
      detail: `${gcs.length} Game Changers > limit ${gcLimit}`,
    });
  }
  const ceilings = bracketCeilings(cz.targetBracket);
  const byCategory = new Map<keyof BracketCeilings, string[]>();
  for (const c of cards) {
    const cat = bracketCategory(c.name, ctx);
    if (cat) byCategory.set(cat, [...(byCategory.get(cat) ?? []), c.name]);
  }
  for (const [cat, names] of byCategory) {
    const cap = ceilings[cat];
    if (names.length > cap) {
      add({
        check: 'bracket-ceiling',
        magnitude: names.length - cap,
        cards: names,
        detail: `${names.length} ${cat} > bracket ${cz.targetBracket} ceiling ${cap}`,
      });
    }
  }

  // Collection.
  const strategy = cz.collectionStrategy ?? 'full';
  if (owned && cz.collectionMode !== false && constrainsToCollection(strategy)) {
    const outsiders = [
      ...new Set(
        cards
          .filter((c) => !isBasicLand(c) && !owns(owned, c) && c.mustIncludeSource !== 'deck')
          .map((c) => c.name)
      ),
    ];
    if (outsiders.length) {
      add({
        check: 'collection',
        magnitude: outsiders.length,
        cards: outsiders,
        detail: `strategy ${strategy}: not owned`,
      });
    }
  } else if (owned && cz.collectionMode !== false && strategy === 'partial') {
    const share = ownedShare(deck, ctx) ?? 100;
    // The invariant checker's 5-point tolerance: the target is a share of
    // ~65 spells, so one card is ~1.5 points.
    const target = (cz.collectionOwnedPercent ?? 0) - 5;
    if (share < target) {
      const spells = deck.cards.filter((c) => !isLandCard(c)).length;
      add({
        check: 'owned-share',
        magnitude: Math.ceil(((target - share) / 100) * spells),
        cards: [],
        detail: `owned share ${share.toFixed(1)}% < ${target}%`,
      });
    }
  }

  return out;
}
