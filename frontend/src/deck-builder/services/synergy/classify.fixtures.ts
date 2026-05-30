// AUTO-ASSEMBLED from real Scryfall data + hand labels. Oracle text is
// ground-truth (fetched live); `expect` is the reviewer's functional label.
// Regenerate by re-running the eval fetch; edit labels by hand.
import type { AxisKey } from './axes';

export interface CorpusCard {
  name: string;
  type_line: string;
  keywords: string[];
  oracle_text: string;
  expect: { producers: AxisKey[]; payoffs: AxisKey[] };
}

export const CORPUS: CorpusCard[] = [
  {
    name: 'Krenko, Mob Boss',
    type_line: 'Legendary Creature — Goblin Warrior',
    keywords: [],
    oracle_text:
      '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: 'Avenger of Zendikar',
    type_line: 'Creature — Elemental',
    keywords: ['Landfall'],
    oracle_text:
      'When this creature enters, create a 0/1 green Plant creature token for each land you control.\nLandfall — Whenever a land you control enters, you may put a +1/+1 counter on each Plant creature you control.',
    expect: { producers: ['tokens', 'counters'], payoffs: [] },
  },
  {
    name: 'Secure the Wastes',
    type_line: 'Instant',
    keywords: [],
    oracle_text: 'Create X 1/1 white Warrior creature tokens.',
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: 'Scute Swarm',
    type_line: 'Creature — Insect',
    keywords: ['Landfall'],
    oracle_text:
      "Landfall — Whenever a land you control enters, create a 1/1 green Insect creature token. If you control six or more lands, create a token that's a copy of this creature instead.",
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: 'Hornet Queen',
    type_line: 'Creature — Insect',
    keywords: ['Deathtouch', 'Flying'],
    oracle_text:
      'Flying, deathtouch\nWhen this creature enters, create four 1/1 green Insect creature tokens with flying and deathtouch.',
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: 'Grave Titan',
    type_line: 'Creature — Giant',
    keywords: ['Deathtouch'],
    oracle_text:
      'Deathtouch\nWhenever this creature enters or attacks, create two 2/2 black Zombie creature tokens.',
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: 'Ophiomancer',
    type_line: 'Creature — Human Shaman',
    keywords: [],
    oracle_text:
      'At the beginning of each upkeep, if you control no Snakes, create a 1/1 black Snake creature token with deathtouch.',
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: 'Geist-Honored Monk',
    type_line: 'Creature — Human Monk',
    keywords: ['Vigilance'],
    oracle_text:
      "Vigilance\nGeist-Honored Monk's power and toughness are each equal to the number of creatures you control.\nWhen this creature enters, create two 1/1 white Spirit creature tokens with flying.",
    expect: { producers: ['tokens'], payoffs: ['tokens'] },
  },
  {
    name: 'Martial Coup',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      'Create X 1/1 white Soldier creature tokens. If X is 5 or more, destroy all other creatures.',
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: 'Smothering Tithe',
    type_line: 'Enchantment',
    keywords: ['Treasure'],
    oracle_text:
      'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: 'Academy Manufactor',
    type_line: 'Artifact Creature — Assembly-Worker',
    keywords: ['Treasure', 'Food'],
    oracle_text: 'If you would create a Clue, Food, or Treasure token, instead create one of each.',
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: 'Tireless Provisioner',
    type_line: 'Creature — Elf Scout',
    keywords: ['Treasure', 'Food', 'Landfall'],
    oracle_text:
      'Landfall — Whenever a land you control enters, create a Food token or a Treasure token. (Food is an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life." Treasure is an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: "Brass's Bounty",
    type_line: 'Sorcery',
    keywords: ['Treasure'],
    oracle_text:
      'For each land you control, create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: "Cathars' Crusade",
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'Whenever a creature you control enters, put a +1/+1 counter on each creature you control.',
    expect: { producers: ['counters'], payoffs: ['tokens'] },
  },
  {
    name: 'Impact Tremors',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'Whenever a creature you control enters, this enchantment deals 1 damage to each opponent.',
    expect: { producers: [], payoffs: ['tokens'] },
  },
  {
    name: 'Purphoros, God of the Forge',
    type_line: 'Legendary Enchantment Creature — God',
    keywords: ['Indestructible'],
    oracle_text:
      "Indestructible\nAs long as your devotion to red is less than five, Purphoros isn't a creature.\nWhenever another creature you control enters, Purphoros deals 2 damage to each opponent.\n{2}{R}: Creatures you control get +1/+0 until end of turn.",
    expect: { producers: [], payoffs: ['tokens'] },
  },
  {
    name: 'Cryptolith Rite',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
    expect: { producers: [], payoffs: ['tokens'] },
  },
  {
    name: 'Intangible Virtue',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text: 'Creature tokens you control get +1/+1 and have vigilance.',
    expect: { producers: [], payoffs: ['tokens'] },
  },
  {
    name: 'Craterhoof Behemoth',
    type_line: 'Creature — Beast',
    keywords: ['Haste'],
    oracle_text:
      'Haste\nWhen this creature enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.',
    expect: { producers: [], payoffs: ['tokens'] },
  },
  {
    name: 'Mondrak, Glory Dominus',
    type_line: 'Legendary Creature — Phyrexian Horror',
    keywords: [],
    oracle_text:
      'If one or more tokens would be created under your control, twice that many of those tokens are created instead.\n{1}{W/P}{W/P}, Sacrifice two other artifacts and/or creatures: Put an indestructible counter on Mondrak. ({W/P} can be paid with either {W} or 2 life.)',
    expect: { producers: ['sacrifice'], payoffs: ['tokens'] },
  },
  {
    name: 'Parallel Lives',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.',
    expect: { producers: [], payoffs: ['tokens'] },
  },
  {
    name: 'Anointed Procession',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.',
    expect: { producers: [], payoffs: ['tokens'] },
  },
  {
    name: "Ashnod's Altar",
    type_line: 'Artifact',
    keywords: [],
    oracle_text: 'Sacrifice a creature: Add {C}{C}.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Goblin Bombardment',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text: 'Sacrifice a creature: This enchantment deals 1 damage to any target.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Skullclamp',
    type_line: 'Artifact — Equipment',
    keywords: ['Equip'],
    oracle_text:
      'Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}',
    expect: { producers: [], payoffs: ['sacrifice'] },
  },
  {
    name: 'Divine Visitation',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'If one or more creature tokens would be created under your control, that many 4/4 white Angel creature tokens with flying and vigilance are created instead.',
    expect: { producers: [], payoffs: ['tokens'] },
  },
  {
    name: 'Beastmaster Ascension',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'Whenever a creature you control attacks, you may put a quest counter on this enchantment.\nAs long as this enchantment has seven or more quest counters on it, creatures you control get +5/+5.',
    expect: { producers: [], payoffs: ['tokens'] },
  },
  {
    name: 'Champion of Lambholt',
    type_line: 'Creature — Human Warrior',
    keywords: [],
    oracle_text:
      "Creatures with power less than this creature's power can't block creatures you control.\nWhenever another creature you control enters, put a +1/+1 counter on this creature.",
    expect: { producers: ['counters'], payoffs: ['tokens'] },
  },
  {
    name: 'Mirror Entity',
    type_line: 'Creature — Shapeshifter',
    keywords: ['Changeling'],
    oracle_text:
      'Changeling (This card is every creature type.)\n{X}: Until end of turn, creatures you control have base power and toughness X/X and gain all creature types.',
    expect: { producers: [], payoffs: ['tokens'] },
  },
  {
    name: 'Beast Within',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Generous Gift',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      'Destroy target permanent. Its controller creates a 3/3 green Elephant creature token.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Stroke of Midnight',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      'Destroy target nonland permanent. Its controller creates a 1/1 white Human creature token.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Angel of Invention',
    type_line: 'Creature — Angel',
    keywords: ['Flying', 'Lifelink', 'Vigilance', 'Fabricate'],
    oracle_text:
      'Flying, vigilance, lifelink\nFabricate 2 (When this creature enters, put two +1/+1 counters on it or create two 1/1 colorless Servo artifact creature tokens.)\nOther creatures you control get +1/+1.',
    expect: { producers: ['tokens', 'counters', 'lifegain'], payoffs: ['tokens'] },
  },
  {
    name: 'Doubling Season',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.\nIf an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.',
    expect: { producers: [], payoffs: ['tokens', 'counters'] },
  },
  {
    name: 'Hardened Scales',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.',
    expect: { producers: [], payoffs: ['counters'] },
  },
  {
    name: 'Walking Ballista',
    type_line: 'Artifact Creature — Construct',
    keywords: [],
    oracle_text:
      'This creature enters with X +1/+1 counters on it.\n{4}: Put a +1/+1 counter on this creature.\nRemove a +1/+1 counter from this creature: It deals 1 damage to any target.',
    expect: { producers: ['counters'], payoffs: ['counters'] },
  },
  {
    name: 'The Ozolith',
    type_line: 'Legendary Artifact',
    keywords: [],
    oracle_text:
      'Whenever a creature you control leaves the battlefield, if it had counters on it, put those counters on The Ozolith.\nAt the beginning of combat on your turn, if The Ozolith has counters on it, you may move all counters from The Ozolith onto target creature.',
    expect: { producers: [], payoffs: ['counters'] },
  },
  {
    name: 'Blood Artist',
    type_line: 'Creature — Vampire',
    keywords: [],
    oracle_text:
      'Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life.',
    expect: { producers: ['lifegain'], payoffs: ['sacrifice'] },
  },
  {
    name: 'Zulaport Cutthroat',
    type_line: 'Creature — Human Rogue Ally',
    keywords: [],
    oracle_text:
      'Whenever this creature or another creature you control dies, each opponent loses 1 life and you gain 1 life.',
    expect: { producers: ['lifegain'], payoffs: ['sacrifice'] },
  },
  {
    name: 'Viscera Seer',
    type_line: 'Creature — Vampire Wizard',
    keywords: ['Scry'],
    oracle_text:
      'Sacrifice a creature: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Soul Warden',
    type_line: 'Creature — Human Cleric',
    keywords: [],
    oracle_text: 'Whenever another creature enters, you gain 1 life.',
    expect: { producers: ['lifegain'], payoffs: ['tokens'] },
  },
  {
    name: 'Sol Ring',
    type_line: 'Artifact',
    keywords: [],
    oracle_text: '{T}: Add {C}{C}.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Counterspell',
    type_line: 'Instant',
    keywords: [],
    oracle_text: 'Counter target spell.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Lightning Bolt',
    type_line: 'Instant',
    keywords: [],
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Cultivate',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Swords to Plowshares',
    type_line: 'Instant',
    keywords: [],
    oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Rhystic Study',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Felidar Retreat',
    type_line: 'Enchantment',
    keywords: ['Landfall'],
    oracle_text:
      'Landfall — Whenever a land you control enters, choose one —\n• Create a 2/2 white Cat Beast creature token.\n• Put a +1/+1 counter on each creature you control. Those creatures gain vigilance until end of turn.',
    expect: { producers: ['tokens', 'counters'], payoffs: ['tokens'] },
  },
  {
    name: 'Adeline, Resplendent Cathar',
    type_line: 'Legendary Creature — Human Knight',
    keywords: ['Vigilance'],
    oracle_text:
      "Vigilance\nAdeline's power is equal to the number of creatures you control.\nWhenever you attack, for each opponent, create a 1/1 white Human creature token that's tapped and attacking that player or a planeswalker they control.",
    expect: { producers: ['tokens'], payoffs: ['tokens'] },
  },
  {
    name: "Elspeth, Sun's Champion",
    type_line: 'Legendary Planeswalker — Elspeth',
    keywords: [],
    oracle_text:
      '+1: Create three 1/1 white Soldier creature tokens.\n−3: Destroy all creatures with power 4 or greater.\n−7: You get an emblem with "Creatures you control get +2/+2 and have flying."',
    expect: { producers: ['tokens'], payoffs: ['tokens'] },
  },
  {
    name: 'Trading Post',
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      '{1}, {T}, Discard a card: You gain 4 life.\n{1}, {T}, Pay 1 life: Create a 0/1 white Goat creature token.\n{1}, {T}, Sacrifice a creature: Return target artifact card from your graveyard to your hand.\n{1}, {T}, Sacrifice an artifact: Draw a card.',
    expect: { producers: ['tokens', 'sacrifice', 'lifegain'], payoffs: [] },
  },
  {
    name: 'Pawn of Ulamog',
    type_line: 'Creature — Vampire Shaman',
    keywords: [],
    oracle_text:
      'Whenever this creature or another nontoken creature you control dies, you may create a 0/1 colorless Eldrazi Spawn creature token. It has "Sacrifice this token: Add {C}."',
    expect: { producers: ['tokens'], payoffs: ['sacrifice'] },
  },
  {
    name: 'Bitterblossom',
    type_line: 'Kindred Enchantment — Faerie',
    keywords: [],
    oracle_text:
      'At the beginning of your upkeep, you lose 1 life and create a 1/1 black Faerie Rogue creature token with flying.',
    expect: { producers: ['tokens'], payoffs: [] },
  },
];
