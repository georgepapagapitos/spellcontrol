// AUTO-ASSEMBLED from real Scryfall data + hand labels. Oracle text is
// ground-truth (fetched live); `expect` is the reviewer's functional label.
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
    expect: { producers: ['tokens', 'counters'], payoffs: ['landfall'] },
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
    expect: { producers: ['tokens'], payoffs: ['landfall'] },
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
    expect: { producers: ['artifacts'], payoffs: [] },
  },
  {
    name: 'Academy Manufactor',
    type_line: 'Artifact Creature — Assembly-Worker',
    keywords: ['Treasure', 'Food'],
    oracle_text: 'If you would create a Clue, Food, or Treasure token, instead create one of each.',
    expect: { producers: ['artifacts'], payoffs: [] },
  },
  {
    name: 'Tireless Provisioner',
    type_line: 'Creature — Elf Scout',
    keywords: ['Treasure', 'Food', 'Landfall'],
    oracle_text:
      'Landfall — Whenever a land you control enters, create a Food token or a Treasure token. (Food is an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life." Treasure is an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
    expect: { producers: ['artifacts'], payoffs: ['landfall'] },
  },
  {
    name: "Brass's Bounty",
    type_line: 'Sorcery',
    keywords: ['Treasure'],
    oracle_text:
      'For each land you control, create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
    expect: { producers: ['artifacts'], payoffs: [] },
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
    expect: { producers: ['equipment'], payoffs: ['sacrifice'] },
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
    expect: { producers: ['tokens', 'counters', 'lifegain', 'artifacts'], payoffs: ['tokens'] },
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
    expect: { producers: ['landfall'], payoffs: [] },
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
    expect: { producers: ['tokens', 'counters'], payoffs: ['tokens', 'landfall'] },
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
    // A planeswalker is itself a superfriends producer (the loyalty engine).
    expect: { producers: ['tokens', 'superfriends'], payoffs: ['tokens'] },
  },
  {
    name: 'Trading Post',
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      '{1}, {T}, Discard a card: You gain 4 life.\n{1}, {T}, Pay 1 life: Create a 0/1 white Goat creature token.\n{1}, {T}, Sacrifice a creature: Return target artifact card from your graveyard to your hand.\n{1}, {T}, Sacrifice an artifact: Draw a card.',
    expect: { producers: ['tokens', 'sacrifice', 'lifegain'], payoffs: ['graveyard'] },
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
  {
    name: 'Exploration',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text: 'You may play an additional land on each of your turns.',
    expect: { producers: ['landfall'], payoffs: [] },
  },
  {
    name: 'Azusa, Lost but Seeking',
    type_line: 'Legendary Creature — Human Monk',
    keywords: [],
    oracle_text: 'You may play two additional lands on each of your turns.',
    expect: { producers: ['landfall'], payoffs: [] },
  },
  {
    name: 'Sakura-Tribe Elder',
    type_line: 'Creature — Snake Shaman',
    keywords: [],
    oracle_text:
      'Sacrifice this creature: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
    expect: { producers: ['landfall'], payoffs: [] },
  },
  {
    name: 'Lotus Cobra',
    type_line: 'Creature — Snake',
    keywords: ['Landfall'],
    oracle_text: 'Landfall — Whenever a land you control enters, add one mana of any color.',
    expect: { producers: [], payoffs: ['landfall'] },
  },
  {
    name: 'Rampaging Baloths',
    type_line: 'Creature — Beast',
    keywords: ['Trample', 'Landfall'],
    oracle_text:
      'Trample\nLandfall — Whenever a land you control enters, create a 4/4 green Beast creature token.',
    expect: { producers: ['tokens'], payoffs: ['landfall'] },
  },
  {
    name: 'Harrow',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      'As an additional cost to cast this spell, sacrifice a land.\nSearch your library for up to two basic land cards, put them onto the battlefield, then shuffle.',
    expect: { producers: ['landfall'], payoffs: [] },
  },
  {
    name: 'Reanimate',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value.",
    expect: { producers: [], payoffs: ['graveyard'] },
  },
  {
    name: 'Animate Dead',
    type_line: 'Enchantment — Aura',
    keywords: ['Enchant'],
    oracle_text:
      'Enchant creature card in a graveyard\nWhen this Aura enters, if it\'s on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with this Aura." Return enchanted creature card to the battlefield under your control and attach this Aura to it. When this Aura leaves the battlefield, that creature\'s controller sacrifices it.\nEnchanted creature gets -1/-0.',
    expect: { producers: [], payoffs: ['graveyard'] },
  },
  {
    name: 'Sun Titan',
    type_line: 'Creature — Giant',
    keywords: ['Vigilance'],
    oracle_text:
      'Vigilance\nWhenever this creature enters or attacks, you may return target permanent card with mana value 3 or less from your graveyard to the battlefield.',
    expect: { producers: [], payoffs: ['graveyard'] },
  },
  {
    name: 'Eternal Witness',
    type_line: 'Creature — Human Shaman',
    keywords: [],
    oracle_text:
      'When this creature enters, you may return target card from your graveyard to your hand.',
    expect: { producers: [], payoffs: ['graveyard'] },
  },
  {
    name: "Stitcher's Supplier",
    type_line: 'Creature — Zombie',
    keywords: ['Mill'],
    oracle_text:
      'When this creature enters or dies, mill three cards. (Put the top three cards of your library into your graveyard.)',
    expect: { producers: ['graveyard'], payoffs: [] },
  },
  {
    name: 'Hermit Druid',
    type_line: 'Creature — Human Druid',
    keywords: [],
    oracle_text:
      '{G}, {T}: Reveal cards from the top of your library until you reveal a basic land card. Put that card into your hand and all other cards revealed this way into your graveyard.',
    expect: { producers: ['graveyard'], payoffs: [] },
  },
  {
    name: 'Altar of Dementia',
    type_line: 'Artifact',
    keywords: ['Mill'],
    oracle_text:
      "Sacrifice a creature: Target player mills cards equal to the sacrificed creature's power.",
    expect: { producers: ['sacrifice', 'graveyard'], payoffs: [] },
  },
  {
    name: 'Rest in Peace',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'When this enchantment enters, exile all graveyards.\nIf a card or token would be put into a graveyard from anywhere, exile it instead.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Reckless Fireweaver',
    type_line: 'Creature — Human Artificer',
    keywords: [],
    oracle_text:
      'Whenever an artifact you control enters, this creature deals 1 damage to each opponent.',
    expect: { producers: [], payoffs: ['artifacts'] },
  },
  {
    name: 'Sai, Master Thopterist',
    type_line: 'Legendary Creature — Human Artificer',
    keywords: [],
    oracle_text:
      'Whenever you cast an artifact spell, create a 1/1 colorless Thopter artifact creature token with flying.\n{1}{U}, Sacrifice two artifacts: Draw a card.',
    expect: { producers: ['tokens', 'sacrifice', 'artifacts'], payoffs: ['artifacts'] },
  },
  {
    name: 'Marionette Master',
    type_line: 'Creature — Human Artificer',
    keywords: ['Fabricate'],
    oracle_text:
      "Fabricate 3 (When this creature enters, put three +1/+1 counters on it or create three 1/1 colorless Servo artifact creature tokens.)\nWhenever an artifact you control is put into a graveyard from the battlefield, target opponent loses life equal to this creature's power.",
    expect: { producers: ['tokens', 'counters', 'artifacts'], payoffs: ['artifacts'] },
  },
  {
    name: 'Mox Opal',
    type_line: 'Legendary Artifact',
    keywords: ['Metalcraft'],
    oracle_text:
      'Metalcraft — {T}: Add one mana of any color. Activate only if you control three or more artifacts.',
    expect: { producers: [], payoffs: ['artifacts'] },
  },
  {
    name: 'Cranial Plating',
    type_line: 'Artifact — Equipment',
    keywords: ['Equip'],
    oracle_text:
      'Equipped creature gets +1/+0 for each artifact you control.\n{B}{B}: Attach this Equipment to target creature you control.\nEquip {1}',
    expect: { producers: ['equipment'], payoffs: ['artifacts'] },
  },
  {
    name: 'Urza, Lord High Artificer',
    type_line: 'Legendary Creature — Human Artificer',
    keywords: [],
    oracle_text:
      'When Urza enters, create a 0/0 colorless Construct artifact creature token with "This token gets +1/+1 for each artifact you control."\nTap an untapped artifact you control: Add {U}.\n{5}: Shuffle your library, then exile the top card. Until end of turn, you may play that card without paying its mana cost.',
    expect: { producers: ['tokens', 'artifacts'], payoffs: ['artifacts'] },
  },
  {
    name: 'Pitiless Plunderer',
    type_line: 'Creature — Human Pirate',
    keywords: ['Treasure'],
    oracle_text:
      'Whenever another creature you control dies, create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
    expect: { producers: ['artifacts'], payoffs: ['sacrifice'] },
  },
  {
    name: 'Bloodthirster',
    type_line: 'Creature — Demon',
    keywords: ['Flying', 'Trample'],
    oracle_text:
      "Flying, trample\nWhenever this creature deals combat damage to a player, untap it. After this phase, there is an additional combat phase.\nThis creature can't attack a player it has already attacked this turn.",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Sram, Senior Edificer',
    type_line: 'Legendary Creature — Dwarf Advisor',
    keywords: [],
    oracle_text: 'Whenever you cast an Aura, Equipment, or Vehicle spell, draw a card.',
    expect: { producers: [], payoffs: ['equipment'] },
  },
  {
    name: 'Puresteel Paladin',
    type_line: 'Creature — Human Knight',
    keywords: ['Metalcraft'],
    oracle_text:
      'Whenever an Equipment you control enters, you may draw a card.\nMetalcraft — Equipment you control have equip {0} as long as you control three or more artifacts.',
    expect: { producers: [], payoffs: ['equipment', 'artifacts'] },
  },
  {
    name: 'Stoneforge Mystic',
    type_line: 'Creature — Kor Artificer',
    keywords: [],
    oracle_text:
      'When this creature enters, you may search your library for an Equipment card, reveal it, put it into your hand, then shuffle.\n{1}{W}, {T}: You may put an Equipment card from your hand onto the battlefield.',
    expect: { producers: [], payoffs: ['equipment'] },
  },
  {
    name: "Sigarda's Aid",
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'You may cast Aura and Equipment spells as though they had flash.\nWhenever an Equipment you control enters, you may attach it to target creature you control.',
    expect: { producers: [], payoffs: ['equipment'] },
  },
  {
    name: 'Batterskull',
    type_line: 'Artifact — Equipment',
    keywords: ['Equip', 'Living weapon'],
    oracle_text:
      "Living weapon (When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.)\nEquipped creature gets +4/+4 and has vigilance and lifelink.\n{3}: Return this Equipment to its owner's hand.\nEquip {5}",
    expect: { producers: ['tokens', 'equipment'], payoffs: [] },
  },
  {
    name: 'Young Pyromancer',
    type_line: 'Creature — Human Shaman',
    keywords: [],
    oracle_text:
      'Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.',
    expect: { producers: ['tokens'], payoffs: ['spellslinger'] },
  },
  {
    name: 'Guttersnipe',
    type_line: 'Creature — Goblin Shaman',
    keywords: [],
    oracle_text:
      'Whenever you cast an instant or sorcery spell, this creature deals 2 damage to each opponent.',
    expect: { producers: [], payoffs: ['spellslinger'] },
  },
  {
    name: 'Goblin Electromancer',
    type_line: 'Creature — Goblin Wizard',
    keywords: [],
    oracle_text: 'Instant and sorcery spells you cast cost {1} less to cast.',
    expect: { producers: ['spellslinger'], payoffs: [] },
  },
  {
    name: 'Archmage Emeritus',
    type_line: 'Creature — Human Wizard',
    keywords: ['Magecraft'],
    oracle_text: 'Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card.',
    expect: { producers: [], payoffs: ['spellslinger'] },
  },
  {
    name: 'Storm-Kiln Artist',
    type_line: 'Creature — Dwarf Shaman',
    keywords: ['Treasure', 'Magecraft'],
    oracle_text:
      'This creature gets +1/+0 for each artifact you control.\nMagecraft — Whenever you cast or copy an instant or sorcery spell, create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
    expect: { producers: ['artifacts'], payoffs: ['spellslinger', 'artifacts'] },
  },
  {
    name: 'Talrand, Sky Summoner',
    type_line: 'Legendary Creature — Merfolk Wizard',
    keywords: [],
    oracle_text:
      'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.',
    expect: { producers: ['tokens'], payoffs: ['spellslinger'] },
  },
  {
    name: "Enchantress's Presence",
    type_line: 'Enchantment',
    keywords: [],
    oracle_text: 'Whenever you cast an enchantment spell, draw a card.',
    expect: { producers: [], payoffs: ['enchantress'] },
  },
  {
    name: 'Eidolon of Blossoms',
    type_line: 'Enchantment Creature — Spirit',
    keywords: ['Constellation'],
    oracle_text:
      'Constellation — Whenever this creature or another enchantment you control enters, draw a card.',
    expect: { producers: [], payoffs: ['enchantress'] },
  },
  {
    name: 'Setessan Champion',
    type_line: 'Creature — Human Warrior',
    keywords: ['Constellation'],
    oracle_text:
      'Constellation — Whenever an enchantment you control enters, put a +1/+1 counter on this creature and draw a card.',
    expect: { producers: ['counters'], payoffs: ['enchantress'] },
  },
  {
    name: "Sythis, Harvest's Hand",
    type_line: 'Legendary Enchantment Creature — Nymph',
    keywords: [],
    oracle_text: 'Whenever you cast an enchantment spell, you gain 1 life and draw a card.',
    expect: { producers: ['lifegain'], payoffs: ['enchantress'] },
  },
  {
    name: 'Sterling Grove',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      "Other enchantments you control have shroud. (They can't be the targets of spells or abilities.)\n{1}, Sacrifice this enchantment: Search your library for an enchantment card, reveal it, then shuffle and put that card on top.",
    expect: { producers: ['enchantress'], payoffs: [] },
  },
  {
    name: 'Birds of Paradise',
    type_line: 'Creature — Bird',
    keywords: ['Flying'],
    oracle_text: 'Flying\n{T}: Add one mana of any color.',
    expect: { producers: [], payoffs: [] },
  },

  // ── Superfriends / planeswalkers ──────────────────────────────────────────
  {
    name: 'Teferi, Hero of Dominaria',
    type_line: 'Legendary Planeswalker — Teferi',
    keywords: [],
    oracle_text:
      '+1: Draw a card. At the beginning of the next end step, untap up to two lands.\n−3: Put target nonland permanent into its owner\'s library third from the top.\n−8: You get an emblem with "Whenever you draw a card, exile target permanent an opponent controls."',
    expect: { producers: ['superfriends'], payoffs: [] },
  },
  {
    name: 'Flux Channeler',
    type_line: 'Creature — Human Wizard',
    keywords: ['Proliferate'],
    oracle_text:
      'Whenever you cast a noncreature spell, proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)',
    expect: { producers: ['superfriends'], payoffs: [] },
  },
  {
    name: 'Evolution Sage',
    type_line: 'Creature — Elf Druid',
    keywords: ['Proliferate', 'Landfall'],
    oracle_text:
      'Landfall — Whenever a land you control enters, proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)',
    expect: { producers: ['superfriends'], payoffs: ['landfall'] },
  },
  {
    name: "Atraxa, Praetors' Voice",
    type_line: 'Legendary Creature — Phyrexian Angel Horror',
    keywords: ['Deathtouch', 'Flying', 'Lifelink', 'Vigilance', 'Proliferate'],
    oracle_text:
      'Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)',
    expect: { producers: ['lifegain', 'superfriends'], payoffs: [] },
  },
  {
    name: "Karn's Bastion",
    type_line: 'Land',
    keywords: ['Proliferate'],
    oracle_text:
      '{T}: Add {C}.\n{4}, {T}: Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)',
    expect: { producers: ['superfriends'], payoffs: [] },
  },
  {
    name: 'Sword of Truth and Justice',
    type_line: 'Artifact — Equipment',
    keywords: ['Proliferate', 'Equip'],
    oracle_text:
      'Equipped creature gets +2/+2 and has protection from white and from blue.\nWhenever equipped creature deals combat damage to a player, put a +1/+1 counter on a creature you control, then proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)\nEquip {2}',
    expect: { producers: ['counters', 'equipment', 'superfriends'], payoffs: [] },
  },
  {
    name: 'Oath of Gideon',
    type_line: 'Legendary Enchantment',
    keywords: [],
    oracle_text:
      'When Oath of Gideon enters, create two 1/1 white Kor Ally creature tokens.\nEach planeswalker you control enters with an additional loyalty counter on it.',
    expect: { producers: ['tokens', 'superfriends'], payoffs: ['superfriends'] },
  },
  {
    name: 'Call the Gatewatch',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      'Search your library for a planeswalker card, reveal it, put it into your hand, then shuffle.',
    expect: { producers: ['superfriends'], payoffs: [] },
  },
  {
    name: 'Oath of Teferi',
    type_line: 'Legendary Enchantment',
    keywords: [],
    oracle_text:
      "When Oath of Teferi enters, exile another target permanent you control. Return it to the battlefield under its owner's control at the beginning of the next end step.\nYou may activate the loyalty abilities of planeswalkers you control twice each turn rather than only once.",
    expect: { producers: [], payoffs: ['superfriends'] },
  },
  {
    name: 'The Chain Veil',
    type_line: 'Legendary Artifact',
    keywords: [],
    oracle_text:
      "At the beginning of your end step, if you didn't activate a loyalty ability of a planeswalker this turn, you lose 2 life.\n{4}, {T}: For each planeswalker you control, you may activate one of its loyalty abilities once this turn as though none of its loyalty abilities have been activated this turn.",
    expect: { producers: [], payoffs: ['superfriends'] },
  },
  {
    name: 'Carth the Lion',
    type_line: 'Legendary Creature — Human Warrior',
    keywords: [],
    oracle_text:
      "Whenever Carth enters or a planeswalker you control dies, look at the top seven cards of your library. You may reveal a planeswalker card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.\nPlaneswalkers' loyalty abilities you activate cost an additional [+1] to activate.",
    expect: { producers: ['superfriends'], payoffs: ['superfriends'] },
  },
  {
    name: 'Interplanar Beacon',
    type_line: 'Land',
    keywords: [],
    oracle_text:
      'Whenever you cast a planeswalker spell, you gain 1 life.\n{T}: Add {C}.\n{1}, {T}: Add two mana of different colors. Spend this mana only to cast planeswalker spells.',
    // Also a lifegain producer ("you gain 1 life"); payoff is casting planeswalkers.
    expect: { producers: ['lifegain'], payoffs: ['superfriends'] },
  },
  {
    name: "Hero's Downfall",
    type_line: 'Instant',
    keywords: [],
    // Trap: "planeswalker" in removal text, but not "you control" — not a payoff.
    oracle_text: 'Destroy target creature or planeswalker.',
    expect: { producers: [], payoffs: [] },
  },
];
