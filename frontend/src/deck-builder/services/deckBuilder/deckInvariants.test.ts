// @vitest-environment node
//
// E508: the deck-invariant checker over real cards. Every card below is a
// real Scryfall object (__fixtures__/invariant-cards.fixture.json, fetched
// from /cards/collection) and roles come from the pinned tagger snapshot, so
// the checks are proven against the data the generator actually sees:
// Harmonized Trio // Brainstorm is the real impostor from #2157, Karn's
// Bastion the real land from E485.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Customization,
  DeckCategory,
  GeneratedDeck,
  ScryfallCard,
} from '@/deck-builder/types';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { computeRoleCounts } from './commanderDeckAnalysis';
import { calculateStats } from './deckStats';
import {
  checkDeckInvariants,
  checkGenerationOutcome,
  copyLimit,
  disclosureText,
  formatViolations,
  hardViolations,
  normalizeCardName,
  type InvariantCheck,
  type InvariantContext,
  type InvariantViolation,
} from './deckInvariants';

const here = dirname(fileURLToPath(import.meta.url));
const CARDS = new Map<string, ScryfallCard>(
  (
    JSON.parse(
      readFileSync(resolve(here, '__fixtures__', 'invariant-cards.fixture.json'), 'utf8')
    ) as { cards: ScryfallCard[] }
  ).cards.map((c) => [c.name, c])
);

/** A fresh copy of a real card (checks never mutate, but tests do). */
function card(name: string, patch: Partial<ScryfallCard> = {}): ScryfallCard {
  const c = CARDS.get(name);
  if (!c) throw new Error(`no fixture card named ${name}`);
  return { ...structuredClone(c), ...patch };
}

beforeAll(async () => {
  const data = JSON.parse(
    readFileSync(resolve(here, '__fixtures__', 'tagger-tags.fixture.json'), 'utf8')
  );
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => data }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
});

afterAll(() => vi.unstubAllGlobals());

// ---- A clean Tatyova (UG) deck -------------------------------------------------

const COMMANDER = 'Tatyova, Benthic Druid';

const SPELLS = [
  'Brainstorm',
  'Counterspell',
  'Cultivate',
  'Llanowar Elves',
  'Beast Within',
  'Elvish Mystic',
  'Ponder',
  'Preordain',
  'Rampant Growth',
  'Harmonize',
  'Evolution Sage',
  "Tamiyo's Safekeeping",
  "Kodama's Reach",
  'Aetherize',
  'Mystic Snake',
  'Growth Spiral',
  "Nature's Lore",
  'Three Visits',
  'Farseek',
  'Explore',
  'Exploration',
  'Oracle of Mul Daya',
  'Tireless Provisioner',
  'Frantic Search',
  'Mulldrifter',
  'Hullbreaker Horror',
  'Evacuation',
  'Pongify',
  'Rapid Hybridization',
  'Negate',
  'Arcane Denial',
  'Sol Ring',
  'Arcane Signet',
  'Mana Reflection',
  'Plasm Capture',
];

const NONBASIC_LANDS = ['Command Tower', "Karn's Bastion", 'Eldrazi Temple'];

function customization(overrides: Partial<Customization> = {}): Customization {
  return {
    deckFormat: 99,
    landCount: 64,
    nonBasicLandCount: 3,
    bannedCards: [],
    banLists: [],
    mustIncludeCards: [],
    tempBannedCards: [],
    tempMustIncludeCards: [],
    maxCardPrice: null,
    deckBudget: null,
    budgetOption: 'any',
    gameChangerLimit: 'unlimited',
    targetBracket: 'all',
    maxRarity: null,
    tinyLeaders: false,
    ignoreOwnedBudget: false,
    ignoreOwnedRarity: false,
    collectionMode: false,
    collectionStrategy: 'full',
    collectionOwnedPercent: 75,
    arenaOnly: false,
    scryfallQuery: '',
    comboCount: 1,
    balancedRoles: true,
    currency: 'USD',
    appliedExcludeLists: [],
    appliedIncludeLists: [],
    tempoAutoDetect: true,
    tempoPacing: 'balanced',
    saltTolerance: 2,
    generationMode: 'edhrec',
    artThemeTag: '',
    historicalYear: 2005,
    permanentsOnly: false,
    brewLevel: 0.5,
    ...overrides,
  };
}

