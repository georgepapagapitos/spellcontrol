import { describe, it, expect } from 'vitest';
import { buildCommanderProfile } from './commanderProfile';
import { whyCardMatches } from './whyCardMatches';
import type { ScryfallCard } from '@/deck-builder/types';

// The voltron reason matched any Aura by type line, so Wild Growth ("Enchant
// land") read as "Suits up / protects your commander" in a Galea deck. Oracle
// text below is verbatim from Scryfall.

const SUITS_UP = 'Suits up / protects your commander';

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id-1',
    oracle_id: 'oracle-1',
    name: 'Test Card',
    cmc: 3,
    type_line: 'Legendary Creature',
    oracle_text: '',
    color_identity: ['G', 'W', 'U'],
    keywords: [],
    rarity: 'mythic',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

const galea = makeCard({
  name: 'Galea, Kindler of Hope',
  type_line: 'Legendary Creature — Elf Knight',
  power: '4',
  toughness: '4',
  keywords: ['Vigilance'],
  oracle_text:
    'Vigilance\nYou may look at the top card of your library any time.\nYou may cast Aura and Equipment spells from the top of your library. When you cast an Equipment spell this way, it gains "When this Equipment enters, attach it to target creature you control."',
});
const profile = buildCommanderProfile(galea);

const reasonsFor = (name: string, type_line: string, oracle_text: string) =>
  whyCardMatches(makeCard({ name, type_line, oracle_text }), profile);

describe('voltron reason only for cards that suit up a creature', () => {
  it('reads Galea as a voltron commander', () => {
    expect(profile.abilities.map((a) => a.keyword)).toContain('voltron');
  });

  it.each([
    [
      'Wild Growth',
      'Enchantment — Aura',
      'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.',
    ],
    [
      'Utopia Sprawl',
      'Enchantment — Aura',
      'Enchant Forest\nAs Utopia Sprawl enters, choose a color.\nWhenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.',
    ],
    [
      'Pacifism',
      'Enchantment — Aura',
      "Enchant creature\nEnchanted creature can't attack or block.",
    ],
    [
      'Darksteel Mutation',
      'Enchantment — Aura',
      'Enchant creature\nEnchanted creature is an Insect artifact creature with base power and toughness 0/1 and has indestructible, and it loses all other abilities, card types, and creature types.',
    ],
    ['Weakness', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets -2/-1.'],
  ])('%s', (name, type, oracle) => {
    expect(reasonsFor(name, type, oracle)).not.toContain(SUITS_UP);
  });

  it.each([
    [
      'Ethereal Armor',
      'Enchantment — Aura',
      'Enchant creature\nEnchanted creature gets +1/+1 for each enchantment you control and has first strike.',
    ],
    [
      'Rancor',
      'Enchantment — Aura',
      "Enchant creature\nEnchanted creature gets +2/+0 and has trample.\nWhen Rancor is put into a graveyard from the battlefield, return Rancor to its owner's hand.",
    ],
    [
      'Swiftfoot Boots',
      'Artifact — Equipment',
      'Equipped creature has hexproof and haste.\nEquip {1}',
    ],
    [
      'Shadowspear',
      'Legendary Artifact — Equipment',
      'Equipped creature gets +1/+1 and has trample and lifelink.\n{1}: Permanents your opponents control lose hexproof and indestructible until end of turn.\nEquip {2}',
    ],
    [
      'Heroic Intervention',
      'Instant',
      'Permanents you control gain hexproof and indestructible until end of turn.',
    ],
    [
      "Rogue's Passage",
      'Land',
      "{T}: Add {C}.\n{4}, {T}: Target creature can't be blocked this turn.",
    ],
  ])('%s', (name, type, oracle) => {
    expect(reasonsFor(name, type, oracle)).toContain(SUITS_UP);
  });

  it('ignores a card that strips protection', () => {
    expect(
      reasonsFor(
        'Arcane Lighthouse',
        'Land',
        "{T}: Add {C}.\n{1}, {T}: Until end of turn, creatures your opponents control lose hexproof and shroud and can't have hexproof or shroud."
      )
    ).not.toContain(SUITS_UP);
  });
});
