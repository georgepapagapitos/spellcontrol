/**
 * Real Scryfall oracle text (oracle_cards bulk, 2026-10-24), copied verbatim, not
 * author-written, with the Scryfall oracle tags (otag index, 2026-10-05) restricted
 * to the ones `archetypeComponents.ts` reads. Keyed by card name.
 */
export interface RealCard {
  name: string;
  type_line: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string; type_line?: string }>;
  tags: string[];
}

export const REAL: Record<string, RealCard> = {
  'Viscera Seer': {
    name: 'Viscera Seer',
    type_line: 'Creature — Vampire Wizard',
    oracle_text:
      'Sacrifice a creature: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)',
    tags: [],
  },
  "Ashnod's Altar": {
    name: "Ashnod's Altar",
    type_line: 'Artifact',
    oracle_text: 'Sacrifice a creature: Add {C}{C}.',
    tags: [],
  },
  'Goblin Bombardment': {
    name: 'Goblin Bombardment',
    type_line: 'Enchantment',
    oracle_text: 'Sacrifice a creature: This enchantment deals 1 damage to any target.',
    tags: [],
  },
  'Carrion Feeder': {
    name: 'Carrion Feeder',
    type_line: 'Creature — Zombie',
    oracle_text:
      "This creature can't block.\nSacrifice a creature: Put a +1/+1 counter on this creature.",
    tags: [],
  },
  'Village Rites': {
    name: 'Village Rites',
    type_line: 'Instant',
    oracle_text: 'As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards.',
    tags: [],
  },
  'Goblin Grenade': {
    name: 'Goblin Grenade',
    type_line: 'Sorcery',
    oracle_text:
      'As an additional cost to cast this spell, sacrifice a Goblin.\nGoblin Grenade deals 5 damage to any target.',
    tags: [],
  },
  'Blood Artist': {
    name: 'Blood Artist',
    type_line: 'Creature — Vampire',
    oracle_text:
      'Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life.',
    tags: ['blood-artist-ability'],
  },
  'Zulaport Cutthroat': {
    name: 'Zulaport Cutthroat',
    type_line: 'Creature — Human Rogue Ally',
    oracle_text:
      'Whenever this creature or another creature you control dies, each opponent loses 1 life and you gain 1 life.',
    tags: ['blood-artist-ability'],
  },
  'Falkenrath Noble': {
    name: 'Falkenrath Noble',
    type_line: 'Creature — Vampire Noble',
    oracle_text:
      'Flying\nWhenever this creature or another creature dies, target player loses 1 life and you gain 1 life.',
    tags: ['blood-artist-ability'],
  },
  Bitterblossom: {
    name: 'Bitterblossom',
    type_line: 'Kindred Enchantment — Faerie',
    oracle_text:
      'At the beginning of your upkeep, you lose 1 life and create a 1/1 black Faerie Rogue creature token with flying.',
    tags: [],
  },
  Ophiomancer: {
    name: 'Ophiomancer',
    type_line: 'Creature — Human Shaman',
    oracle_text:
      'At the beginning of each upkeep, if you control no Snakes, create a 1/1 black Snake creature token with deathtouch.',
    tags: [],
  },
  'Smothering Tithe': {
    name: 'Smothering Tithe',
    type_line: 'Enchantment',
    oracle_text:
      'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
    tags: [],
  },
  'Glorious Anthem': {
    name: 'Glorious Anthem',
    type_line: 'Enchantment',
    oracle_text: 'Creatures you control get +1/+1.',
    tags: ['anthem'],
  },
  'Heroic Intervention': {
    name: 'Heroic Intervention',
    type_line: 'Instant',
    oracle_text: 'Permanents you control gain hexproof and indestructible until end of turn.',
    tags: [
      'gives-hexproof',
      'gives-indestructible',
      'protection',
      'protects-all',
      'protects-creature',
      'protects-permanent',
    ],
  },
  "Teferi's Protection": {
    name: "Teferi's Protection",
    type_line: 'Instant',
    oracle_text:
      "Until your next turn, your life total can't change and you gain protection from everything. All permanents you control phase out. (While they're phased out, they're treated as though they don't exist. They phase in before you untap during your untap step.)\nExile Teferi's Protection.",
    tags: ['protection', 'protects-all', 'protects-creature'],
  },
  'Lightning Greaves': {
    name: 'Lightning Greaves',
    type_line: 'Artifact — Equipment',
    oracle_text:
      "Equipped creature has haste and shroud. (It can't be the target of spells or abilities.)\nEquip {0}",
    tags: ['gives-shroud', 'protection', 'protects-creature'],
  },
  'Mother of Runes': {
    name: 'Mother of Runes',
    type_line: 'Creature — Human Cleric',
    oracle_text:
      '{T}: Target creature you control gains protection from the color of your choice until end of turn.',
    tags: ['gives-protection', 'protection', 'protects-creature'],
  },
  'Swords to Plowshares': {
    name: 'Swords to Plowshares',
    type_line: 'Instant',
    oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
    tags: [],
  },
  Guttersnipe: {
    name: 'Guttersnipe',
    type_line: 'Creature — Goblin Shaman',
    oracle_text:
      'Whenever you cast an instant or sorcery spell, this creature deals 2 damage to each opponent.',
    tags: [],
  },
  'Young Pyromancer': {
    name: 'Young Pyromancer',
    type_line: 'Creature — Human Shaman',
    oracle_text:
      'Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.',
    tags: [],
  },
  'Murmuring Mystic': {
    name: 'Murmuring Mystic',
    type_line: 'Creature — Human Wizard',
    oracle_text:
      'Whenever you cast an instant or sorcery spell, create a 1/1 blue Bird Illusion creature token with flying.',
    tags: [],
  },
  'Rhystic Study': {
    name: 'Rhystic Study',
    type_line: 'Enchantment',
    oracle_text:
      'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
    tags: [],
  },
  'Lightning Bolt': {
    name: 'Lightning Bolt',
    type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    tags: [],
  },
  Counterspell: {
    name: 'Counterspell',
    type_line: 'Instant',
    oracle_text: 'Counter target spell.',
    tags: [],
  },
  Cultivate: {
    name: 'Cultivate',
    type_line: 'Sorcery',
    oracle_text:
      'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    tags: ['land-ramp', 'tutor-land', 'tutor-land-basic', 'tutor-land-to-battlefield'],
  },
  'Rampant Growth': {
    name: 'Rampant Growth',
    type_line: 'Sorcery',
    oracle_text:
      'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
    tags: ['land-ramp', 'tutor-land', 'tutor-land-basic', 'tutor-land-to-battlefield'],
  },
  'Rampaging Baloths': {
    name: 'Rampaging Baloths',
    type_line: 'Creature — Beast',
    oracle_text:
      'Trample\nLandfall — Whenever a land you control enters, create a 4/4 green Beast creature token.',
    tags: ['landfall'],
  },
  'Lotus Cobra': {
    name: 'Lotus Cobra',
    type_line: 'Creature — Snake',
    oracle_text: 'Landfall — Whenever a land you control enters, add one mana of any color.',
    tags: ['landfall'],
  },
  Entomb: {
    name: 'Entomb',
    type_line: 'Instant',
    oracle_text: 'Search your library for a card, put that card into your graveyard, then shuffle.',
    tags: ['tutor-to-graveyard'],
  },
  'Faithless Looting': {
    name: 'Faithless Looting',
    type_line: 'Sorcery',
    oracle_text:
      'Draw two cards, then discard two cards.\nFlashback {2}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
    tags: ['loot'],
  },
  "Stitcher's Supplier": {
    name: "Stitcher's Supplier",
    type_line: 'Creature — Zombie',
    oracle_text:
      'When this creature enters or dies, mill three cards. (Put the top three cards of your library into your graveyard.)',
    tags: ['mill-self'],
  },
  Reanimate: {
    name: 'Reanimate',
    type_line: 'Sorcery',
    oracle_text:
      "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value.",
    tags: [],
  },
  'Animate Dead': {
    name: 'Animate Dead',
    type_line: 'Enchantment — Aura',
    oracle_text:
      'Enchant creature card in a graveyard\nWhen this Aura enters, if it\'s on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with this Aura." Return enchanted creature card to the battlefield under your control and attach this Aura to it. When this Aura leaves the battlefield, that creature\'s controller sacrifices it.\nEnchanted creature gets -1/-0.',
    tags: [],
  },
  'Sun Titan': {
    name: 'Sun Titan',
    type_line: 'Creature — Giant',
    oracle_text:
      'Vigilance\nWhenever this creature enters or attacks, you may return target permanent card with mana value 3 or less from your graveyard to the battlefield.',
    tags: ['land-ramp'],
  },
  Gravecrawler: {
    name: 'Gravecrawler',
    type_line: 'Creature — Zombie',
    oracle_text:
      "This creature can't block.\nYou may cast this card from your graveyard as long as you control a Zombie.",
    tags: [],
  },
  'Eternal Witness': {
    name: 'Eternal Witness',
    type_line: 'Creature — Human Shaman',
    oracle_text:
      'When this creature enters, you may return target card from your graveyard to your hand.',
    tags: [],
  },
  Regrowth: {
    name: 'Regrowth',
    type_line: 'Sorcery',
    oracle_text: 'Return target card from your graveyard to your hand.',
    tags: [],
  },
  'Sol Ring': {
    name: 'Sol Ring',
    type_line: 'Artifact',
    oracle_text: '{T}: Add {C}{C}.',
    tags: [],
  },
  'Grizzly Bears': {
    name: 'Grizzly Bears',
    type_line: 'Creature — Bear',
    oracle_text: '',
    tags: [],
  },
  "Mirari's Wake": {
    name: "Mirari's Wake",
    type_line: 'Enchantment',
    oracle_text:
      'Creatures you control get +1/+1.\nWhenever you tap a land for mana, add one mana of any type that land produced.',
    tags: ['anthem'],
  },
  'Doubling Season': {
    name: 'Doubling Season',
    type_line: 'Enchantment',
    oracle_text:
      'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.\nIf an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.',
    tags: [],
  },
  'Grave Titan': {
    name: 'Grave Titan',
    type_line: 'Creature — Giant',
    oracle_text:
      'Deathtouch\nWhenever this creature enters or attacks, create two 2/2 black Zombie creature tokens.',
    tags: [],
  },
  'Krenko, Mob Boss': {
    name: 'Krenko, Mob Boss',
    type_line: 'Legendary Creature — Goblin Warrior',
    oracle_text:
      '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
    tags: [],
  },
  Overrun: {
    name: 'Overrun',
    type_line: 'Sorcery',
    oracle_text:
      "Creatures you control get +3/+3 and gain trample until end of turn. (Each of those creatures can deal excess combat damage to the player or planeswalker it's attacking.)",
    tags: ['overrun'],
  },
  'Sakura-Tribe Elder': {
    name: 'Sakura-Tribe Elder',
    type_line: 'Creature — Snake Shaman',
    oracle_text:
      'Sacrifice this creature: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
    tags: ['land-ramp', 'tutor-land', 'tutor-land-basic', 'tutor-land-to-battlefield'],
  },
  'Bloodbraid Elf': {
    name: 'Bloodbraid Elf',
    type_line: 'Creature — Elf Berserker',
    oracle_text:
      'Haste (This creature can attack and {T} as soon as it comes under your control.)\nCascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)',
    tags: [],
  },
  Forest: {
    name: 'Forest',
    type_line: 'Basic Land — Forest',
    oracle_text: '({T}: Add {G}.)',
    tags: [],
  },
  'Yawgmoth, Thran Physician': {
    name: 'Yawgmoth, Thran Physician',
    type_line: 'Legendary Creature — Human Cleric',
    oracle_text:
      'Protection from Humans\nPay 1 life, Sacrifice another creature: Put a -1/-1 counter on up to one target creature and draw a card.\n{B}{B}, Discard a card: Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)',
    tags: [],
  },
};