function emptyCategories(): Record<DeckCategory, ScryfallCard[]> {
  return {
    lands: [],
    ramp: [],
    cardDraw: [],
    singleRemoval: [],
    boardWipes: [],
    creatures: [],
    synergy: [],
    utility: [],
  };
}

/**
 * Assemble a GeneratedDeck whose report fields (stats, roleCounts) are
 * computed the way the generator computes them, so a clean deck is clean and
 * each test breaks exactly one thing.
 */
function assemble(
  categories: Record<DeckCategory, ScryfallCard[]>,
  extra: Partial<GeneratedDeck> = {}
): GeneratedDeck {
  const nonLand = (Object.entries(categories) as [DeckCategory, ScryfallCard[]][])
    .filter(([cat]) => cat !== 'lands')
    .flatMap(([, cards]) => cards);
  const recount = computeRoleCounts(nonLand);
  return {
    commander: card(COMMANDER),
    partnerCommander: null,
    categories,
    stats: calculateStats(categories),
    composition: {
      lands: categories.lands.length,
      ramp: 0,
      cardDraw: 0,
      singleRemoval: 0,
      boardWipes: 0,
      creatures: 0,
      synergy: 0,
      utility: 0,
    },
    // Targets equal to the counts: a clean deck is on target in every role.
    roleTargets: { ...recount.roleCounts },
    roleCounts: { ...recount.roleCounts },
    gameChangerNames: ['Cyclonic Rift', 'Rhystic Study', "Thassa's Oracle"],
    ...extra,
  };
}

function cleanCategories(): Record<DeckCategory, ScryfallCard[]> {
  const cats = emptyCategories();
  for (const name of SPELLS) {
    const c = card(name);
    (/\bCreature\b/.test(c.type_line) ? cats.creatures : cats.synergy).push(c);
  }
  for (const name of NONBASIC_LANDS) cats.lands.push(card(name));
  // 99 - 35 spells - 3 nonbasics = 61 basics.
  for (let i = 0; i < 31; i++) cats.lands.push(card('Forest'));
  for (let i = 0; i < 30; i++) cats.lands.push(card('Island'));
  return cats;
}

function context(overrides: Partial<InvariantContext> = {}): InvariantContext {
  return {
    commander: card(COMMANDER),
    partnerCommander: null,
    colorIdentity: ['G', 'U'],
    customization: customization(),
    ...overrides,
  };
}

function checks(v: InvariantViolation[], level?: 'HARD' | 'SOFT'): InvariantCheck[] {
  return v.filter((x) => !level || x.level === level).map((x) => x.check);
}

/** Replace the first seated card named `name` with `replacement`. */
function swap(
  cats: Record<DeckCategory, ScryfallCard[]>,
  name: string,
  replacement: ScryfallCard,
  into?: DeckCategory
): void {
  for (const list of Object.values(cats)) {
    const i = list.findIndex((c) => c.name === name);
    if (i >= 0) {
      list.splice(i, 1);
      (into ? cats[into] : list).push(replacement);
      return;
    }
  }
  throw new Error(`${name} is not seated`);
}

describe('checkDeckInvariants — a clean deck', () => {
  it('reports no violation at all for a legal, honest 99', () => {
    const deck = assemble(cleanCategories());
    const v = checkDeckInvariants(deck, context());
    expect(formatViolations(v)).toBe('');
  });

  it('really did count roles from the tagger snapshot (the report check has teeth)', () => {
    const deck = assemble(cleanCategories());
    expect(deck.roleCounts!.ramp).toBeGreaterThan(5);
    expect(deck.roleCounts!.cardDraw).toBeGreaterThan(3);
  });
});

