// Deck-generation invariants (E508): a pure checker over the REAL GeneratedDeck.
//
// The settings stress sweep used to scan lossy JSON dumps with a private,
// hand-run Python script (stress-scan.py), so nothing enforced what it found.
// This module is that scanner, ported check for check, plus the checks it
// lacked, each grounded in a bug that shipped:
//
//   face-name-collision / face-name-impostor (#2157): Scryfall's `!"Brainstorm"`
//     also matched Harmonized Trio // Brainstorm, and decks shipped the
//     impostor in place of the card they asked for (sometimes twice).
//   land-in-spell-slot / land-count (E485): repair phases seated utility lands
//     (Karn's Bastion, Eldrazi Temple) into spell slots and shipped decks over
//     their tuned land count.
//   report-roles (E166): the build report said one fewer wipe than the deck
//     had, because the shipped count came from a different role source.
//   singleton across name forms: "A // B" and "A" are the same card.
//
// HARD = the deck is wrong (a user setting broken, an illegal or duplicated
// card, a report that lies about the deck). SOFT = worth a human look, but a
// documented, disclosed, or by-design outcome. The checker never throws and
// never mutates the deck; it runs in the mocked CI suites
// (deckGenerator.golden/settings tests) and per deck in the live harness.
import type {
  Customization,
  DeckCategory,
  GeneratedDeck,
  ScryfallCard,
} from '@/deck-builder/types';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { frontFaceName } from '@/lib/card-text';
import { computeRoleCounts } from './commanderDeckAnalysis';
import {
  constrainsToCollection,
  exceedsMaxRarity,
  isDeadInIdentity,
  isOwnedBudgetExempt,
  isOwnedRarityExempt,
} from './deckFilters';
import { bracketCeilings } from './bracketGuard';
import { POOL_EXHAUSTION_LAND_THRESHOLD } from './deckGenerator';

export type InvariantLevel = 'HARD' | 'SOFT';

export type InvariantCheck =
  | 'count'
  | 'singleton'
  | 'face-name-collision'
  | 'face-name-impostor'
  | 'identity'
  | 'dead-in-identity'
  | 'commander-in-99'
  | 'legality'
  | 'banned'
  | 'must-include'
  | 'max-price'
  | 'budget'
  | 'rarity'
  | 'tiny-leaders'
  | 'arena'
  | 'permanents'
  | 'lands'
  | 'nonbasic'
  | 'land-in-spell-slot'
  | 'spell-in-land-slot'
  | 'land-count'
  | 'collection'
  | 'roles'
  | 'report-roles'
  | 'report-subtypes'
  | 'stats'
  | 'game-changers'
  | 'bracket-game-changers'
  | 'empty-buckets'
  | 'errors';

export interface InvariantViolation {
  level: InvariantLevel;
  check: InvariantCheck;
  detail: string;
}

/**
 * What the deck was built under. `GenerationContext` satisfies this directly,
 * so a caller holding the context it passed to generateDeck passes it as is.
 */
export interface InvariantContext {
  /** Defaults to `deck.commander` / `deck.partnerCommander`. */
  commander?: ScryfallCard | null;
  partnerCommander?: ScryfallCard | null;
  colorIdentity: readonly string[];
  customization: Customization;
  collectionNames?: ReadonlySet<string>;
  /**
   * Every name the generator could have asked Scryfall for by name: the
   * EDHREC pool it read, plus must-includes. Enables `face-name-impostor`,
   * which needs to know that "Brainstorm" was wanted to tell that
   * "Harmonized Trio // Brainstorm" was not. A name missing from this set can
   * only hide an impostor, never invent one, so a partial pool is safe.
   */
  requestedNames?: Iterable<string>;
}

// ── Name helpers ────────────────────────────────────────────────────────────

/** Case/punctuation/diacritic-insensitive name key. Mirrors the generator's
 *  must-include `normalizeName` (deckGenerator.ts), plus diacritics, so
 *  "Lim-Dûl" and "Lim-Dul" agree. */
