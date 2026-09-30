// @vitest-environment node
//
// E508: the deck-invariant checker over real cards. Every card below is a
// real Scryfall object (__fixtures__/invariant-cards.fixture.json, fetched
// from /cards/collection) and roles come from the pinned tagger snapshot, so
// the checks are proven against the data the generator actually sees:
// Harmonized Trio // Brainstorm is the real impostor from #2157, Karn's
// Bastion the real land from E485.
//
// The commander checks (E524 chosen colors, E530 legality and previews) live
// in deckInvariants.commander.test.ts; both files share
// __fixtures__/invariant-deck.ts.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GeneratedDeck } from '@/deck-builder/types';
import { roleCapLimit } from './roleCapAllowance';
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
} from './deckInvariants';
import {
  COMMANDER,
  SPELLS,
  assemble,
  card,
  checks,
  cleanCategories,
  commanderCard,
  context,
  customization,
  loadTaggerSnapshot,
  swap,
} from './__fixtures__/invariant-deck';

beforeAll(loadTaggerSnapshot);

afterAll(() => vi.unstubAllGlobals());

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
  it('notes Brainstorm next to Harmonized Trio // Brainstorm (SOFT: a legal pair on its own)', () => {
    const cats = cleanCategories();
    swap(cats, 'Forest', card('Harmonized Trio // Brainstorm'), 'creatures');
    const v = checkDeckInvariants(assemble(cats), context());
    const hit = v.find((x) => x.check === 'face-name-collision');
    expect(hit?.level).toBe('SOFT');
    expect(hit?.detail).toBe(
      'the name "Brainstorm" is seated on 2 different cards: Harmonized Trio // Brainstorm | Brainstorm'
    );
  });

  it('HARD when an observed lookup for "Brainstorm" answered with the seated Trio', () => {
    const cats = cleanCategories();
    swap(cats, 'Brainstorm', card('Harmonized Trio // Brainstorm'), 'creatures');
    const v = checkDeckInvariants(
      assemble(cats),
      context({
        nameResolutions: new Map([
          ['Brainstorm', 'Harmonized Trio // Brainstorm'],
          // A front-face or spelling resolution is the normal case.
          ['Harmonized Trio', 'Harmonized Trio // Brainstorm'],
          ['counterspell', 'Counterspell'],
        ]),
      })
    );
    expect(v.filter((x) => x.check === 'face-name-impostor')).toEqual([
      {
        level: 'HARD',
        check: 'face-name-impostor',
        detail:
          'a lookup for "Brainstorm" was answered with Harmonized Trio // Brainstorm, and that card is seated',
      },
    ]);
  });

  it('SOFT when only the requested-name pool suggests it (a search fill can seat it legitimately)', () => {
    const cats = cleanCategories();
    swap(cats, 'Brainstorm', card('Harmonized Trio // Brainstorm'), 'creatures');
    const v = checkDeckInvariants(
      assemble(cats),
      context({ requestedNames: [...SPELLS] }) // asked for "Brainstorm", never "Harmonized Trio"
    );
    expect(v.find((x) => x.check === 'face-name-impostor')).toEqual({
      level: 'SOFT',
      check: 'face-name-impostor',
      detail:
        'Harmonized Trio // Brainstorm is seated, but only its face "Brainstorm" was requested (possible impostor)',
    });
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

  it('makes any undisclosed drift HARD, one land included, and any disclosed drift SOFT', () => {
    const base = assemble(cleanCategories());
    const planned = (lands: number, extra: Partial<GeneratedDeck> = {}) =>
      checkDeckInvariants(
        { ...base, composition: { ...base.composition!, lands }, ...extra },
        context()
      ).find((x) => x.check === 'land-count');
    // E529: the old 3-land "rounding" band hid padding for a spell shortfall.
    expect(planned(63)).toEqual({
      level: 'HARD',
      check: 'land-count',
      detail: '64 lands delivered vs a planned 63 (undisclosed)',
    });
    expect(planned(62, { poolExhaustionNote: 'Ran out of cards after 35 spells.' })?.level).toBe(
      'SOFT'
    );
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

  // E528: HARD now that the generator stores this very recount.
  it('flags subtype tallies that will jump when the live recount replaces them', () => {
    const deck = { ...assemble(cleanCategories()), rampSubtypeCounts: { 'mana-rock': 40 } };
    expect(
      checkDeckInvariants(deck, context()).find((x) => x.check === 'report-subtypes')?.level
    ).toBe('HARD');
  });

  it('accepts subtype tallies equal to the recount', () => {
    const cats = cleanCategories();
    const nonLand = Object.entries(cats)
      .filter(([cat]) => cat !== 'lands')
      .flatMap(([, cards]) => cards);
    const recount = computeRoleCounts(nonLand);
    const deck = assemble(cats, {
      rampSubtypeCounts: recount.rampSubtypeCounts,
      removalSubtypeCounts: recount.removalSubtypeCounts,
      boardwipeSubtypeCounts: recount.boardwipeSubtypeCounts,
      cardDrawSubtypeCounts: recount.cardDrawSubtypeCounts,
    });
    // The snapshot tags real subtypes on this deck, so the check has teeth.
    expect(Object.keys(recount.rampSubtypeCounts).length).toBeGreaterThan(0);
    expect(checks(checkDeckInvariants(deck, context()))).not.toContain('report-subtypes');
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

  // E527: the live art-theme-goblin row seated the real Secret Lair
  // reversible Krark's Thumb, which has no top-level cmc, and the curve
  // shipped a "NaN" bucket.
  it('counts a reversible printing by its front face, and flags a NaN curve bucket', () => {
    const cats = cleanCategories();
    swap(cats, 'Negate', commanderCard("Krark's Thumb // Krark's Thumb"));
    const deck = assemble(cats);
    expect(checks(checkDeckInvariants(deck, context()))).not.toContain('stats');
    const nan = checkDeckInvariants(
      {
        ...deck,
        stats: { ...deck.stats, manaCurve: { ...deck.stats.manaCurve, NaN: 1 } as never },
      },
      context()
    ).filter((x) => x.check === 'stats');
    expect(nan.map((x) => x.detail)).toContain('stats.manaCurve has a bad entry "NaN": 1');
    expect(nan.every((x) => x.level === 'HARD')).toBe(true);
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

describe('roles over target: what E532 admits past the cap (E554)', () => {
  // Real Tatyova cards, roles from the pinned tagger snapshot. `target` is
  // chosen so the deck's ramp sits past the invariant's cap
  // (target + max(2, ceil(0.2 target))) and, for the admitted cases, inside
  // the staple ceiling (roleCapLimit(target, 2)).
  const NOTE = "3 cards went past a role cap. They're in 40% or more of this commander's decks.";
  const clean = () => assemble(cleanCategories());
  const rampCount = () => clean().roleCounts!.ramp;
  function targetFor(actual: number, pastCeiling = false): number {
    for (let t = actual - 1; t > 0; t--) {
      const cap = t + Math.max(2, Math.ceil(0.2 * t));
      if (actual <= cap) continue;
      if (actual <= roleCapLimit(t, 2) !== pastCeiling) return t;
    }
    throw new Error('no target');
  }
  const staples = () => {
    const inclusion: Record<string, number> = {};
    for (const c of Object.values(cleanCategories()).flat()) {
      if (computeRoleCounts([c]).roleCounts.ramp) inclusion[c.name] = 55;
    }
    return inclusion;
  };
  const rolesFlag = (deck: GeneratedDeck) =>
    checkDeckInvariants(deck, context()).find((x) => x.check === 'roles');

  it('is not flagged for staples the cap let through, disclosed', () => {
    const t = targetFor(rampCount());
    const deck = assemble(cleanCategories(), {
      roleTargets: { ramp: t },
      cardInclusionMap: staples(),
      roleCapOverflowNote: NOTE,
    });
    expect(rolesFlag(deck)).toBeUndefined();
  });

  it('is flagged when the overflow is not disclosed', () => {
    const t = targetFor(rampCount());
    const deck = assemble(cleanCategories(), {
      roleTargets: { ramp: t },
      cardInclusionMap: staples(),
    });
    expect(rolesFlag(deck)?.level).toBe('SOFT');
  });

  it('is flagged when no card past the cap is a staple or a combo piece', () => {
    const t = targetFor(rampCount());
    const deck = assemble(cleanCategories(), {
      roleTargets: { ramp: t },
      roleCapOverflowNote: NOTE,
    });
    expect(rolesFlag(deck)?.level).toBe('SOFT');
  });

  it('is flagged past the staple ceiling even when every card is a staple', () => {
    const t = targetFor(rampCount(), true);
    const deck = assemble(cleanCategories(), {
      roleTargets: { ramp: t },
      cardInclusionMap: staples(),
      roleCapOverflowNote: NOTE,
    });
    expect(rolesFlag(deck)?.level).toBe('SOFT');
  });

  it('counts a piece of a combo the deck holds as a card the cap lets through', () => {
    const t = targetFor(rampCount());
    const rampNames = Object.keys(staples());
    const combo = {
      comboId: 'x',
      cards: rampNames,
      results: [],
      isComplete: true,
      missingCards: [],
      deckCount: 100,
      bracket: null,
      cardCount: rampNames.length,
    };
    const deck = assemble(cleanCategories(), {
      roleTargets: { ramp: t },
      detectedCombos: [combo],
      roleCapOverflowNote: NOTE,
    });
    expect(rolesFlag(deck)).toBeUndefined();
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