describe('count and singleton', () => {
  it('flags a short deck, and counts a partner against the 100', () => {
    const cats = cleanCategories();
    cats.lands.pop();
    expect(checks(checkDeckInvariants(assemble(cats), context()), 'HARD')).toContain('count');

    const withPartner = checkDeckInvariants(
      assemble(cats, { partnerCommander: card('Kenrith, the Returned King') }),
      context({
        partnerCommander: card('Kenrith, the Returned King'),
        colorIdentity: ['W', 'U', 'B', 'R', 'G'],
      })
    );
    expect(checks(withPartner, 'HARD')).not.toContain('count');
  });

  it('reads a literal deck size for any format other than the 99 sentinel', () => {
    const v = checkDeckInvariants(
      assemble(cleanCategories()),
      context({ customization: customization({ deckFormat: 60 }) })
    );
    expect(v.find((x) => x.check === 'count')?.detail).toContain('expected 59');
  });

  it('flags a second copy of a singleton card', () => {
    const cats = cleanCategories();
    swap(cats, 'Forest', card('Counterspell'), 'synergy');
    const v = checkDeckInvariants(assemble(cats), context());
    expect(v.find((x) => x.check === 'singleton')?.detail).toMatch(/^Counterspell appears 2x/);
  });

  it('treats "A // B" and "A" as one card', () => {
    const cats = cleanCategories();
    swap(cats, 'Forest', card('Harmonized Trio // Brainstorm'), 'creatures');
    swap(
      cats,
      'Island',
      card('Harmonized Trio // Brainstorm', { name: 'Harmonized Trio' }),
      'creatures'
    );
    const v = checkDeckInvariants(assemble(cats), context());
    const s = v.find((x) => x.check === 'singleton');
    expect(s?.level).toBe('HARD');
    expect(s?.detail).toContain('under different names');
  });

  it('reads copy limits off the card itself', () => {
    expect(copyLimit(card('Relentless Rats'))).toBe(Infinity);
    expect(copyLimit(card('Seven Dwarves'))).toBe(7);
    expect(copyLimit(card('Forest'))).toBe(Infinity);
    expect(copyLimit(card('Wastes'))).toBe(Infinity);
    expect(copyLimit(card('Brainstorm'))).toBe(1);
  });
});

describe('face names (#2157)', () => {
  it('flags Brainstorm seated next to Harmonized Trio // Brainstorm', () => {
    const cats = cleanCategories();
    swap(cats, 'Forest', card('Harmonized Trio // Brainstorm'), 'creatures');
    const v = checkDeckInvariants(assemble(cats), context());
    const hit = v.find((x) => x.check === 'face-name-collision');
    expect(hit?.level).toBe('HARD');
    expect(hit?.detail).toBe(
      'the name "Brainstorm" is seated on 2 different cards: Harmonized Trio // Brainstorm | Brainstorm'
    );
  });

  it('flags the impostor when only its back face was ever requested', () => {
    const cats = cleanCategories();
    swap(cats, 'Brainstorm', card('Harmonized Trio // Brainstorm'), 'creatures');
    const v = checkDeckInvariants(
      assemble(cats),
      context({ requestedNames: [...SPELLS] }) // asked for "Brainstorm", never "Harmonized Trio"
    );
    expect(v.find((x) => x.check === 'face-name-impostor')?.detail).toBe(
      'Harmonized Trio // Brainstorm is seated, but only its face "Brainstorm" was ever requested'
    );
  });

  it('accepts the card when its own front face was requested', () => {
    const cats = cleanCategories();
    swap(cats, 'Brainstorm', card('Harmonized Trio // Brainstorm'), 'creatures');
    const v = checkDeckInvariants(
      assemble(cats),
      context({ requestedNames: [...SPELLS, 'Harmonized Trio'] })
    );
    expect(checks(v)).not.toContain('face-name-impostor');
  });

  it('skips the impostor check without a requested-name pool', () => {
    const cats = cleanCategories();
    swap(cats, 'Brainstorm', card('Harmonized Trio // Brainstorm'), 'creatures');
    expect(checks(checkDeckInvariants(assemble(cats), context()))).not.toContain(
      'face-name-impostor'
    );
  });

  it('flags a must-include answered by a different card that shares its name', () => {
    const cats = cleanCategories();
    swap(cats, 'Brainstorm', card('Harmonized Trio // Brainstorm'), 'creatures');
    const v = checkDeckInvariants(
      assemble(cats),
      context({ customization: customization({ mustIncludeCards: ['Brainstorm'] }) })
    );
    const hit = v.find((x) => x.check === 'face-name-impostor');
    expect(hit?.level).toBe('HARD');
    expect(hit?.detail).toContain('must-include "Brainstorm"');
  });
});

