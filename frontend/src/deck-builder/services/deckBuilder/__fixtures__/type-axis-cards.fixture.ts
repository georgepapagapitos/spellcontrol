// Real Scryfall Oracle text and type lines (default printings, 2026-09),
// the cards E531's type-line producer tests read.
import type { ScryfallCard } from '@/deck-builder/types';

type Printed = Pick<ScryfallCard, 'name' | 'type_line' | 'oracle_text' | 'keywords'>;

const RAW: Printed[] = [
  {
    name: "Sythis, Harvest's Hand",
    type_line: 'Legendary Enchantment Creature — Nymph',
    oracle_text: 'Whenever you cast an enchantment spell, you gain 1 life and draw a card.',
    keywords: [],
  },
  {
    name: 'Eidolon of Blossoms',
    type_line: 'Enchantment Creature — Spirit',
    oracle_text:
      'Constellation — Whenever this creature or another enchantment you control enters, draw a card.',
    keywords: ['Constellation'],
  },
  {
    name: "Enchantress's Presence",
    type_line: 'Enchantment',
    oracle_text: 'Whenever you cast an enchantment spell, draw a card.',
    keywords: [],
  },
  {
    name: 'Zendikar Resurgent',
    type_line: 'Enchantment',
    oracle_text:
      'Whenever you tap a land for mana, add one mana of any type that land produced. (The types of mana are white, blue, black, red, green, and colorless.)\nWhenever you cast a creature spell, draw a card.',
    keywords: [],
  },
  {
    name: 'Rhystic Study',
    type_line: 'Enchantment',
    oracle_text:
      'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
    keywords: [],
  },
  {
    name: 'Wild Growth',
    type_line: 'Enchantment — Aura',
    oracle_text:
      'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.',
    keywords: ['Enchant'],
  },
  {
    name: 'Sterling Grove',
    type_line: 'Enchantment',
    oracle_text:
      "Other enchantments you control have shroud. (They can't be the targets of spells or abilities.)\n{1}, Sacrifice this enchantment: Search your library for an enchantment card, reveal it, then shuffle and put that card on top.",
    keywords: [],
  },
  {
    name: 'Ghostly Prison',
    type_line: 'Enchantment',
    oracle_text:
      "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.",
    keywords: [],
  },
  {
    name: 'Setessan Champion',
    type_line: 'Creature — Human Warrior',
    oracle_text:
      'Constellation — Whenever an enchantment you control enters, put a +1/+1 counter on this creature and draw a card.',
    keywords: ['Constellation'],
  },
  {
    name: 'Argothian Enchantress',
    type_line: 'Creature — Human Druid',
    oracle_text:
      "Shroud (This creature can't be the target of spells or abilities.)\nWhenever you cast an enchantment spell, draw a card.",
    keywords: ['Shroud'],
  },
  {
    name: 'Talrand, Sky Summoner',
    type_line: 'Legendary Creature — Merfolk Wizard',
    oracle_text:
      'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.',
    keywords: [],
  },
  {
    name: 'Archmage Emeritus',
    type_line: 'Creature — Human Wizard',
    oracle_text: 'Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card.',
    keywords: ['Magecraft'],
  },
  {
    name: 'Young Pyromancer',
    type_line: 'Creature — Human Shaman',
    oracle_text:
      'Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.',
    keywords: [],
  },
  {
    name: 'Baral, Chief of Compliance',
    type_line: 'Legendary Creature — Human Wizard',
    oracle_text:
      'Instant and sorcery spells you cast cost {1} less to cast.\nWhenever a spell or ability you control counters a spell, you may draw a card. If you do, discard a card.',
    keywords: [],
  },
  {
    name: 'Ponder',
    type_line: 'Sorcery',
    oracle_text:
      'Look at the top three cards of your library, then put them back in any order. You may shuffle.\nDraw a card.',
    keywords: [],
  },
  {
    name: 'Brainstorm',
    type_line: 'Instant',
    oracle_text:
      'Draw three cards, then put two cards from your hand on top of your library in any order.',
    keywords: [],
  },
  {
    name: 'Counterspell',
    type_line: 'Instant',
    oracle_text: 'Counter target spell.',
    keywords: [],
  },
  {
    name: 'Fact or Fiction',
    type_line: 'Instant',
    oracle_text:
      'Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.',
    keywords: [],
  },
  {
    name: 'Lightning Bolt',
    type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    keywords: [],
  },
  {
    name: 'Swords to Plowshares',
    type_line: 'Instant',
    oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
    keywords: [],
  },
  {
    name: 'Cast Down',
    type_line: 'Instant',
    oracle_text: 'Destroy target nonlegendary creature.',
    keywords: [],
  },
  {
    name: 'Lotus Cobra',
    type_line: 'Creature — Snake',
    oracle_text: 'Landfall — Whenever a land you control enters, add one mana of any color.',
    keywords: ['Landfall'],
  },
  {
    name: 'Avenger of Zendikar',
    type_line: 'Creature — Elemental',
    oracle_text:
      'When this creature enters, create a 0/1 green Plant creature token for each land you control.\nLandfall — Whenever a land you control enters, you may put a +1/+1 counter on each Plant creature you control.',
    keywords: ['Landfall'],
  },
  {
    name: 'Tatyova, Benthic Druid',
    type_line: 'Legendary Creature — Merfolk Druid',
    oracle_text: 'Landfall — Whenever a land you control enters, you gain 1 life and draw a card.',
    keywords: ['Landfall'],
  },
  {
    name: 'Field of the Dead',
    type_line: 'Land',
    oracle_text:
      'This land enters tapped.\n{T}: Add {C}.\nWhenever this land or another land you control enters, if you control seven or more lands with different names, create a 2/2 black Zombie creature token.',
    keywords: [],
  },
  {
    name: 'Command Tower',
    type_line: 'Land',
    oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
    keywords: [],
  },
  {
    name: 'Terramorphic Expanse',
    type_line: 'Land',
    oracle_text:
      '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
    keywords: [],
  },
  {
    name: 'Evolving Wilds',
    type_line: 'Land',
    oracle_text:
      '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
    keywords: [],
  },
  {
    name: 'Utopia Sprawl',
    type_line: 'Enchantment — Aura',
    oracle_text:
      'Enchant Forest\nAs this Aura enters, choose a color.\nWhenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.',
    keywords: ['Enchant'],
  },
  {
    name: 'Cultivate',
    type_line: 'Sorcery',
    oracle_text:
      'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    keywords: [],
  },
  {
    name: 'Rampant Growth',
    type_line: 'Sorcery',
    oracle_text:
      'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
    keywords: [],
  },
  {
    name: 'Sol Ring',
    type_line: 'Artifact',
    oracle_text: '{T}: Add {C}{C}.',
    keywords: [],
  },
  {
    name: 'Arcane Signet',
    type_line: 'Artifact',
    oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
    keywords: [],
  },
  {
    name: 'Swiftfoot Boots',
    type_line: 'Artifact — Equipment',
    oracle_text:
      "Equipped creature has hexproof and haste. (It can't be the target of spells or abilities your opponents control. It can attack and {T} no matter when it came under your control.)\nEquip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)",
    keywords: ['Equip'],
  },
  {
    name: 'Lightning Greaves',
    type_line: 'Artifact — Equipment',
    oracle_text:
      "Equipped creature has haste and shroud. (It can't be the target of spells or abilities.)\nEquip {0}",
    keywords: ['Equip'],
  },
  {
    name: 'Forest',
    type_line: 'Basic Land — Forest',
    oracle_text: '({T}: Add {G}.)',
    keywords: [],
  },
  {
    name: 'Island',
    type_line: 'Basic Land — Island',
    oracle_text: '({T}: Add {U}.)',
    keywords: [],
  },
];

/** Minimal ScryfallCard for the classifier and the tally: the rest is inert. */
export const TYPE_AXIS_CARDS: ReadonlyMap<string, ScryfallCard> = new Map(
  RAW.map((c) => [
    c.name,
    {
      id: c.name,
      oracle_id: c.name,
      cmc: 0,
      color_identity: [],
      rarity: 'rare',
      set: 'tst',
      set_name: 'Test',
      prices: {},
      legalities: { commander: 'legal' },
      ...c,
    } as ScryfallCard,
  ])
);