export function normalizeCardName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function faceNames(card: ScryfallCard): string[] {
  if (card.card_faces && card.card_faces.length >= 2) return card.card_faces.map((f) => f.name);
  return card.name.split(' // ');
}

function frontTypeLine(card: ScryfallCard): string {
  if (card.card_faces && card.card_faces.length >= 2 && card.card_faces[0]?.type_line) {
    return card.card_faces[0].type_line;
  }
  return card.type_line || '';
}

function isBasic(card: ScryfallCard): boolean {
  return /\bBasic\b/.test(frontTypeLine(card));
}

function frontIsLand(card: ScryfallCard): boolean {
  return /\bLand\b/.test(frontTypeLine(card));
}

/** Any face is a land (an MDFC spell // land counts). */
function anyFaceIsLand(card: ScryfallCard): boolean {
  if (card.card_faces && card.card_faces.length >= 2) {
    return card.card_faces.some((f) => /\bLand\b/.test(f.type_line ?? ''));
  }
  return /\bLand\b/.test(card.type_line || '');
}

function oracleText(card: ScryfallCard): string {
  return [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)]
    .filter(Boolean)
    .join('\n');
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

/**
 * How many copies the card's own oracle text allows: "A deck can have any
 * number of cards named X" (Relentless Rats) or "up to seven" (Seven
 * Dwarves). Read from the card itself rather than a hard-coded list, the same
 * way the generator's multi-copy pipeline detects them.
 */
export function copyLimit(card: ScryfallCard): number {
  if (isBasic(card)) return Infinity;
  const text = oracleText(card).toLowerCase();
  if (text.includes('a deck can have any number of cards named')) return Infinity;
  const m = /a deck can have up to (\w+) cards named/.exec(text);
  if (m) {
    const n = NUMBER_WORDS[m[1]] ?? parseInt(m[1], 10);
    return Number.isFinite(n) ? n : Infinity;
  }
  return 1;
}

// ── Deck helpers ────────────────────────────────────────────────────────────

interface Seated {
  card: ScryfallCard;
  category: DeckCategory;
}

function seatedCards(deck: GeneratedDeck): Seated[] {
  const out: Seated[] = [];
  for (const [category, cards] of Object.entries(deck.categories) as [
    DeckCategory,
    ScryfallCard[],
  ][]) {
    for (const card of cards) out.push({ card, category });
  }
  return out;
}

/**
 * Every disclosure the deck carries, as one searchable string: each string
 * field whose key ends in `Note`, plus the string-array note fields. Built
 * dynamically so a newly added disclosure counts without touching this file.
 */
export function disclosureText(deck: GeneratedDeck): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(deck)) {
    if (typeof value === 'string' && /Note$/.test(key)) parts.push(value);
    if (/Notes$/.test(key) && Array.isArray(value)) {
      for (const v of value) parts.push(typeof v === 'string' ? v : JSON.stringify(v));
    }
  }
  return parts.join('\n');
}

function priceOf(card: ScryfallCard, currency: 'USD' | 'EUR'): number | null {
  const raw = getCardPrice(card, currency);
  if (!raw) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function isUserForced(card: ScryfallCard): boolean {
  return (
    !!card.isMustInclude &&
    (card.mustIncludeSource === 'user' ||
      card.mustIncludeSource === 'deck' ||
      card.mustIncludeSource === undefined)
  );
}

/** A note names the card (full name or front face). */
function noteNames(note: string | undefined, card: ScryfallCard): boolean {
  if (!note) return false;
  return note.includes(card.name) || note.includes(frontFaceName(card.name));
}

function owns(names: ReadonlySet<string> | undefined, card: ScryfallCard): boolean {
  if (!names) return false;
  return names.has(card.name) || names.has(frontFaceName(card.name));
}

const LEGALITY_KEY: Record<string, string> = {
  paupercommander: 'paupercommander',
  brawl: 'brawl',
};

const SUBTYPE_FIELDS = [
  'rampSubtypeCounts',
  'removalSubtypeCounts',
  'boardwipeSubtypeCounts',
  'cardDrawSubtypeCounts',
] as const;

function nonZero(record: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(record ?? {})) if (v) out[k] = v;
  return out;
}