describe('identity, legality, bans', () => {
  it('flags an off-identity card and a colorless card that discounts an absent color', () => {
    const cats = cleanCategories();
    swap(cats, 'Pongify', card('Lightning Bolt'));
    swap(cats, 'Negate', card('Ruby Medallion'));
    const v = checkDeckInvariants(assemble(cats), context());
    expect(v.filter((x) => x.check === 'identity').map((x) => x.detail)).toEqual([
      "Lightning Bolt identity [R] is outside the deck's [GU]",
    ]);
    expect(v.find((x) => x.check === 'dead-in-identity')?.detail).toContain('Ruby Medallion');
  });

  it('flags the commander in the 99', () => {
    const cats = cleanCategories();
    swap(cats, 'Forest', card(COMMANDER), 'creatures');
    expect(checks(checkDeckInvariants(assemble(cats), context()), 'HARD')).toContain(
      'commander-in-99'
    );
  });

  it('checks legality for the format the deck was built in', () => {
    const cats = cleanCategories();
    const v = checkDeckInvariants(
      assemble(cats),
      context({ customization: customization({ mtgFormat: 'paupercommander' }) })
    );
    const illegal = v.filter((x) => x.check === 'legality' && x.level === 'HARD');
    // Real PDH data: Mystic Snake, Exploration, Mana Reflection et al. were
    // never printed at common.
    expect(illegal.map((x) => x.detail)).toContain('Mystic Snake is paupercommander=not_legal');
    expect(illegal.every((x) => !x.detail.startsWith('Forest'))).toBe(true);
  });

  it('keeps a forced pick SOFT only when the deck discloses it', () => {
    const cats = cleanCategories();
    const forced = card('Mystic Snake', { isMustInclude: true, mustIncludeSource: 'user' });
    swap(cats, 'Mystic Snake', forced);
    const cz = customization({ mtgFormat: 'paupercommander' });
    const silent = checkDeckInvariants(assemble(cats), context({ customization: cz }));
    expect(silent.find((x) => x.detail.startsWith('Mystic Snake'))?.level).toBe('HARD');
    const told = checkDeckInvariants(
      assemble(cats, {
        mustIncludeOverrideNote:
          'Kept 1 must-include card over your limits. Mystic Snake: not PDH-legal.',
      }),
      context({ customization: cz })
    );
    expect(told.find((x) => x.detail.startsWith('Mystic Snake'))?.level).toBe('SOFT');
  });

  it('reads a missing legality key as unknown, not illegal', () => {
    const cats = cleanCategories();
    const c = card('Negate');
    delete (c.legalities as Record<string, string>).brawl;
    swap(cats, 'Negate', c);
    const v = checkDeckInvariants(
      assemble(cats),
      context({ customization: customization({ mtgFormat: 'brawl' }) })
    );
    expect(v.find((x) => x.detail.startsWith('Negate'))?.level).toBe('SOFT');
  });

  it('flags cards on the ban list, enabled ban lists and temp bans, but not disabled lists', () => {
    const v = checkDeckInvariants(
      assemble(cleanCategories()),
      context({
        customization: customization({
          bannedCards: ['Counterspell'],
          tempBannedCards: ['Sol Ring'],
          banLists: [
            { id: 'a', name: 'On', cards: ['Ponder'], isPreset: false, enabled: true },
            { id: 'b', name: 'Off', cards: ['Preordain'], isPreset: false, enabled: false },
          ],
        }),
      })
    );
    expect(v.filter((x) => x.check === 'banned').map((x) => x.detail)).toEqual([
      'Counterspell is banned (1x in deck)',
      'Ponder is banned (1x in deck)',
      'Sol Ring is banned (1x in deck)',
    ]);
  });
});

describe('must-includes', () => {
  it('HARD when a user pick is missing and nothing says why', () => {
    const v = checkDeckInvariants(
      assemble(cleanCategories()),
      context({ customization: customization({ mustIncludeCards: ['Fact or Fiction'] }) })
    );
    expect(v.find((x) => x.check === 'must-include')).toEqual({
      level: 'HARD',
      check: 'must-include',
      detail: 'Fact or Fiction missing (undisclosed)',
    });
  });

  it('SOFT when the skip note names it, or it came from the combo panel', () => {
    const deck = assemble(cleanCategories(), {
      mustIncludeSkippedNote:
        "Couldn't include 1 of your must-include cards. Fact or Fiction: card not found.",
    });
    const v = checkDeckInvariants(
      deck,
      context({
        customization: customization({
          mustIncludeCards: ['Fact or Fiction'],
          tempMustIncludeCards: ["Thassa's Oracle"],
        }),
      })
    );
    expect(v.filter((x) => x.check === 'must-include').map((x) => x.level)).toEqual([
      'SOFT',
      'SOFT',
    ]);
  });

  it('matches a stored name that differs by case, and lets a ban win', () => {
    const v = checkDeckInvariants(
      assemble(cleanCategories()),
      context({
        customization: customization({
          mustIncludeCards: ["tamiyo's safekeeping", 'Fact or Fiction'],
          bannedCards: ['Fact or Fiction'],
        }),
      })
    );
    expect(checks(v)).not.toContain('must-include');
  });
});

