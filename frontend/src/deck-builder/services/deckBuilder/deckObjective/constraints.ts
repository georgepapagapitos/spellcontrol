/**
 * Hard constraints: predicates, never terms. A deck that breaks one is
 * infeasible whatever its score, and two infeasible decks compare by how far
 * they break (`magnitude`), so a local search can walk out of an infeasible
 * seed. Each check mirrors the rule deckInvariants.ts enforces on shipped
 * decks and reuses its helpers (cardIdentity.ts) and the deckFilters predicates, so "legal" can
 * only mean one thing. What differs is deliberate: the invariant checker also
 * accepts a DISCLOSED break (a forced pick named in a note, a relaxation in
 * collectionRelaxedNames) because it judges a finished build with its report;
 * the objective judges a card list, and a list either keeps the user's
 * constraint or doesn't.
 */
import type { DetectedCombo, ScryfallCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
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
import { estimateBracket, floorOf } from '../bracketEstimator';
import { copyLimit, normalizeCardName } from '../cardIdentity';
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
 * on (deckInvariants check 18). A must-include counts as owned: the user's
 * own pick is the one card that may break the share (E509 ruling). Null when
 * there is no collection.
 */
/**
 * Whether the deck's strategy makes every card owned, lands included: owned-only,
 * available, or a 100% share (Coach's rule, deck-settings-fit.ts, which can't be
 * imported from here: it is a React hook module). No card the user doesn't own
 * may come in then, whatever relaxation the generator shipped.
 */
export function requiresOwnedCards(ctx: ObjectiveContext): boolean {
  const cz = ctx.customization;
  if (!ctx.ownedNames || cz.collectionMode === false) return false;
  const strategy = cz.collectionStrategy ?? 'full';
  return (
    strategy === 'full' ||
    strategy === 'available' ||
    (strategy === 'partial' && (cz.collectionOwnedPercent ?? 0) >= 100)
  );
}

/** A card the collection holds (basic lands are always available). */
export function isOwnedCard(card: ScryfallCard, ctx: ObjectiveContext): boolean {
  return isBasicLand(card) || owns(ctx.ownedNames, card);
}

export function ownedShare(deck: ObjectiveDeck, ctx: ObjectiveContext): number | null {
  if (!ctx.ownedNames) return null;
  const spells = deck.cards.filter((c) => !isLandCard(c));
  if (spells.length === 0) return 100;
  const must = new Set(
    [...(ctx.customization.mustIncludeCards ?? [])].map((n) => normalizeCardName(n))
  );
  const counted = (c: ScryfallCard) =>
    owns(ctx.ownedNames, c) ||
    must.has(normalizeCardName(c.name)) ||
    must.has(normalizeCardName(frontFaceName(c.name)));
  return (100 * spells.filter(counted).length) / spells.length;
}

/**
 * Why ONE card may never be added under this context (the card-level rules
 * of `checkConstraints`: identity, legality, bans, rarity, card price, Arena,
 * Tiny Leaders, the owned-only strategies), or null when it may. Deck-level
 * rules (size, singleton, budget, Game Changer and bracket counts, owned
 * share) depend on the rest of the deck and are checked on the whole list.
 */
const NOT_A_DECK_CARD =
  /\b(?:Stickers|Attraction|Conspiracy|Scheme|Plane|Phenomenon|Vanguard|Dungeon|Emblem)\b/;

export function cardIneligibility(card: ScryfallCard, ctx: ObjectiveContext): string | null {
  const cz = ctx.customization;
  const identity = [...ctx.colorIdentity];
  const owned = ctx.ownedNames;
  const basic = isBasicLand(card);
  // Sticker sheets, Attractions and the like are legal to own, not to put in
  // the 99 (Wild Ogre Bupkis came in through an owned pool in the gate).
  if (NOT_A_DECK_CARD.test(card.type_line ?? '')) return 'not a card for the deck';
  if (!fitsColorIdentity(card, identity)) return 'outside the color identity';
  if (isDeadInIdentity(card, identity)) return 'discounts a color the deck cannot cast';
  if (!basic && notLegalForFormat(card, cz.mtgFormat)) return 'not legal in the format';
  const banned = new Set<string>();
  for (const n of [...(cz.bannedCards ?? []), ...(cz.tempBannedCards ?? [])])
    banned.add(normalizeCardName(n));
  for (const list of cz.banLists ?? [])
    if (list.enabled) for (const n of list.cards) banned.add(normalizeCardName(n));
  if (
    banned.has(normalizeCardName(card.name)) ||
    banned.has(normalizeCardName(frontFaceName(card.name)))
  )
    return 'banned';
  if (basic) return null;
  const ownedSet = owned as Set<string> | undefined;
  if (
    cz.maxRarity &&
    !isOwnedRarityExempt(card.name, ownedSet, !!(cz.ignoreOwnedRarity && owned)) &&
    exceedsMaxRarity(card, cz.maxRarity)
  )
    return `above ${cz.maxRarity}`;
  const budgetExempt = isOwnedBudgetExempt(card.name, ownedSet, !!(cz.ignoreOwnedBudget && owned));
  if ((cz.maxCardPrice != null || cz.deckBudget) && !budgetExempt) {
    const p = priceOf(card, cz.currency ?? 'USD');
    // With money on the line a card with no price can't be counted, so it
    // can't be added (deckFilters.exceedsMaxPrice rules the same): read as
    // free, it would slip past every budget.
    if (p === null) return 'no price under a budget';
    if (cz.maxCardPrice != null && p > cz.maxCardPrice) return 'over the card price cap';
  }
  if (cz.arenaOnly && !card.games?.includes('arena')) return 'not on Arena';
  if (cz.tinyLeaders && !isLandCard(card) && (card.cmc ?? 0) > 3) return 'mana value over 3';
  if (
    owned &&
    cz.collectionMode !== false &&
    constrainsToCollection(cz.collectionStrategy ?? 'full') &&
    !owns(owned, card)
  )
    return 'not owned';
  return null;
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

const key = (name: string) => normalizeCardName(name);

/** Complete combos from the context's set: every named piece in the deck or the command zone. */
export function completeCombos(deck: ObjectiveDeck, ctx: ObjectiveContext): DetectedCombo[] {
  const keys = new Set(
    [...deck.commanders, ...deck.cards].flatMap((c) => [key(c.name), key(frontFaceName(c.name))])
  );
  return (ctx.combos ?? []).filter(
    (c) =>
      c.cards.length >= 2 &&
      c.cards.every((n) => keys.has(key(n)) || keys.has(key(frontFaceName(n))))
  );
}

/**
 * The complete combos that actually work in this deck, the ones the value
 * terms may credit (combos, winline, tutors) and the trust region protects:
 *  - a Commander Spellbook line with an unnamed-card requirement (a template:
 *    the `--N` suffix of its id, "11-5261--41") counts only once the deck is
 *    known to meet it (`templatesSatisfied`, which the deck page resolves; the
 *    generator's EDHREC feed never says), so Narset's Reversal + Isochron
 *    Scepter is not a line on its own;
 *  - Tainted Pact exiles until it finds a second card of one name, so its
 *    lines need a library with no repeated name (a deck with 15 Islands
 *    stops at the second Island).
 * `completeCombos` stays the wider set: the bracket floor is a safety check
 * and counts any line that might be complete.
 */
export function viableCombos(deck: ObjectiveDeck, ctx: ObjectiveContext): DetectedCombo[] {
  let singleton: boolean | null = null;
  const isSingleton = () => {
    if (singleton === null) {
      const names = deck.cards.map((c) => c.name);
      singleton = new Set(names).size === names.length;
    }
    return singleton;
  };
  return completeCombos(deck, ctx).filter((c) => {
    if (/--/.test(c.comboId ?? '') && c.templatesSatisfied !== true) return false;
    if (c.cards.some((n) => n === 'Tainted Pact') && !isSingleton()) return false;
    return true;
  });
}

/**
 * The Game Changer names the bracket estimator should match for this deck:
 * the list names a double-faced card by its front face (Tergrid, God of
 * Fright), the deck by its full name, and the estimator compares names as
 * given, so a DFC Game Changer went uncounted in a rewritten dump.
 */
export function gameChangerNamesFor(deck: ObjectiveDeck, ctx: ObjectiveContext): Set<string> {
  const names = new Set(ctx.gameChangerNames);
  for (const c of [...deck.commanders, ...deck.cards]) {
    if (ctx.gameChangerNames.has(frontFaceName(c.name))) names.add(c.name);
  }
  return names;
}

/** The bracket the estimator's hard floors put the deck at (mass land denial, Game Changers, complete combos: its own predicates). */
export function bracketFloorOf(deck: ObjectiveDeck, ctx: ObjectiveContext): number {
  const names = [...deck.commanders, ...deck.cards].map((c) => c.name);
  const spells = deck.cards.filter((c) => !isLandCard(c));
  const avg = spells.length ? spells.reduce((s, c) => s + (c.cmc ?? 0), 0) / spells.length : 0;
  const estimate = estimateBracket(
    names,
    completeCombos(deck, ctx).map((c) => ({ ...c, isComplete: true })),
    avg,
    undefined,
    undefined,
    gameChangerNamesFor(deck, ctx),
    deck.commanders.map((c) => c.name)
  );
  return floorOf(estimate.hardFloors);
}

/** A combo hard floor above a numeric target bracket, as the bracket estimator reads the deck. */
function comboFloor(deck: ObjectiveDeck, ctx: ObjectiveContext): ConstraintViolation | null {
  const target = ctx.customization.targetBracket;
  if (typeof target !== 'number' || target >= 4) return null;
  const complete = completeCombos(deck, ctx);
  if (complete.length === 0) return null;
  const names = [...deck.commanders, ...deck.cards].map((c) => c.name);
  const spells = deck.cards.filter((c) => !isLandCard(c));
  const avg = spells.length ? spells.reduce((s, c) => s + (c.cmc ?? 0), 0) / spells.length : 0;
  const estimate = estimateBracket(
    names,
    complete.map((c) => ({ ...c, isComplete: true })),
    avg,
    undefined,
    undefined,
    gameChangerNamesFor(deck, ctx),
    deck.commanders.map((c) => c.name)
  );
  const over = estimate.hardFloors.filter((f) => f.bracket > target && /combo/i.test(f.reason));
  if (over.length === 0) return null;
  const top = Math.max(...over.map((f) => f.bracket));
  return {
    check: 'bracket-floor',
    magnitude: top - target,
    cards: [...new Set(complete.flatMap((c) => c.cards))],
    detail: `${over.map((f) => f.reason).join('; ')} > bracket ${target}`,
  };
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

  // One face name on two different cards (deckInvariants' face-name-collision,
  // #2157): Grave Researcher // Reanimate beside the sorcery Reanimate. The
  // invariant calls it SOFT, but a search that adds one has made the deck worse
  // by the generator's own measure, so a move may not.
  const faceOwners = new Map<string, Set<string>>();
  for (const c of cards) {
    if (isBasicLand(c)) continue;
    const front = normalizeCardName(frontFaceName(c.name));
    const faces = c.card_faces?.length ? c.card_faces.map((f) => f.name) : c.name.split(' // ');
    for (const face of faces) {
      const key = normalizeCardName(face);
      faceOwners.set(key, (faceOwners.get(key) ?? new Set()).add(front));
    }
  }
  for (const [face, fronts] of faceOwners) {
    if (fronts.size < 2) continue;
    add({
      check: 'face-name-collision',
      magnitude: 1,
      cards: cards
        .filter((c) => c.name.toLowerCase().includes(face.toLowerCase()))
        .map((c) => c.name),
      detail: `the name "${face}" is on ${fronts.size} different cards`,
    });
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
      detail: 'discounts a color the deck cannot cast',
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
    // Basics count too, as the invariant checker and the deck's total do.
    for (const c of cards) {
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

  // The combo floor: a bracket 2 or 3 target is a promise about combos, and
  // the per-card ceilings above can't see one (two ordinary cards make it).
  // Read by the app's own estimator, so the objective and the bracket badge
  // agree; in the first optimizer gate a bracket-2 Atraxa came out of the
  // search with two complete two-card combos, reading bracket 3.
  const floor = comboFloor(deck, ctx);
  if (floor) add(floor);

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
    // At least N% owned, exactly (E509 ruling): the invariant checker's
    // 5-point tolerance judges a finished build's report; a search moving one
    // card at a time can hold the line itself.
    const share = ownedShare(deck, ctx) ?? 100;
    const target = cz.collectionOwnedPercent ?? 0;
    if (share < target - 1e-9) {
      const spells = deck.cards.filter((c) => !isLandCard(c)).length;
      add({
        check: 'owned-share',
        magnitude: Math.ceil(((target - share) / 100) * spells - 1e-9),
        cards: [],
        detail: `owned share ${share.toFixed(1)}% < ${target}%`,
      });
    }
  }

  return out;
}