function sameCounts(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

function fmtCounts(r: Record<string, number>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(r).sort(([x], [y]) => (x < y ? -1 : 1))));
}

// ── The checker ─────────────────────────────────────────────────────────────

export function checkDeckInvariants(
  deck: GeneratedDeck,
  ctx: InvariantContext
): InvariantViolation[] {
  const v: InvariantViolation[] = [];
  const add = (level: InvariantLevel, check: InvariantCheck, detail: string) =>
    v.push({ level, check, detail });

  const cz = ctx.customization;
  const commander = ctx.commander ?? deck.commander;
  const partner = ctx.partnerCommander !== undefined ? ctx.partnerCommander : deck.partnerCommander;
  const identity = new Set(ctx.colorIdentity);
  const currency = cz.currency ?? 'USD';
  const notes = disclosureText(deck);
  const seated = seatedCards(deck);
  const cards = seated.map((s) => s.card);
  const lands = deck.categories.lands ?? [];
  const nonLandBucket = seated.filter((s) => s.category !== 'lands').map((s) => s.card);
  const ownedNames = ctx.collectionNames;
  const ignoreOwnedBudget = !!(cz.ignoreOwnedBudget && ownedNames);
  const ignoreOwnedRarity = !!(cz.ignoreOwnedRarity && ownedNames);

  // 1. count. deckFormat 99 is the "100-card deck" sentinel (the library is
  // 100 minus the command zone); any other size is the literal total.
  const commanders = partner ? 2 : 1;
  const total = cz.deckFormat === 99 ? 100 : cz.deckFormat;
  const expected = total - commanders;
  if (cards.length !== expected) {
    add(
      'HARD',
      'count',
      `expected ${expected} cards (deckFormat ${cz.deckFormat}, ${commanders} commander${commanders === 1 ? '' : 's'}), got ${cards.length}`
    );
  }

  // 2. singleton, keyed by FRONT FACE so "A // B" and "A" are one card.
  const byFront = new Map<string, ScryfallCard[]>();
  for (const card of cards) {
    const key = normalizeCardName(frontFaceName(card.name));
    byFront.set(key, [...(byFront.get(key) ?? []), card]);
  }
  for (const group of byFront.values()) {
    const limit = Math.min(...group.map(copyLimit));
    if (group.length <= limit) continue;
    const spellings = [...new Set(group.map((c) => c.name))];
    add(
      'HARD',
      'singleton',
      `${frontFaceName(group[0].name)} appears ${group.length}x (limit ${limit})` +
        (spellings.length > 1 ? ` under different names: ${spellings.join(' | ')}` : '')
    );
  }

  // 2b. face-name collision (#2157): one face name carried by two different
  // cards. Harmonized Trio // Brainstorm seated next to Brainstorm is the
  // same name picked twice, once resolved to the impostor.
  const faceOwners = new Map<string, { face: string; fronts: Set<string> }>();
  for (const card of cards) {
    if (isBasic(card)) continue;
    const front = normalizeCardName(frontFaceName(card.name));
    for (const face of faceNames(card)) {
      const key = normalizeCardName(face);
      if (!faceOwners.has(key)) faceOwners.set(key, { face, fronts: new Set() });
      faceOwners.get(key)!.fronts.add(front);
    }
  }
  for (const [key, { face, fronts }] of faceOwners) {
    if (fronts.size < 2) continue;
    const holders = [
      ...new Set(
        cards
          .filter((c) => faceNames(c).some((f) => normalizeCardName(f) === key))
          .map((c) => c.name)
      ),
    ];
    add(
      'HARD',
      'face-name-collision',
      `the name "${face}" is seated on ${holders.length} different cards: ${holders.join(' | ')}`
    );
  }

  // 2c. face-name impostor: a multi-face card whose own names were never
  // requested, seated where one of its LATER faces was.
  const mustIncludeNames = [...(cz.mustIncludeCards ?? []), ...(cz.tempMustIncludeCards ?? [])];
  if (ctx.requestedNames) {
    const requested = new Set<string>();
    for (const n of ctx.requestedNames) requested.add(normalizeCardName(n));
    for (const n of mustIncludeNames) requested.add(normalizeCardName(n));
    const seatedFronts = new Set(cards.map((c) => normalizeCardName(frontFaceName(c.name))));
    for (const card of cards) {
      const faces = faceNames(card);
      if (faces.length < 2) continue;
      if (requested.has(normalizeCardName(card.name))) continue;
      if (requested.has(normalizeCardName(faces[0]))) continue;
      const wanted = faces.slice(1).find((f) => requested.has(normalizeCardName(f)));
      // A seated card that carries the wanted name on its front is already a
      // face-name collision above; report each defect once.
      if (wanted && !seatedFronts.has(normalizeCardName(wanted))) {
        add(
          'HARD',
          'face-name-impostor',
          `${card.name} is seated, but only its face "${wanted}" was ever requested`
        );
      }
    }
  }

  // 3. identity + dead-in-identity (E282).
  for (const card of cards) {
    const off = (card.color_identity ?? []).filter((c) => !identity.has(c));
    if (off.length > 0) {
      add(
        'HARD',
        'identity',
        `${card.name} identity [${card.color_identity.join('')}] is outside the deck's [${[...identity].join('')}]`
      );
    }
    if (isDeadInIdentity(card, [...identity])) {
      add(
        'HARD',
        'dead-in-identity',
        `${card.name} discounts a color the deck can't cast (identity [${[...identity].join('')}])`
      );
    }
  }

  // 4. commander in the 99.
  for (const who of [commander, partner]) {
    if (!who) continue;
    const key = normalizeCardName(frontFaceName(who.name));
    if (byFront.has(key)) add('HARD', 'commander-in-99', `${who.name} is also in the 99`);
  }

  // 5. legality by format. A forced user pick is honored, but only when the
  // deck says so; otherwise it is a silent illegal card like any other.
  const legalityKey = LEGALITY_KEY[cz.mtgFormat ?? 'commander'] ?? 'commander';
  for (const card of cards) {
    const status = card.legalities?.[legalityKey];
    if (status === 'legal') continue;
    if (status === undefined) {
      add('SOFT', 'legality', `${card.name} has no ${legalityKey} legality on record`);
      continue;
    }
    const disclosed = isUserForced(card) && noteNames(notes, card);
    add(
      disclosed ? 'SOFT' : 'HARD',
      'legality',
      `${card.name} is ${legalityKey}=${status}` +
        (isUserForced(card)
          ? disclosed
            ? ' (forced pick, disclosed)'
            : ' (forced pick, undisclosed)'
          : '')
    );
  }

  // 6. banned: the user's lists always win over a must-include.
  // ponytail: applied user lists (appliedIncludeLists/appliedExcludeLists)
  // resolve through the lists store, which this pure checker can't read; the
  // harness and the mocked suites never set them. Thread the resolved names
  // through InvariantContext if a caller starts using them.
  const banned = new Set<string>();
  for (const n of [...(cz.bannedCards ?? []), ...(cz.tempBannedCards ?? [])]) {
    banned.add(normalizeCardName(n));
  }
  for (const list of cz.banLists ?? []) {
    if (list.enabled) for (const n of list.cards) banned.add(normalizeCardName(n));
  }
  if (banned.size > 0) {
    const counts = new Map<string, number>();
    for (const card of cards) {
      if (
        banned.has(normalizeCardName(card.name)) ||
        banned.has(normalizeCardName(frontFaceName(card.name)))
      ) {
        counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
      }
    }
    for (const [name, n] of counts) add('HARD', 'banned', `${name} is banned (${n}x in deck)`);
  }

  // 7. must-include. User picks must be seated or named in the skip note;
  // combo-sourced (temp) picks skip silently by design, so they are SOFT.
  const seatedFullOrFront = new Set<string>();
  for (const card of cards) {
    seatedFullOrFront.add(normalizeCardName(card.name));
    seatedFullOrFront.add(normalizeCardName(frontFaceName(card.name)));
  }
  const checkedMust = new Set<string>();
  const mustSources: Array<[string, 'user' | 'combo']> = [
    ...(cz.mustIncludeCards ?? []).map((n): [string, 'user'] => [n, 'user']),
    ...(cz.tempMustIncludeCards ?? []).map((n): [string, 'combo'] => [n, 'combo']),
  ];
  for (const [name, source] of mustSources) {
    const key = normalizeCardName(name);
    if (checkedMust.has(key)) continue;
    checkedMust.add(key);
    if (banned.has(key)) continue; // the ban wins; its conflict is the skip note's job
    if (seatedFullOrFront.has(key)) continue;
    const impostor = cards.find((c) =>
      faceNames(c)
        .slice(1)
        .some((f) => normalizeCardName(f) === key)
    );
    if (impostor) {
      add(
        'HARD',
        'face-name-impostor',
        `must-include "${name}" was seated as ${impostor.name}, a different card`
      );
      continue;
    }
    const disclosed = !!deck.mustIncludeSkippedNote?.includes(name);
    const level: InvariantLevel = source === 'combo' || disclosed ? 'SOFT' : 'HARD';
    add(
      level,
      'must-include',
      `${name} missing` +
        (disclosed
          ? ' (named in the skip note)'
          : source === 'combo'
            ? ' (combo-sourced, skipped silently by design)'
            : ' (undisclosed)')
    );
  }

  // 8. max card price. Owned cards are exempt under ignoreOwnedBudget; a
  // forced user pick over the cap is kept only if the override note says so.
  const maxPrice = cz.maxCardPrice;
  let unpriced = 0;
  for (const card of cards) {
    if (isBasic(card)) continue;
    const p = priceOf(card, currency);
    if (p === null) {
      unpriced++;
      continue;
    }
    if (maxPrice === null || maxPrice === undefined || p <= maxPrice) continue;
    if (isOwnedBudgetExempt(card.name, ownedNames as Set<string> | undefined, ignoreOwnedBudget)) {
      continue;
    }
    const disclosed = isUserForced(card) && noteNames(deck.mustIncludeOverrideNote, card);
    add(
      disclosed ? 'SOFT' : 'HARD',
      'max-price',
      `${card.name} ${p} ${currency} > cap ${maxPrice}` +
        (disclosed ? ' (forced pick, disclosed)' : '')
    );
  }
  if (unpriced > 0 && (maxPrice != null || cz.deckBudget != null)) {
    add('SOFT', 'max-price', `${unpriced} nonbasic cards have no ${currency} price`);
  }

  // 9. budget: more than 5% over is HARD unless a note owns up to it.
  if (cz.deckBudget) {
    let spend = 0;
    for (const card of cards) {
      if (isOwnedBudgetExempt(card.name, ownedNames as Set<string> | undefined, ignoreOwnedBudget))
        continue;
      spend += priceOf(card, currency) ?? 0;
    }
    const overPct = ((spend - cz.deckBudget) / cz.deckBudget) * 100;
    if (overPct > 5) {
      const disclosed = !!deck.budgetNote || /budget/i.test(notes);
      add(
        disclosed ? 'SOFT' : 'HARD',
        'budget',
        `spend ${spend.toFixed(2)} ${currency} > budget ${cz.deckBudget} (${overPct.toFixed(1)}% over)` +
          (disclosed ? ' (disclosed)' : ' (undisclosed)')
      );
    }
  }

  // 10. rarity.
  if (cz.maxRarity) {
    for (const card of cards) {
      if (isBasic(card)) continue;
      if (isOwnedRarityExempt(card.name, ownedNames as Set<string> | undefined, ignoreOwnedRarity))
        continue;
      if (exceedsMaxRarity(card, cz.maxRarity)) {
        add('HARD', 'rarity', `${card.name} is ${card.rarity} > cap ${cz.maxRarity}`);
      }
    }
  }

  // 11. Tiny Leaders: every nonland card at mana value 3 or less.
  if (cz.tinyLeaders) {
    for (const card of cards) {
      if (frontIsLand(card)) continue;
      if ((card.cmc ?? 0) > 3) add('HARD', 'tiny-leaders', `${card.name} cmc ${card.cmc} > 3`);
    }
  }

  // 12. Arena only. Basics are exempt: `games` is printing-level, and every
  // basic has an Arena printing (the scanner's documented noise).
  if (cz.arenaOnly) {
    for (const card of cards) {
      if (isBasic(card)) continue;
      if (!card.games?.includes('arena')) {
        add(
          'HARD',
          'arena',
          `${card.name} is not on Arena (games: ${(card.games ?? []).join(',')})`
        );
      }
    }
  }

  // 13. permanents only: an oracle-role toggle (the other modes strip it).
  if (cz.generationMode === 'oracle-role' && cz.permanentsOnly) {
    for (const card of cards) {
      const t = frontTypeLine(card);
      if (/\b(Instant|Sorcery)\b/.test(t)) {
        add('HARD', 'permanents', `${card.name} (${t}) is not a permanent`);
      }
    }
  }

  // 14-15. land counts against what was TYPED: SOFT, since the auto-tune and
  // the sane-bounds clamp move them by design.
  if (lands.length !== cz.landCount) {
    add('SOFT', 'lands', `${lands.length} lands vs customization.landCount ${cz.landCount}`);
  }
  const nonbasicLands = lands.filter((c) => !isBasic(c)).length;
  if (nonbasicLands !== cz.nonBasicLandCount) {
    add(
      'SOFT',
      'nonbasic',
      `${nonbasicLands} nonbasic lands vs customization.nonBasicLandCount ${cz.nonBasicLandCount}`
    );
  }

  // 16. slot types (E485). Placement follows the FRONT face, the same rule
  // every seating path uses, so an MDFC spell // land may sit in either.
  const landsInSpellSlots: ScryfallCard[] = [];
  for (const { card, category } of seated) {
    if (category !== 'lands' && frontIsLand(card)) {
      landsInSpellSlots.push(card);
      add(
        'HARD',
        'land-in-spell-slot',
        `${card.name} (${frontTypeLine(card)}) sits in ${category}`
      );
    }
    if (category === 'lands' && !anyFaceIsLand(card)) {
      add('HARD', 'spell-in-land-slot', `${card.name} (${card.type_line}) sits in lands`);
    }
  }

  // 17. delivered land count vs the plan the generator built to
  // (composition.lands: the resolved auto-tune or clamped request), counting
  // a land parked in a spell slot as the land it is. A move away from the
  // plan needs a note, except within POOL_EXHAUSTION_LAND_THRESHOLD, which
  // the generator documents as land-generation rounding and never discloses:
  // that band stays SOFT so it is visible without failing the build.
  const planned = deck.composition?.lands;
  if (planned !== undefined) {
    const delivered = lands.length + landsInSpellSlots.length;
    if (delivered !== planned) {
      const disclosed =
        !!deck.landCountNote?.includes(`Delivered ${delivered}`) ||
        !!deck.poolExhaustionNote ||
        (deck.collectionShortfall ?? 0) > 0 ||
        (deck.filterShortfall ?? 0) > 0;
      const withinRounding = Math.abs(delivered - planned) <= POOL_EXHAUSTION_LAND_THRESHOLD;
      add(
        disclosed || withinRounding ? 'SOFT' : 'HARD',
        'land-count',
        `${delivered} lands delivered vs a planned ${planned}` +
          (disclosed
            ? ' (disclosed)'
            : withinRounding
              ? ` (undisclosed, inside the generator's ${POOL_EXHAUSTION_LAND_THRESHOLD}-land rounding band)`
              : ' (undisclosed)')
      );
    }
  }

  // 18. collection. Owned-only strategies may reach outside the collection
  // only for cards the report names in collectionRelaxedNames.
  const strategy = cz.collectionStrategy ?? 'full';
  if (ownedNames && constrainsToCollection(strategy)) {
    const relaxed = new Set(deck.collectionRelaxedNames ?? []);
    const outsiders = [
      ...new Set(
        cards
          .filter((c) => !isBasic(c) && !owns(ownedNames, c) && c.mustIncludeSource !== 'deck')
          .map((c) => c.name)
      ),
    ];
    if (outsiders.length > 0) {
      const undisclosed = outsiders.filter((n) => !relaxed.has(n));
      add(
        undisclosed.length > 0 ? 'HARD' : 'SOFT',
        'collection',
        `strategy=${strategy}: not owned: ${outsiders.join(', ')}` +
          (undisclosed.length > 0
            ? ` (undisclosed: ${undisclosed.join(', ')})`
            : ' (all named in collectionRelaxedNames)')
      );
    }
  } else if (ownedNames && strategy === 'partial') {
    const nonLand = cards.filter((c) => !frontIsLand(c));
    const owned = nonLand.filter((c) => owns(ownedNames, c)).length;
    const share = nonLand.length > 0 ? (100 * owned) / nonLand.length : 100;
    const target = (cz.collectionOwnedPercent ?? 0) - 5;
    if (share < target) {
      add(
        'SOFT',
        'collection',
        `strategy=partial: owned share ${share.toFixed(1)}% < target-5 ${target}%`
      );
    }
  }

  // 19. roles over target (SOFT: the rebalance's cap, as the scanner had it).
  for (const [role, target] of Object.entries(deck.roleTargets ?? {})) {
    const actual = deck.roleCounts?.[role] ?? 0;
    const cap = target + Math.max(2, Math.ceil(0.2 * target));
    if (actual > cap) add('SOFT', 'roles', `${role}: ${actual} > target ${target} (cap ${cap})`);
  }

  // 20. report truth (E166): the shipped roleCounts must be a recount of the
  // shipped cards through the one role source everything else reads
  // (computeRoleCounts / countedRoleOf), over the same nonland bucket.
  if (deck.roleTargets && !deck.roleCounts) {
    add('HARD', 'report-roles', 'roleTargets is set but roleCounts is missing');
  }
  if (deck.roleCounts) {
    const recount = computeRoleCounts(nonLandBucket);
    const shipped = nonZero(deck.roleCounts);
    const truth = nonZero(recount.roleCounts);
    if (!sameCounts(shipped, truth)) {
      add(
        'HARD',
        'report-roles',
        `reported roleCounts ${fmtCounts(shipped)} but the seated cards count ${fmtCounts(truth)}`
      );
    }
    // The subtype tallies stand in on the deck page until the tagger loads,
    // then the live recount replaces them: a mismatch is a visible jump.
    for (const field of SUBTYPE_FIELDS) {
      const stored = deck[field];
      if (!stored) continue;
      const a = nonZero(stored);
      const b = nonZero(recount[field]);
      if (!sameCounts(a, b)) {
        add('SOFT', 'report-subtypes', `${field} ${fmtCounts(a)} vs recount ${fmtCounts(b)}`);
      }
    }
  }

  // 21. stats truth: recomputed exactly as calculateStats defines them
  // (land-ness by lands-bucket membership).
  if (deck.stats.totalCards !== cards.length) {
    add('HARD', 'stats', `stats.totalCards ${deck.stats.totalCards} != ${cards.length} seated`);
  }
  if (nonLandBucket.length > 0) {
    // calculateStats rounds to two decimals; so does the recount.
    const raw = nonLandBucket.reduce((s, c) => s + (c.cmc ?? 0), 0) / nonLandBucket.length;
    const avg = Math.round(raw * 100) / 100;
    if (Math.abs(avg - deck.stats.averageCmc) > 1e-9) {
      add('HARD', 'stats', `stats.averageCmc ${deck.stats.averageCmc} != recomputed ${avg}`);
    }
    const curve: Record<string, number> = {};
    for (const c of nonLandBucket) {
      const k = String(Math.min(Math.floor(c.cmc ?? 0), 7));
      curve[k] = (curve[k] ?? 0) + 1;
    }
    const shippedCurve = nonZero(deck.stats.manaCurve as Record<string, number>);
    if (!sameCounts(shippedCurve, curve)) {
      add(
        'HARD',
        'stats',
        `stats.manaCurve ${fmtCounts(shippedCurve)} != recomputed ${fmtCounts(curve)}`
      );
    }
  }

  // 22. Game Changers: the user's limit, then the target bracket's ceiling.
  const gcNames = new Set(deck.gameChangerNames ?? []);
  const gcSeated = cards.filter((c) => gcNames.has(c.name) || gcNames.has(frontFaceName(c.name)));
  const limit =
    cz.gameChangerLimit === 'none'
      ? 0
      : cz.gameChangerLimit === 'unlimited' || cz.gameChangerLimit === undefined
        ? Infinity
        : cz.gameChangerLimit;
  if (gcSeated.length > limit) {
    const forcedDisclosed = gcSeated.filter(
      (c) =>
        isUserForced(c) &&
        noteNames(deck.mustIncludeOverrideNote, c) &&
        /Game Changer limit/.test(deck.mustIncludeOverrideNote ?? '')
    );
    const counted = gcSeated.length - forcedDisclosed.length;
    add(
      counted > limit ? 'HARD' : 'SOFT',
      'game-changers',
      `${gcSeated.length} Game Changers > limit ${limit}: ${gcSeated.map((c) => c.name).join(', ')}` +
        (forcedDisclosed.length > 0 ? ` (${forcedDisclosed.length} forced and disclosed)` : '')
    );
  }
  const bracketCap = bracketCeilings(cz.targetBracket).gameChangers;
  if (Number.isFinite(bracketCap) && gcSeated.length > bracketCap) {
    const unforced = gcSeated.filter((c) => !isUserForced(c));
    add(
      unforced.length > bracketCap ? 'HARD' : 'SOFT',
      'bracket-game-changers',
      `${gcSeated.length} Game Changers > bracket ${cz.targetBracket} ceiling ${bracketCap}: ${gcSeated
        .map((c) => c.name)
        .join(', ')}`
    );
  }

  // 23. empty buckets (SOFT).
  if (lands.length === 0 && cz.landCount > 0) add('SOFT', 'empty-buckets', 'no lands in the deck');
  if (!cards.some((c) => /\bCreature\b/.test(c.type_line || ''))) {
    add('SOFT', 'empty-buckets', 'zero creatures in the deck');
  }

  return v;
}