describe('price, budget, rarity and the other per-card caps', () => {
  it('flags a card over the max price, and exempts owned cards and a disclosed forced pick', () => {
    const cats = cleanCategories();
    swap(cats, 'Forest', card('Rhystic Study'), 'synergy');
    swap(cats, 'Island', card('Heroic Intervention'), 'synergy');
    const cz = customization({ maxCardPrice: 15 });
    const v = checkDeckInvariants(assemble(cats), context({ customization: cz }));
    expect(v.filter((x) => x.check === 'max-price').map((x) => x.detail)).toEqual([
      'Exploration 30.48 USD > cap 15',
      'Rhystic Study 70.36 USD > cap 15',
      'Heroic Intervention 17.27 USD > cap 15',
    ]);

    const owned = checkDeckInvariants(
      assemble(cats),
      context({
        customization: customization({ maxCardPrice: 15, ignoreOwnedBudget: true }),
        collectionNames: new Set(['Rhystic Study', 'Exploration']),
      })
    );
    expect(owned.filter((x) => x.check === 'max-price').map((x) => x.detail)).toEqual([
      'Heroic Intervention 17.27 USD > cap 15',
    ]);

    swap(
      cats,
      'Heroic Intervention',
      card('Heroic Intervention', { isMustInclude: true, mustIncludeSource: 'user' })
    );
    const told = checkDeckInvariants(
      assemble(cats, {
        mustIncludeOverrideNote:
          'Kept 1 must-include card over your limits. Heroic Intervention: kept despite your max card price.',
      }),
      context({ customization: cz })
    );
    expect(told.find((x) => x.detail.startsWith('Heroic'))?.level).toBe('SOFT');
  });

  it('uses the deck currency, and counts unpriced cards as SOFT', () => {
    const cats = cleanCategories();
    swap(cats, 'Forest', card('Rhystic Study'), 'synergy'); // $70.36, 44.26 EUR
    // No price in any currency (getCardPrice falls back across currencies,
    // so a card with only a EUR price still reads as priced).
    swap(cats, 'Island', card('Mind Stone'), 'synergy');
    const eur = checkDeckInvariants(
      assemble(cats),
      context({ customization: customization({ maxCardPrice: 50, currency: 'EUR' }) })
    );
    expect(eur.filter((x) => x.check === 'max-price').map((x) => `${x.level} ${x.detail}`)).toEqual(
      ['SOFT 1 nonbasic cards have no EUR price']
    );
    const usd = checkDeckInvariants(
      assemble(cats),
      context({ customization: customization({ maxCardPrice: 50 }) })
    );
    expect(usd.filter((x) => x.check === 'max-price').map((x) => `${x.level} ${x.detail}`)).toEqual(
      ['HARD Rhystic Study 70.36 USD > cap 50', 'SOFT 1 nonbasic cards have no USD price']
    );
  });

  it('flags a budget blown by more than 5%, SOFT once the budget note owns up to it', () => {
    const cz = customization({ deckBudget: 20 });
    const silent = checkDeckInvariants(assemble(cleanCategories()), context({ customization: cz }));
    expect(silent.find((x) => x.check === 'budget')?.level).toBe('HARD');
    const told = checkDeckInvariants(
      assemble(cleanCategories(), { budgetNote: 'Finished at $80 against your $20 budget.' }),
      context({ customization: cz })
    );
    expect(told.find((x) => x.check === 'budget')?.level).toBe('SOFT');
    const roomy = checkDeckInvariants(
      assemble(cleanCategories()),
      context({ customization: customization({ deckBudget: 5000 }) })
    );
    expect(checks(roomy)).not.toContain('budget');
  });

  it('flags cards above the rarity cap, but never basics or exempt owned cards', () => {
    const v = checkDeckInvariants(
      assemble(cleanCategories()),
      context({ customization: customization({ maxRarity: 'uncommon' }) })
    );
    const names = v.filter((x) => x.check === 'rarity').map((x) => x.detail.split(' is ')[0]);
    expect(names).toContain('Mystic Snake');
    expect(names).toContain("Karn's Bastion");
    expect(names).not.toContain('Forest');
    expect(names).not.toContain('Counterspell');

    const exempt = checkDeckInvariants(
      assemble(cleanCategories()),
      context({
        customization: customization({ maxRarity: 'uncommon', ignoreOwnedRarity: true }),
        collectionNames: new Set(['Mystic Snake']),
      })
    );
    expect(exempt.some((x) => x.detail.startsWith('Mystic Snake'))).toBe(false);
  });

  it('Tiny Leaders caps nonland mana value at 3', () => {
    const v = checkDeckInvariants(
      assemble(cleanCategories()),
      context({ customization: customization({ tinyLeaders: true }) })
    );
    const names = v.filter((x) => x.check === 'tiny-leaders').map((x) => x.detail);
    expect(names).toContain('Mulldrifter cmc 5 > 3');
    expect(names.some((d) => d.startsWith('Command Tower'))).toBe(false);
  });

  it('Arena only: flags paper-only cards, never basics', () => {
    const v = checkDeckInvariants(
      assemble(cleanCategories()),
      context({ customization: customization({ arenaOnly: true }) })
    );
    const names = v.filter((x) => x.check === 'arena').map((x) => x.detail.split(' is not')[0]);
    expect(names).toContain('Brainstorm');
    expect(names).not.toContain('Llanowar Elves');
    expect(names).not.toContain('Island');
  });

  it('permanents only applies in oracle-role mode', () => {
    const oracle = checkDeckInvariants(
      assemble(cleanCategories()),
      context({
        customization: customization({ generationMode: 'oracle-role', permanentsOnly: true }),
      })
    );
    expect(oracle.find((x) => x.detail.startsWith('Counterspell'))?.check).toBe('permanents');
    const edhrec = checkDeckInvariants(
      assemble(cleanCategories()),
      context({ customization: customization({ permanentsOnly: true }) })
    );
    expect(checks(edhrec)).not.toContain('permanents');
  });
});

