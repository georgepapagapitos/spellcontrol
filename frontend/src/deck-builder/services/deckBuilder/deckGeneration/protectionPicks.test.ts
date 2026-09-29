// E532: which commanders earn survival pieces at pick time, and which pieces.
// Real oracle text (Scryfall), inclusion from each commander's EDHREC page.
import { describe, it, expect } from 'vitest';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import { buildCommanderProfile } from '../commanderProfile';
import {
  commanderMustSurvive,
  isSurvivalPiece,
  makeProtectionAdmits,
  protectionAdmitsFor,
  PROTECTION_PICK_CAP,
} from './protectionPicks';

function sc(name: string, type_line: string, oracle_text: string): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 2,
    type_line,
    oracle_text,
    color_identity: [],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  };
}
const ec = (name: string, inclusion: number): EDHRECCard => ({
  name,
  sanitized: name.toLowerCase(),
  primary_type: 'Unknown',
  inclusion,
  num_decks: 100,
});

const MEREN = sc(
  'Meren of Clan Nel Toth',
  'Legendary Creature — Human Shaman',
  "Whenever another creature you control dies, you get an experience counter.\nAt the beginning of your end step, choose target creature card in your graveyard. If that card's mana value is less than or equal to the number of experience counters you have, return it to the battlefield. Otherwise, put it into your hand."
);
const KRENKO = sc(
  'Krenko, Mob Boss',
  'Legendary Creature — Goblin Warrior',
  '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.'
);
const TALRAND = sc(
  'Talrand, Sky Summoner',
  'Legendary Creature — Merfolk Wizard',
  'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.'
);
const LATHRIL = sc(
  'Lathril, Blade of the Elves',
  'Legendary Creature — Elf Noble',
  "Menace (This creature can't be blocked except by two or more creatures.)\nWhenever Lathril deals combat damage to a player, create that many 1/1 green Elf Warrior creature tokens.\n{T}, Tap ten untapped Elves you control: Each opponent loses 10 life and you gain 10 life."
);
const ATRAXA_GRAND_UNIFIER = sc(
  'Atraxa, Grand Unifier',
  'Legendary Creature — Phyrexian Angel',
  'Flying, vigilance, deathtouch, lifelink\nWhen Atraxa enters, reveal the top ten cards of your library. For each card type, you may put a card of that type from among the revealed cards into your hand. Put the rest on the bottom of your library in a random order. (Artifact, battle, creature, enchantment, instant, land, planeswalker, and sorcery are card types.)'
);

const GREAVES = sc(
  'Lightning Greaves',
  'Artifact — Equipment',
  "Equipped creature has haste and shroud. (It can't be the target of spells or abilities.)\nEquip {0}"
);
const BOOTS = sc(
  'Swiftfoot Boots',
  'Artifact — Equipment',
  "Equipped creature has hexproof and haste. (It can't be the target of spells or abilities your opponents control. It can attack and {T} no matter when it came under your control.)\nEquip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)"
);
const HEROIC = sc(
  'Heroic Intervention',
  'Instant',
  'Permanents you control gain hexproof and indestructible until end of turn.'
);
const TEFERIS_PROTECTION = sc(
  "Teferi's Protection",
  'Instant',
  "Until your next turn, your life total can't change and you gain protection from everything. All permanents you control phase out. (While they're phased out, they're treated as though they don't exist. They phase in before you untap during your untap step.)\nExile Teferi's Protection."
);
const FIERCE_GUARDIANSHIP = sc(
  'Fierce Guardianship',
  'Instant',
  'If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell.'
);
const ALLOSAURUS_SHEPHERD = sc(
  'Allosaurus Shepherd',
  'Creature — Elf Shaman',
  "This spell can't be countered.\nGreen spells you control can't be countered.\n{4}{G}{G}: Until end of turn, each Elf creature you control has base power and toughness 5/5 and becomes a Dinosaur in addition to its other creature types."
);

const mustSurvive = (c: ScryfallCard) => commanderMustSurvive([c], buildCommanderProfile(c));

describe('commanderMustSurvive', () => {
  it.each([
    ['Meren (experience counters, end-step recursion)', MEREN],
    ['Krenko (a tap ability)', KRENKO],
    ['Talrand (a cast trigger)', TALRAND],
    ['Lathril (combat damage trigger, tap ability)', LATHRIL],
  ])('is true for %s', (_label, commander) => {
    expect(mustSurvive(commander)).toBe(true);
  });

  it('is false for a commander whose value is one enters trigger', () => {
    expect(mustSurvive(ATRAXA_GRAND_UNIFIER)).toBe(false);
  });

  it('takes either partner', () => {
    expect(
      commanderMustSurvive(
        [ATRAXA_GRAND_UNIFIER, TALRAND],
        buildCommanderProfile(ATRAXA_GRAND_UNIFIER, TALRAND)
      )
    ).toBe(true);
  });
});

describe('isSurvivalPiece', () => {
  it.each([GREAVES, BOOTS, HEROIC, TEFERIS_PROTECTION])('keeps a permanent alive: %s', (card) => {
    expect(isSurvivalPiece(card)).toBe(true);
  });

  it.each([FIERCE_GUARDIANSHIP, ALLOSAURUS_SHEPHERD])(
    'protects spells, not the commander: %s',
    (card) => {
      expect(isSurvivalPiece(card)).toBe(false);
    }
  );
});

describe('protectionAdmitsFor', () => {
  const cardMap = new Map(
    [GREAVES, BOOTS, HEROIC, FIERCE_GUARDIANSHIP, ALLOSAURUS_SHEPHERD].map((c) => [c.name, c])
  );
  // Lathril, Blade of the Elves's page.
  const lathrilPool = [
    ec('Lightning Greaves', 34.4),
    ec('Swiftfoot Boots', 36.0),
    ec('Heroic Intervention', 50.9),
    ec('Allosaurus Shepherd', 31.2),
  ];

  it('promotes the highest-inclusion pieces, at most PROTECTION_PICK_CAP', () => {
    const admits = protectionAdmitsFor(lathrilPool, cardMap, []);
    expect(PROTECTION_PICK_CAP).toBe(2);
    expect([...admits]).toEqual(['Heroic Intervention', 'Swiftfoot Boots']);
  });

  it('counts pieces already seated and never re-admits one', () => {
    expect([...protectionAdmitsFor(lathrilPool, cardMap, [HEROIC])]).toEqual(['Swiftfoot Boots']);
    expect(protectionAdmitsFor(lathrilPool, cardMap, [HEROIC, GREAVES]).size).toBe(0);
  });

  it('ignores a spell-protection piece in the seated count', () => {
    expect(protectionAdmitsFor(lathrilPool, cardMap, [FIERCE_GUARDIANSHIP]).size).toBe(2);
  });

  it('skips a piece this page barely plays', () => {
    // Meren of Clan Nel Toth: Swiftfoot Boots 18.8%.
    expect(protectionAdmitsFor([ec('Swiftfoot Boots', 18.8)], cardMap, []).size).toBe(0);
  });

  it('is off for a commander that need not survive', () => {
    expect(makeProtectionAdmits(false, cardMap, () => [])).toBeUndefined();
    expect(makeProtectionAdmits(true, cardMap, () => [])?.(lathrilPool).size).toBe(2);
  });
});