/**
 * The run-level check stress-scan.py read from summary.json: a generation
 * that threw is HARD (unless the panel row says that error is the product's
 * answer), one that took over five minutes is SOFT.
 */
export function checkGenerationOutcome(outcome: {
  error?: string;
  generationSeconds?: number;
  expectedError?: string;
}): InvariantViolation[] {
  const v: InvariantViolation[] = [];
  const firstLine = outcome.error?.split('\n')[0];
  if (outcome.expectedError) {
    if (!firstLine) {
      v.push({
        level: 'HARD',
        check: 'errors',
        detail: `expected the generation to refuse with "${outcome.expectedError}", but it built a deck`,
      });
    } else if (!firstLine.includes(outcome.expectedError)) {
      v.push({
        level: 'HARD',
        check: 'errors',
        detail: `expected "${outcome.expectedError}", got: ${firstLine}`,
      });
    }
  } else if (firstLine) {
    v.push({ level: 'HARD', check: 'errors', detail: `generation error: ${firstLine}` });
  }
  if ((outcome.generationSeconds ?? 0) > 300) {
    v.push({ level: 'SOFT', check: 'errors', detail: `slow: ${outcome.generationSeconds}s` });
  }
  return v;
}

export function hardViolations(violations: readonly InvariantViolation[]): InvariantViolation[] {
  return violations.filter((x) => x.level === 'HARD');
}

/** One line per violation, for test failure messages and harness logs. */
export function formatViolations(violations: readonly InvariantViolation[]): string {
  return violations.map((x) => `${x.level} ${x.check}: ${x.detail}`).join('\n');
}