describe('lands (E485)', () => {
  it('flags a land seated in a spell slot, by front face', () => {
    const cats = cleanCategories();
    swap(cats, "Karn's Bastion", card("Karn's Bastion"), 'utility');
    swap(cats, 'Forest', card('Dryad Arbor'), 'creatures');
    const v = checkDeckInvariants(assemble(cats), context());
    expect(v.filter((x) => x.check === 'land-in-spell-slot').map((x) => x.detail)).toEqual([
      'Dryad Arbor (Land Creature — Forest Dryad) sits in creatures',
      "Karn's Bastion (Land) sits in utility",
    ]);
  });

  it('lets an MDFC spell // land sit in either bucket, and flags a plain spell in lands', () => {
    const cats = cleanCategories();
    swap(cats, 'Forest', card('Sink into Stupor // Soporific Springs'), 'lands');
    swap(
      cats,
      'Island',
      card("Emeria's Call // Emeria, Shattered Skyclave", { color_identity: [] }),
      'synergy'
    );
    swap(cats, 'Negate', card('Negate'), 'lands');
    const v = checkDeckInvariants(assemble(cats), context());
    expect(v.filter((x) => x.check.endsWith('slot')).map((x) => x.detail)).toEqual([
      'Negate (Instant) sits in lands',
    ]);
  });

  it('counts a land in a spell slot toward the delivered land count', () => {
    const cats = cleanCategories();
    const deck = assemble(cats);
    // The plan was 64; four spell slots now hold lands.
    for (const name of ['Ponder', 'Preordain', 'Negate', 'Explore']) {
      swap(cats, name, card('Wastes'), 'synergy');
    }
    const v = checkDeckInvariants(
      { ...deck, categories: cats, stats: calculateStats(cats) },
      context()
    );
    const hit = v.find((x) => x.check === 'land-count');
    expect(hit).toEqual({
      level: 'HARD',
      check: 'land-count',
      detail: '68 lands delivered vs a planned 64 (undisclosed)',
    });
  });

  it('leaves a small undisclosed drift SOFT, and any disclosed drift SOFT', () => {
    const base = assemble(cleanCategories());
    const planned = (lands: number, extra: Partial<GeneratedDeck> = {}) =>
      checkDeckInvariants(
        { ...base, composition: { ...base.composition!, lands }, ...extra },
        context()
      ).find((x) => x.check === 'land-count');
    expect(planned(62)?.level).toBe('SOFT');
    expect(planned(62)?.detail).toContain('rounding band');
    expect(planned(58)?.level).toBe('HARD');
    expect(planned(58, { poolExhaustionNote: 'Ran out of cards after 35 spells.' })?.level).toBe(
      'SOFT'
    );
    expect(
      planned(58, {
        landCountNote: 'Auto-tuned to 58 lands. Delivered 64 after later adjustments.',
      })?.level
    ).toBe('SOFT');
    expect(planned(64)).toBeUndefined();
  });

  it('compares lands and nonbasics to the typed request as SOFT only', () => {
    const v = checkDeckInvariants(
      assemble(cleanCategories()),
      context({ customization: customization({ landCount: 37, nonBasicLandCount: 15 }) })
    );
    expect(
      v.filter((x) => x.check === 'lands' || x.check === 'nonbasic').map((x) => x.level)
    ).toEqual(['SOFT', 'SOFT']);
  });
});

describe('collection', () => {
  const allSeated = () =>
    new Set(
      Object.values(cleanCategories())
        .flat()
        .map((c) => c.name)
    );

  it('owned-only: HARD for an unowned card the report does not name', () => {
    const owned = allSeated();
    owned.delete('Mystic Snake');
    const cz = customization({ collectionMode: true, collectionStrategy: 'full' });
    const silent = checkDeckInvariants(
      assemble(cleanCategories()),
      context({ customization: cz, collectionNames: owned })
    );
    expect(silent.find((x) => x.check === 'collection')?.level).toBe('HARD');
    const named = checkDeckInvariants(
      assemble(cleanCategories(), { collectionRelaxedNames: ['Mystic Snake'] }),
      context({ customization: cz, collectionNames: owned })
    );
    expect(named.find((x) => x.check === 'collection')?.level).toBe('SOFT');
  });

  it('never asks for basics to be owned, and ignores the collection for "prefer"', () => {
    const owned = new Set([...allSeated()].filter((n) => n !== 'Forest' && n !== 'Island'));
    const full = checkDeckInvariants(
      assemble(cleanCategories()),
      context({
        customization: customization({ collectionStrategy: 'full' }),
        collectionNames: owned,
      })
    );
    expect(checks(full)).not.toContain('collection');
    const prefer = checkDeckInvariants(
      assemble(cleanCategories()),
      context({
        customization: customization({ collectionStrategy: 'prefer' }),
        collectionNames: new Set(),
      })
    );
    expect(checks(prefer)).not.toContain('collection');
  });

  it('partial: SOFT when the owned share falls more than 5 points short', () => {
    const v = checkDeckInvariants(
      assemble(cleanCategories()),
      context({
        customization: customization({ collectionStrategy: 'partial', collectionOwnedPercent: 50 }),
        collectionNames: new Set(['Brainstorm']),
      })
    );
    expect(v.find((x) => x.check === 'collection')?.level).toBe('SOFT');
  });
});

describe('report truth (E166)', () => {
  it('flags a reported role count the seated cards do not add up to', () => {
    const deck = assemble(cleanCategories());
    const lie = {
      ...deck,
      roleCounts: { ...deck.roleCounts!, boardwipe: deck.roleCounts!.boardwipe + 1 },
    };
    const hit = checkDeckInvariants(lie, context()).find((x) => x.check === 'report-roles');
    expect(hit?.level).toBe('HARD');
    expect(hit?.detail).toMatch(/boardwipe/);
  });

  it('flags role targets shipped without role counts', () => {
    const deck = { ...assemble(cleanCategories()), roleCounts: undefined };
    expect(checks(checkDeckInvariants(deck, context()), 'HARD')).toContain('report-roles');
  });

  it('flags subtype tallies that will jump when the live recount replaces them (SOFT)', () => {
    const deck = { ...assemble(cleanCategories()), rampSubtypeCounts: { 'mana-rock': 40 } };
    expect(
      checkDeckInvariants(deck, context()).find((x) => x.check === 'report-subtypes')?.level
    ).toBe('SOFT');
  });

  it('flags stats that do not describe the seated cards', () => {
    const deck = assemble(cleanCategories());
    const v = checkDeckInvariants(
      {
        ...deck,
        stats: {
          ...deck.stats,
          totalCards: 98,
          averageCmc: deck.stats.averageCmc + 0.5,
          manaCurve: { ...deck.stats.manaCurve, 1: 0 },
        },
      },
      context()
    );
    expect(v.filter((x) => x.check === 'stats').length).toBe(3);
  });

  it('flags roles far over target as SOFT', () => {
    const deck = assemble(cleanCategories(), {
      roleTargets: { ramp: 2, removal: 8, boardwipe: 3, cardDraw: 10 },
    });
    expect(checkDeckInvariants(deck, context()).find((x) => x.check === 'roles')?.level).toBe(
      'SOFT'
    );
  });
});

describe('Game Changers', () => {
  function withGcs() {
    const cats = cleanCategories();
    swap(cats, 'Forest', card('Rhystic Study'), 'synergy');
    swap(cats, 'Island', card('Cyclonic Rift'), 'synergy');
    return cats;
  }

  it('holds the user limit, SOFT for a forced pick the override note names', () => {
    const cz = customization({ gameChangerLimit: 1 });
    const v = checkDeckInvariants(assemble(withGcs()), context({ customization: cz }));
    expect(v.find((x) => x.check === 'game-changers')?.level).toBe('HARD');

    const cats = withGcs();
    swap(
      cats,
      'Rhystic Study',
      card('Rhystic Study', { isMustInclude: true, mustIncludeSource: 'user' })
    );
    const told = checkDeckInvariants(
      assemble(cats, {
        mustIncludeOverrideNote:
          'Kept 1 must-include card over your limits. Rhystic Study: kept despite your Game Changer limit.',
      }),
      context({ customization: cz })
    );
    expect(told.find((x) => x.check === 'game-changers')?.level).toBe('SOFT');
  });

  it('holds the target bracket ceiling', () => {
    const v = checkDeckInvariants(
      assemble(withGcs()),
      context({ customization: customization({ targetBracket: 2 }) })
    );
    expect(v.find((x) => x.check === 'bracket-game-changers')?.detail).toBe(
      '2 Game Changers > bracket 2 ceiling 0: Rhystic Study, Cyclonic Rift'
    );
    const b3 = checkDeckInvariants(
      assemble(withGcs()),
      context({ customization: customization({ targetBracket: 3 }) })
    );
    expect(checks(b3)).not.toContain('bracket-game-changers');
  });
});

describe('empty buckets', () => {
  it('notes a deck with no creatures (SOFT)', () => {
    const cats = cleanCategories();
    cats.creatures = [];
    const v = checkDeckInvariants(assemble(cats), context());
    expect(v.find((x) => x.check === 'empty-buckets')?.detail).toBe('zero creatures in the deck');
  });
});

describe('checkGenerationOutcome', () => {
  it('HARD on an error, SOFT when slow', () => {
    expect(checkGenerationOutcome({ error: 'boom\nstack', generationSeconds: 400 })).toEqual([
      { level: 'HARD', check: 'errors', detail: 'generation error: boom' },
      { level: 'SOFT', check: 'errors', detail: 'slow: 400s' },
    ]);
  });

  it('accepts the expected refusal, and fails a wrong one or a silent build', () => {
    const expectedError = "Your Scryfall filter isn't valid";
    expect(checkGenerationOutcome({ error: `${expectedError}: bad`, expectedError })).toEqual([]);
    expect(hardViolations(checkGenerationOutcome({ error: 'other', expectedError }))).toHaveLength(
      1
    );
    expect(checkGenerationOutcome({ expectedError })[0].detail).toContain('built a deck');
  });
});

describe('helpers', () => {
  it('normalizes case, punctuation and diacritics', () => {
    expect(normalizeCardName('Lim-Dûl the Necromancer')).toBe(
      normalizeCardName('lim dul the necromancer')
    );
    expect(normalizeCardName("Tamiyo's Safekeeping")).toBe('tamiyo s safekeeping');
  });

  it('collects every disclosure field', () => {
    const text = disclosureText({
      ...assemble(cleanCategories()),
      budgetNote: 'over budget',
      roleDeficitNotes: ['removal short'],
    });
    expect(text).toContain('over budget');
    expect(text).toContain('removal short');
  });
});
