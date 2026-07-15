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
    expect: { producers: ['artifacts'], payoffs: ['grouphug'] },
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
    expect: { producers: ['counters'], payoffs: ['tokens', 'blink'] },
  },
  {
    name: 'Impact Tremors',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'Whenever a creature you control enters, this enchantment deals 1 damage to each opponent.',
    expect: { producers: [], payoffs: ['tokens', 'blink'] },
  },
  {
    name: 'Purphoros, God of the Forge',
    type_line: 'Legendary Enchantment Creature — God',
    keywords: ['Indestructible'],
    oracle_text:
      "Indestructible\nAs long as your devotion to red is less than five, Purphoros isn't a creature.\nWhenever another creature you control enters, Purphoros deals 2 damage to each opponent.\n{2}{R}: Creatures you control get +1/+0 until end of turn.",
    expect: { producers: [], payoffs: ['tokens', 'blink'] },
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
    expect: { producers: ['counters'], payoffs: ['tokens', 'blink'] },
  },
  {
    name: 'Mirror Entity',
    type_line: 'Creature — Shapeshifter',
    keywords: ['Changeling'],
    oracle_text:
      'Changeling (This card is every creature type.)\n{X}: Until end of turn, creatures you control have base power and toughness X/X and gain all creature types.',
    // Changeling makes it a tribal enabler; the {X} pump is a creature anthem.
    expect: { producers: ['tribal'], payoffs: ['tokens'] },
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
    expect: { producers: ['lifegain'], payoffs: ['tokens', 'blink'] },
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
    expect: { producers: ['tokens', 'sacrifice', 'lifegain', 'discard'], payoffs: ['graveyard'] },
  },
  {
    name: 'Pawn of Ulamog',
    type_line: 'Creature — Vampire Shaman',
    keywords: [],
    oracle_text:
      'Whenever this creature or another nontoken creature you control dies, you may create a 0/1 colorless Eldrazi Spawn creature token. It has "Sacrifice this token: Add {C}."',
    expect: { producers: ['tokens', 'sacrifice'], payoffs: ['sacrifice'] },
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
    expect: { producers: ['landfall', 'sacrifice'], payoffs: [] },
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
    expect: { producers: ['sacrifice', 'mill'], payoffs: [] },
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
    expect: { producers: [], payoffs: ['auras', 'equipment', 'vehicles'] },
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
    expect: { producers: ['enchantress', 'sacrifice'], payoffs: [] },
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
    expect: { producers: ['blink'], payoffs: ['superfriends'] },
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

  // ── Tribal / typal ────────────────────────────────────────────────────────
  {
    name: 'Metallic Mimic',
    type_line: 'Artifact Creature — Shapeshifter',
    keywords: [],
    oracle_text:
      'As this creature enters, choose a creature type.\nThis creature is the chosen type in addition to its other types.\nEach other creature you control of the chosen type enters with an additional +1/+1 counter on it.',
    // Also a counters producer ("enters with an additional +1/+1 counter").
    expect: { producers: ['counters', 'tribal'], payoffs: ['tribal'] },
  },
  {
    name: 'Adaptive Automaton',
    type_line: 'Artifact Creature — Construct',
    keywords: [],
    oracle_text:
      'As this creature enters, choose a creature type.\nThis creature is the chosen type in addition to its other types.\nOther creatures you control of the chosen type get +1/+1.',
    expect: { producers: ['tribal'], payoffs: ['tribal'] },
  },
  {
    name: 'Door of Destinies',
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      'As this artifact enters, choose a creature type.\nWhenever you cast a spell of the chosen type, put a charge counter on this artifact.\nCreatures you control of the chosen type get +1/+1 for each charge counter on this artifact.',
    expect: { producers: ['tribal'], payoffs: ['tribal'] },
  },
  {
    name: "Vanquisher's Banner",
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      'As this artifact enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.\nWhenever you cast a creature spell of the chosen type, draw a card.',
    expect: { producers: ['tribal'], payoffs: ['tribal'] },
  },
  {
    name: 'Kindred Discovery',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'As this enchantment enters, choose a creature type.\nWhenever a creature you control of the chosen type enters or attacks, draw a card.',
    expect: { producers: ['tribal'], payoffs: ['tribal'] },
  },
  {
    name: 'Cavern of Souls',
    type_line: 'Land',
    keywords: [],
    oracle_text:
      "As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered.",
    expect: { producers: ['tribal'], payoffs: ['tribal'] },
  },
  {
    name: 'Coat of Arms',
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      'Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it.',
    expect: { producers: [], payoffs: ['tribal'] },
  },
  {
    name: 'Shared Animosity',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'Whenever a creature you control attacks, it gets +1/+0 until end of turn for each other attacking creature that shares a creature type with it.',
    expect: { producers: [], payoffs: ['tribal'] },
  },
  {
    name: 'Maskwood Nexus',
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      "Creatures you control are every creature type. The same is true for creature spells you control and creature cards you own that aren't on the battlefield.\n{3}, {T}: Create a 2/2 blue Shapeshifter creature token with changeling.",
    // Tribal enabler (every creature type / changeling) that also makes tokens.
    expect: { producers: ['tokens', 'tribal'], payoffs: [] },
  },
  {
    name: 'Goblin King',
    type_line: 'Creature — Goblin',
    keywords: [],
    // Trap: a specific-type lord ("Other Goblins") — deliberately NOT generalized
    // without a creature-type list, so it classifies as nothing.
    oracle_text: 'Other Goblins get +1/+1 and have mountainwalk.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Soulherder',
    type_line: 'Creature \u2014 Spirit',
    keywords: [],
    oracle_text:
      "Whenever a creature is exiled from the battlefield, put a +1/+1 counter on this creature.\nAt the beginning of your end step, you may exile another target creature you control, then return that card to the battlefield under its owner's control.",
    expect: { producers: ['blink', 'counters'], payoffs: [] },
  },
  {
    name: "Conjurer's Closet",
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      'At the beginning of your end step, you may exile target creature you control, then return that card to the battlefield under your control.',
    expect: { producers: ['blink'], payoffs: [] },
  },
  {
    name: 'Ghostly Flicker',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      'Exile two target artifacts, creatures, and/or lands you control, then return those cards to the battlefield under your control.',
    expect: { producers: ['blink'], payoffs: [] },
  },
  {
    name: 'Eerie Interlude',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      "Exile any number of target creatures you control. Return those cards to the battlefield under their owner's control at the beginning of the next end step.",
    expect: { producers: ['blink'], payoffs: [] },
  },
  {
    name: 'Restoration Angel',
    type_line: 'Creature \u2014 Angel',
    keywords: ['Flying', 'Flash'],
    oracle_text:
      'Flash\nFlying\nWhen this creature enters, you may exile target non-Angel creature you control, then return that card to the battlefield under your control.',
    expect: { producers: ['blink'], payoffs: [] },
  },
  {
    name: 'Flickerwisp',
    type_line: 'Creature \u2014 Elemental',
    keywords: ['Flying'],
    oracle_text:
      "Flying\nWhen this creature enters, exile another target permanent. Return that card to the battlefield under its owner's control at the beginning of the next end step.",
    expect: { producers: ['blink'], payoffs: [] },
  },
  {
    name: 'Cloudshift',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      'Exile target creature you control, then return that card to the battlefield under your control.',
    expect: { producers: ['blink'], payoffs: [] },
  },
  {
    name: 'Ephemerate',
    type_line: 'Instant',
    keywords: ['Rebound'],
    oracle_text:
      "Exile target creature you control, then return it to the battlefield under its owner's control.\nRebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)",
    expect: { producers: ['blink'], payoffs: [] },
  },
  {
    name: 'Brago, King Eternal',
    type_line: 'Legendary Creature \u2014 Spirit Noble',
    keywords: ['Flying'],
    oracle_text:
      "Flying\nWhenever Brago deals combat damage to a player, exile any number of target nonland permanents you control, then return those cards to the battlefield under their owner's control.",
    expect: { producers: ['blink'], payoffs: [] },
  },
  {
    name: 'Felidar Guardian',
    type_line: 'Creature \u2014 Cat Beast',
    keywords: [],
    oracle_text:
      "When this creature enters, you may exile another target permanent you control, then return that card to the battlefield under its owner's control.",
    expect: { producers: ['blink'], payoffs: [] },
  },
  {
    name: 'Thassa, Deep-Dwelling',
    type_line: 'Legendary Enchantment Creature \u2014 God',
    keywords: ['Indestructible'],
    oracle_text:
      "Indestructible\nAs long as your devotion to blue is less than five, Thassa isn't a creature.\nAt the beginning of your end step, exile up to one other target creature you control, then return that card to the battlefield under your control.\n{3}{U}: Tap another target creature.",
    expect: { producers: ['blink'], payoffs: [] },
  },
  {
    name: 'Deadeye Navigator',
    type_line: 'Creature \u2014 Spirit',
    keywords: ['Soulbond'],
    oracle_text:
      'Soulbond (You may pair this creature with another unpaired creature when either enters. They remain paired for as long as you control both of them.)\nAs long as Deadeye Navigator is paired with another creature, each of those creatures has "{1}{U}: Exile this creature, then return it to the battlefield under your control."',
    expect: { producers: ['blink'], payoffs: [] },
  },
  {
    name: 'Eldrazi Displacer',
    type_line: 'Creature \u2014 Eldrazi',
    keywords: ['Devoid'],
    oracle_text:
      "Devoid (This card has no color.)\n{2}{C}: Exile another target creature, then return it to the battlefield tapped under its owner's control. ({C} represents colorless mana.)",
    expect: { producers: ['blink'], payoffs: [] },
  },
  {
    name: 'Teleportation Circle',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      "At the beginning of your end step, exile up to one target artifact or creature you control, then return that card to the battlefield under its owner's control.",
    expect: { producers: ['blink'], payoffs: [] },
  },
  {
    name: 'Charming Prince',
    type_line: 'Creature \u2014 Human Noble',
    keywords: ['Scry'],
    oracle_text:
      'When this creature enters, choose one \u2014\n\u2022 Scry 2.\n\u2022 You gain 3 life.\n\u2022 Exile another target creature you own. Return it to the battlefield under your control at the beginning of the next end step.',
    expect: { producers: ['blink', 'lifegain'], payoffs: [] },
  },
  {
    name: 'Yorion, Sky Nomad',
    type_line: 'Legendary Creature \u2014 Bird Serpent',
    keywords: ['Flying', 'Companion'],
    oracle_text:
      'Companion \u2014 Your starting deck contains at least twenty cards more than the minimum deck size. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} as a sorcery.)\nFlying\nWhen Yorion enters, exile any number of other nonland permanents you own and control. Return those cards to the battlefield at the beginning of the next end step.',
    expect: { producers: ['blink'], payoffs: [] },
  },
  {
    name: 'Panharmonicon',
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      'If an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.',
    expect: { producers: [], payoffs: ['blink'] },
  },
  {
    name: 'Yarok, the Desecrated',
    type_line: 'Legendary Creature \u2014 Elemental Horror',
    keywords: ['Lifelink', 'Deathtouch'],
    oracle_text:
      'Deathtouch, lifelink\nIf a permanent entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.',
    expect: { producers: ['lifegain'], payoffs: ['blink'] },
  },
  {
    name: 'Elesh Norn, Mother of Machines',
    type_line: 'Legendary Creature \u2014 Phyrexian Praetor',
    keywords: ['Vigilance'],
    oracle_text:
      "Vigilance\nIf a permanent entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.\nPermanents entering don't cause abilities of permanents your opponents control to trigger.",
    expect: { producers: [], payoffs: ['blink'] },
  },
  {
    name: 'Mulldrifter',
    type_line: 'Creature \u2014 Elemental',
    keywords: ['Flying', 'Evoke'],
    oracle_text:
      "Flying\nWhen this creature enters, draw two cards.\nEvoke {2}{U} (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Banishing Light',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: "Smuggler's Copter",
    type_line: 'Artifact \u2014 Vehicle',
    keywords: ['Flying', 'Crew'],
    oracle_text:
      'Flying\nWhenever this Vehicle attacks or blocks, you may draw a card. If you do, discard a card.\nCrew 1 (Tap any number of creatures you control with total power 1 or more: This Vehicle becomes an artifact creature until end of turn.)',
    expect: { producers: ['vehicles', 'discard'], payoffs: [] },
  },
  {
    name: 'Heart of Kiran',
    type_line: 'Legendary Artifact \u2014 Vehicle',
    keywords: ['Flying', 'Vigilance', 'Crew'],
    oracle_text:
      "Flying, vigilance\nCrew 3 (Tap any number of creatures you control with total power 3 or more: This Vehicle becomes an artifact creature until end of turn.)\nYou may remove a loyalty counter from a planeswalker you control rather than pay Heart of Kiran's crew cost.",
    expect: { producers: ['vehicles'], payoffs: ['superfriends'] },
  },
  {
    name: 'Skysovereign, Consul Flagship',
    type_line: 'Legendary Artifact \u2014 Vehicle',
    keywords: ['Flying', 'Crew'],
    oracle_text:
      'Flying\nWhenever Skysovereign enters or attacks, it deals 3 damage to target creature or planeswalker an opponent controls.\nCrew 3 (Tap any number of creatures you control with total power 3 or more: This Vehicle becomes an artifact creature until end of turn.)',
    expect: { producers: ['vehicles'], payoffs: [] },
  },
  {
    name: 'Parhelion II',
    type_line: 'Legendary Artifact \u2014 Vehicle',
    keywords: ['Flying', 'Vigilance', 'First strike', 'Crew'],
    oracle_text:
      'Flying, first strike, vigilance\nWhenever Parhelion II attacks, create two 4/4 white Angel creature tokens with flying and vigilance that are attacking.\nCrew 4 (Tap any number of creatures you control with total power 4 or more: This Vehicle becomes an artifact creature until end of turn.)',
    expect: { producers: ['tokens', 'vehicles'], payoffs: [] },
  },
  {
    name: "Cultivator's Caravan",
    type_line: 'Artifact \u2014 Vehicle',
    keywords: ['Crew'],
    oracle_text:
      '{T}: Add one mana of any color.\nCrew 3 (Tap any number of creatures you control with total power 3 or more: This Vehicle becomes an artifact creature until end of turn.)',
    expect: { producers: ['vehicles'], payoffs: [] },
  },
  {
    name: 'Consulate Dreadnought',
    type_line: 'Artifact \u2014 Vehicle',
    keywords: ['Crew'],
    oracle_text:
      'Crew 6 (Tap any number of creatures you control with total power 6 or more: This Vehicle becomes an artifact creature until end of turn.)',
    expect: { producers: ['vehicles'], payoffs: [] },
  },
  {
    name: 'Shorikai, Genesis Engine',
    type_line: 'Legendary Artifact \u2014 Vehicle',
    keywords: ['Crew'],
    oracle_text:
      '{1}, {T}: Draw two cards, then discard a card. Create a 1/1 colorless Pilot creature token with "This token crews Vehicles as though its power were 2 greater."\nCrew 8 (Tap any number of creatures you control with total power 8 or more: This Vehicle becomes an artifact creature until end of turn.)',
    expect: { producers: ['tokens', 'vehicles', 'discard'], payoffs: [] },
  },
  {
    name: 'Depala, Pilot Exemplar',
    type_line: 'Legendary Creature \u2014 Dwarf Pilot',
    keywords: [],
    oracle_text:
      "Other Dwarves you control get +1/+1.\nEach Vehicle you control gets +1/+1 as long as it's a creature.\nWhenever Depala becomes tapped, you may pay {X}. If you do, reveal the top X cards of your library, put all Dwarf and Vehicle cards from among them into your hand, then put the rest on the bottom of your library in a random order.",
    expect: { producers: [], payoffs: ['vehicles'] },
  },
  {
    name: 'Kotori, Pilot Prodigy',
    type_line: 'Legendary Creature \u2014 Moonfolk Pilot',
    keywords: [],
    oracle_text:
      'Vehicles you control have crew 2.\nAt the beginning of combat on your turn, target artifact creature you control gains lifelink and vigilance until end of turn.',
    expect: { producers: [], payoffs: ['vehicles'] },
  },
  {
    name: 'Greasefang, Okiba Boss',
    type_line: 'Legendary Creature \u2014 Rat Pilot',
    keywords: [],
    oracle_text:
      "At the beginning of combat on your turn, return target Vehicle card from your graveyard to the battlefield. It gains haste. Return it to its owner's hand at the beginning of your next end step.",
    expect: { producers: [], payoffs: ['graveyard', 'vehicles'] },
  },
  {
    name: 'Howling Mine',
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      "At the beginning of each player's draw step, if this artifact is untapped, that player draws an additional card.",
    expect: { producers: ['grouphug'], payoffs: [] },
  },
  {
    name: 'Temple Bell',
    type_line: 'Artifact',
    keywords: [],
    oracle_text: '{T}: Each player draws a card.',
    expect: { producers: ['grouphug'], payoffs: [] },
  },
  {
    name: 'Dictate of Kruphix',
    type_line: 'Enchantment',
    keywords: ['Flash'],
    oracle_text:
      "Flash (You may cast this spell any time you could cast an instant.)\nAt the beginning of each player's draw step, that player draws an additional card.",
    expect: { producers: ['grouphug'], payoffs: [] },
  },
  {
    name: 'Kami of the Crescent Moon',
    type_line: 'Legendary Creature \u2014 Spirit',
    keywords: [],
    oracle_text:
      "At the beginning of each player's draw step, that player draws an additional card.",
    expect: { producers: ['grouphug'], payoffs: [] },
  },
  {
    name: 'Rites of Flourishing',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      "At the beginning of each player's draw step, that player draws an additional card.\nEach player may play an additional land on each of their turns.",
    expect: { producers: ['grouphug', 'landfall'], payoffs: [] },
  },
  {
    name: 'Heartbeat of Spring',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'Whenever a player taps a land for mana, that player adds one mana of any type that land produced.',
    expect: { producers: ['grouphug'], payoffs: [] },
  },
  {
    name: 'Font of Mythos',
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      "At the beginning of each player's draw step, that player draws two additional cards.",
    expect: { producers: ['grouphug'], payoffs: [] },
  },
  {
    name: 'Kynaios and Tiro of Meletis',
    type_line: 'Legendary Creature \u2014 Human Soldier',
    keywords: [],
    oracle_text:
      "At the beginning of your end step, draw a card. Each player may put a land card from their hand onto the battlefield, then each opponent who didn't draws a card.",
    expect: { producers: ['grouphug', 'landfall'], payoffs: [] },
  },
  {
    name: 'Nekusar, the Mindrazer',
    type_line: 'Legendary Creature \u2014 Zombie Wizard',
    keywords: [],
    oracle_text:
      "At the beginning of each player's draw step, that player draws an additional card.\nWhenever an opponent draws a card, Nekusar deals 1 damage to that player.",
    expect: { producers: ['grouphug'], payoffs: ['grouphug'] },
  },
  {
    name: 'Notion Thief',
    type_line: 'Creature \u2014 Human Rogue',
    keywords: ['Flash'],
    oracle_text:
      'Flash\nIf an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card.',
    expect: { producers: [], payoffs: ['grouphug'] },
  },
  {
    name: 'Consecrated Sphinx',
    type_line: 'Creature \u2014 Sphinx',
    keywords: ['Flying'],
    oracle_text: 'Flying\nWhenever an opponent draws a card, you may draw two cards.',
    expect: { producers: [], payoffs: ['grouphug'] },
  },
  {
    name: 'Underworld Dreams',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'Whenever an opponent draws a card, this enchantment deals 1 damage to that player.',
    expect: { producers: [], payoffs: ['grouphug'] },
  },
  {
    name: 'Fevered Visions',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      "At the beginning of each player's end step, that player draws a card. If the player is your opponent and has four or more cards in hand, this enchantment deals 2 damage to that player.",
    expect: { producers: ['grouphug'], payoffs: [] },
  },
  {
    name: 'Divination',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text: 'Draw two cards.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Attune with Aether',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      'Search your library for a basic land card, reveal it, put it into your hand, then shuffle. You get {E}{E} (two energy counters).',
    expect: { producers: ['energy'], payoffs: [] },
  },
  {
    name: 'Aetherworks Marvel',
    type_line: 'Legendary Artifact',
    keywords: [],
    oracle_text:
      'Whenever a permanent you control is put into a graveyard, you get {E} (an energy counter).\n{T}, Pay six {E}: Look at the top six cards of your library. You may cast a spell from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.',
    expect: { producers: ['energy'], payoffs: ['energy'] },
  },
  {
    name: 'Longtusk Cub',
    type_line: 'Creature \u2014 Cat',
    keywords: [],
    oracle_text:
      'Whenever this creature deals combat damage to a player, you get {E}{E} (two energy counters).\nPay {E}{E}: Put a +1/+1 counter on this creature.',
    expect: { producers: ['counters', 'energy'], payoffs: ['energy'] },
  },
  {
    name: 'Bristling Hydra',
    type_line: 'Creature \u2014 Hydra',
    keywords: [],
    oracle_text:
      'When this creature enters, you get {E}{E}{E} (three energy counters).\nPay {E}{E}{E}: Put a +1/+1 counter on this creature. It gains hexproof until end of turn.',
    expect: { producers: ['counters', 'energy'], payoffs: ['energy'] },
  },
  {
    name: 'Electrostatic Pummeler',
    type_line: 'Artifact Creature \u2014 Construct',
    keywords: [],
    oracle_text:
      'When this creature enters, you get {E}{E}{E} (three energy counters).\nPay {E}{E}{E}: This creature gets +X/+X until end of turn, where X is its power.',
    expect: { producers: ['energy'], payoffs: ['energy'] },
  },
  {
    name: 'Whirler Virtuoso',
    type_line: 'Creature \u2014 Vedalken Artificer',
    keywords: [],
    oracle_text:
      'When this creature enters, you get {E}{E}{E} (three energy counters).\nPay {E}{E}{E}: Create a 1/1 colorless Thopter artifact creature token with flying.',
    expect: { producers: ['artifacts', 'energy', 'tokens'], payoffs: ['energy'] },
  },
  {
    name: 'Harnessed Lightning',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      'Choose target creature. You get {E}{E}{E} (three energy counters), then you may pay any amount of {E}. Harnessed Lightning deals that much damage to that creature.',
    expect: { producers: ['energy'], payoffs: ['energy'] },
  },
  {
    name: 'Aether Hub',
    type_line: 'Land',
    keywords: [],
    oracle_text:
      'When this land enters, you get {E} (an energy counter).\n{T}: Add {C}.\n{T}, Pay {E}: Add one mana of any color.',
    expect: { producers: ['energy'], payoffs: ['energy'] },
  },
  {
    name: 'Ethereal Armor',
    type_line: 'Enchantment \u2014 Aura',
    keywords: ['Enchant'],
    oracle_text:
      'Enchant creature\nEnchanted creature gets +1/+1 for each enchantment you control and has first strike.',
    expect: { producers: ['auras'], payoffs: [] },
  },
  {
    name: 'Daybreak Coronet',
    type_line: 'Enchantment \u2014 Aura',
    keywords: ['Enchant'],
    oracle_text:
      'Enchant creature with another Aura attached to it\nEnchanted creature gets +3/+3 and has first strike, vigilance, and lifelink. (Damage dealt by the creature also causes its controller to gain that much life.)',
    expect: { producers: ['auras'], payoffs: [] },
  },
  {
    name: "Light-Paws, Emperor's Voice",
    type_line: 'Legendary Creature \u2014 Fox Advisor',
    keywords: [],
    oracle_text:
      'Whenever an Aura you control enters, if you cast it, you may search your library for an Aura card with mana value less than or equal to that Aura and with a different name than each Aura you control, put that card onto the battlefield attached to Light-Paws, then shuffle.',
    expect: { producers: ['auras'], payoffs: ['auras'] },
  },
  {
    name: 'Bruna, Light of Alabaster',
    type_line: 'Legendary Creature \u2014 Angel',
    keywords: ['Flying', 'Vigilance'],
    oracle_text:
      'Flying, vigilance\nWhenever Bruna attacks or blocks, you may attach to it any number of Auras on the battlefield and you may put onto the battlefield attached to it any number of Aura cards that could enchant it from your graveyard and/or hand.',
    expect: { producers: [], payoffs: ['auras'] },
  },
  {
    name: 'Hateful Eidolon',
    type_line: 'Enchantment Creature \u2014 Spirit',
    keywords: ['Lifelink'],
    oracle_text:
      'Lifelink\nWhenever an enchanted creature dies, draw a card for each Aura you controlled that was attached to it.',
    expect: { producers: ['lifegain'], payoffs: ['auras', 'sacrifice'] },
  },
  {
    name: 'Pacifism',
    type_line: 'Enchantment \u2014 Aura',
    keywords: ['Enchant'],
    oracle_text: "Enchant creature\nEnchanted creature can't attack or block.",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Faithless Looting',
    type_line: 'Sorcery',
    keywords: ['Flashback'],
    oracle_text:
      'Draw two cards, then discard two cards.\nFlashback {2}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
    expect: { producers: ['discard'], payoffs: ['graveyard'] },
  },
  {
    name: 'Faith of the Devoted',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'Whenever you cycle or discard a card, you may pay {1}. If you do, each opponent loses 2 life and you gain 2 life.',
    expect: { producers: ['lifegain'], payoffs: ['cycling', 'discard'] },
  },
  {
    name: 'Waste Not',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'Whenever an opponent discards a creature card, create a 2/2 black Zombie creature token.\nWhenever an opponent discards a land card, add {B}{B}.\nWhenever an opponent discards a noncreature, nonland card, draw a card.',
    expect: { producers: ['tokens'], payoffs: ['discard'] },
  },
  {
    name: 'Tergrid, God of Fright',
    type_line: 'Legendary Creature \u2014 God',
    keywords: ['Menace'],
    oracle_text:
      "Menace\nWhenever an opponent sacrifices a nontoken permanent or discards a permanent card, you may put that card from a graveyard onto the battlefield under your control.\n{T}: Target player loses 3 life unless they sacrifice a nonland permanent of their choice or discard a card.\n{3}{B}: Untap Tergrid's Lantern.",
    expect: { producers: ['discard'], payoffs: ['discard'] },
  },
  {
    name: 'Glint-Horn Buccaneer',
    type_line: 'Creature \u2014 Minotaur Pirate',
    keywords: ['Haste'],
    oracle_text:
      'Haste\nWhenever you discard a card, this creature deals 1 damage to each opponent.\n{1}{R}, Discard a card: Draw a card. Activate only if this creature is attacking.',
    expect: { producers: ['discard'], payoffs: ['discard'] },
  },
  {
    name: 'Bone Miser',
    type_line: 'Creature \u2014 Zombie Wizard',
    keywords: [],
    oracle_text:
      'Whenever you discard a creature card, create a 2/2 black Zombie creature token.\nWhenever you discard a land card, add {B}{B}.\nWhenever you discard a noncreature, nonland card, draw a card.',
    expect: { producers: ['tokens'], payoffs: ['discard'] },
  },
  {
    name: 'Anje Falkenrath',
    type_line: 'Legendary Creature \u2014 Vampire',
    keywords: ['Haste'],
    oracle_text:
      'Haste\n{T}, Discard a card: Draw a card.\nWhenever you discard a card, if it has madness, untap Anje Falkenrath.',
    expect: { producers: ['discard'], payoffs: ['discard'] },
  },
  {
    name: 'Megrim',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'Whenever an opponent discards a card, this enchantment deals 2 damage to that player.',
    expect: { producers: [], payoffs: ['discard'] },
  },
  {
    name: 'Mind Rot',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text: 'Target player discards two cards.',
    expect: { producers: ['discard'], payoffs: [] },
  },
  {
    name: 'Fiery Temper',
    type_line: 'Instant',
    keywords: ['Madness'],
    oracle_text:
      'Fiery Temper deals 3 damage to any target.\nMadness {R} (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard.)',
    expect: { producers: [], payoffs: ['discard'] },
  },
  {
    name: 'Acererak the Archlich',
    type_line: 'Legendary Creature \u2014 Zombie Wizard',
    keywords: ['Venture into the dungeon'],
    oracle_text:
      "When Acererak enters, if you haven't completed Tomb of Annihilation, return Acererak to its owner's hand and venture into the dungeon.\nWhenever Acererak attacks, for each opponent, you create a 2/2 black Zombie creature token unless that player sacrifices a creature of their choice.",
    expect: { producers: ['tokens', 'venture'], payoffs: [] },
  },
  {
    name: 'Astral Cornucopia',
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      'This artifact enters with X charge counters on it.\n{T}: Choose a color. Add one mana of that color for each charge counter on this artifact.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Astral Drift',
    type_line: 'Enchantment',
    keywords: ['Cycling'],
    oracle_text:
      "Whenever you cycle this card or cycle another card while this enchantment is on the battlefield, you may exile target creature. If you do, return that card to the battlefield under its owner's control at the beginning of the next end step.\nCycling {2}{W} ({2}{W}, Discard this card: Draw a card.)",
    expect: { producers: ['blink', 'cycling'], payoffs: ['cycling'] },
  },
  {
    name: 'Aurora Shifter',
    type_line: 'Creature \u2014 Shapeshifter',
    keywords: [],
    oracle_text:
      'Whenever this creature deals combat damage to a player, you get that many {E}.\nAt the beginning of combat on your turn, you may pay {E}{E}. When you do, this creature becomes a copy of another target creature you control, except it has this ability and "Whenever this creature deals combat damage to a player, you get that many {E}."',
    expect: { producers: ['energy'], payoffs: ['energy'] },
  },
  {
    name: "Black Sun's Zenith",
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      "Put X -1/-1 counters on each creature. Shuffle Black Sun's Zenith into its owner's library.",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Blightsteel Colossus',
    type_line: 'Artifact Creature \u2014 Phyrexian Golem',
    keywords: ['Indestructible', 'Trample', 'Infect'],
    oracle_text:
      "Trample, infect, indestructible\nIf Blightsteel Colossus would be put into a graveyard from anywhere, reveal Blightsteel Colossus and shuffle it into its owner's library instead.",
    expect: { producers: ['poison'], payoffs: [] },
  },
  {
    name: 'Bloated Contaminator',
    type_line: 'Creature \u2014 Phyrexian Beast',
    keywords: ['Toxic', 'Trample', 'Proliferate'],
    oracle_text:
      'Trample\nToxic 1 (Players dealt combat damage by this creature also get a poison counter.)\nWhenever this creature deals combat damage to a player, proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)',
    expect: { producers: ['poison', 'superfriends'], payoffs: [] },
  },
  {
    name: 'Bojuka Bog',
    type_line: 'Land',
    keywords: [],
    oracle_text:
      "This land enters tapped.\nWhen this land enters, exile target player's graveyard.\n{T}: Add {B}.",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Boon Reflection',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text: 'If you would gain life, you gain twice that much life instead.',
    expect: { producers: [], payoffs: ['lifegain'] },
  },
  {
    name: 'Boros Garrison',
    type_line: 'Land',
    keywords: [],
    oracle_text:
      "This land enters tapped.\nWhen this land enters, return a land you control to its owner's hand.\n{T}: Add {R}{W}.",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Bruvac the Grandiloquent',
    type_line: 'Legendary Creature \u2014 Human Advisor',
    keywords: ['Mill'],
    oracle_text:
      'If an opponent would mill one or more cards, they mill twice that many cards instead. (To mill a card, a player puts the top card of their library into their graveyard.)',
    expect: { producers: ['mill'], payoffs: ['mill'] },
  },
  {
    name: 'Bygone Bishop',
    type_line: 'Creature \u2014 Spirit Cleric',
    keywords: ['Flying', 'Investigate'],
    oracle_text:
      'Flying\nWhenever you cast a creature spell with mana value 3 or less, investigate. (Create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")',
    expect: { producers: ['artifacts'], payoffs: [] },
  },
  {
    name: 'Caves of Chaos Adventurer',
    type_line: 'Creature \u2014 Human Barbarian',
    keywords: ['Trample'],
    oracle_text:
      "Trample\nWhen this creature enters, you take the initiative.\nWhenever this creature attacks, exile the top card of your library. If you've completed a dungeon, you may play that card this turn without paying its mana cost. Otherwise, you may play that card this turn.",
    expect: { producers: ['venture'], payoffs: ['venture'] },
  },
  {
    name: 'Children of Korlis',
    type_line: 'Creature \u2014 Human Rebel Cleric',
    keywords: [],
    oracle_text:
      "Sacrifice this creature: You gain life equal to the life you've lost this turn. (Damage causes loss of life.)",
    expect: { producers: ['lifegain', 'sacrifice'], payoffs: [] },
  },
  {
    name: 'Chrome Host Seedshark',
    type_line: 'Creature \u2014 Phyrexian Shark',
    keywords: ['Flying', 'Incubate', 'Transform'],
    oracle_text:
      'Flying\nWhenever you cast a noncreature spell, incubate X, where X is that spell\'s mana value. (Create an Incubator token with X +1/+1 counters on it and "{2}: Transform this token." It transforms into a 0/0 Phyrexian artifact creature.)',
    expect: { producers: ['artifacts'], payoffs: [] },
  },
  {
    name: 'Citadel Siege',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      "As this enchantment enters, choose Khans or Dragons.\n\u2022 Khans \u2014 At the beginning of combat on your turn, put two +1/+1 counters on target creature you control.\n\u2022 Dragons \u2014 At the beginning of combat on each opponent's turn, tap target creature that player controls.",
    expect: { producers: ['counters'], payoffs: [] },
  },
  {
    name: 'Cloister Gargoyle',
    type_line: 'Artifact Creature \u2014 Gargoyle',
    keywords: ['Venture into the dungeon'],
    oracle_text:
      "When this creature enters, venture into the dungeon. (Enter the first room or advance to the next room.)\nAs long as you've completed a dungeon, this creature gets +3/+0 and has flying.",
    expect: { producers: ['venture'], payoffs: ['venture'] },
  },
  {
    name: 'Coretapper',
    type_line: 'Artifact Creature \u2014 Myr',
    keywords: [],
    oracle_text:
      '{T}: Put a charge counter on target artifact.\nSacrifice this creature: Put two charge counters on target artifact.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Crested Sunmare',
    type_line: 'Creature \u2014 Horse',
    keywords: [],
    oracle_text:
      'Other Horses you control have indestructible.\nAt the beginning of each end step, if you gained life this turn, create a 5/5 white Horse creature token.',
    expect: { producers: ['tokens'], payoffs: ['lifegain'] },
  },
  {
    name: 'Crucible of Worlds',
    type_line: 'Artifact',
    keywords: [],
    oracle_text: 'You may play lands from your graveyard.',
    expect: { producers: ['landfall'], payoffs: [] },
  },
  {
    name: 'Cruel Celebrant',
    type_line: 'Creature \u2014 Vampire',
    keywords: [],
    oracle_text:
      'Whenever this creature or another creature or planeswalker you control dies, each opponent loses 1 life and you gain 1 life.',
    expect: { producers: ['lifegain'], payoffs: ['sacrifice'] },
  },
  {
    name: 'Crypt Incursion',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      "Exile all creature cards from target player's graveyard. You gain 3 life for each card exiled this way.",
    expect: { producers: ['lifegain'], payoffs: [] },
  },
  {
    name: 'Curator of Mysteries',
    type_line: 'Creature \u2014 Sphinx',
    keywords: ['Scry', 'Flying', 'Cycling'],
    oracle_text:
      'Flying\nWhenever you cycle or discard another card, scry 1.\nCycling {U} ({U}, Discard this card: Draw a card.)',
    expect: { producers: ['cycling'], payoffs: ['cycling', 'discard'] },
  },
  {
    name: 'Curse of Disturbance',
    type_line: 'Enchantment \u2014 Aura Curse',
    keywords: ['Enchant'],
    oracle_text:
      'Enchant player\nWhenever enchanted player is attacked, create a 2/2 black Zombie creature token. Each opponent attacking that player does the same.',
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: 'Curse of Opulence',
    type_line: 'Enchantment \u2014 Aura Curse',
    keywords: ['Enchant'],
    oracle_text:
      'Enchant player\nWhenever enchanted player is attacked, create a Gold token. Each opponent attacking that player does the same. (A Gold token is an artifact with "Sacrifice this token: Add one mana of any color.")',
    expect: { producers: ['artifacts'], payoffs: [] },
  },
  {
    name: 'Custodi Lich',
    type_line: 'Creature \u2014 Zombie Cleric',
    keywords: [],
    oracle_text:
      'When this creature enters, you become the monarch.\nWhenever you become the monarch, target player sacrifices a creature of their choice.',
    expect: { producers: ['monarch'], payoffs: ['monarch', 'sacrifice'] },
  },
  {
    name: 'Dance of the Dead',
    type_line: 'Enchantment \u2014 Aura',
    keywords: ['Enchant'],
    oracle_text:
      "Enchant creature card in a graveyard\nWhen this Aura enters, if it's on the battlefield, it loses \"enchant creature card in a graveyard\" and gains \"enchant creature put onto the battlefield with this Aura.\" Put enchanted creature card onto the battlefield tapped under your control and attach this Aura to it. When this Aura leaves the battlefield, that creature's controller sacrifices it.\nEnchanted creature gets +1/+1 and doesn't untap during its controller's untap step.\nAt the beginning of the upkeep of enchanted creature's controller, that player may pay {1}{B}. If the player does, untap that creature.",
    expect: { producers: [], payoffs: ['graveyard'] },
  },
  {
    name: 'Death Tyrant',
    type_line: 'Creature \u2014 Beholder Skeleton',
    keywords: ['Menace'],
    oracle_text:
      'Menace\nNegative Energy Cone \u2014 Whenever an attacking creature you control or a blocking creature an opponent controls dies, create a 2/2 black Zombie creature token.\n{5}{B}: Return this card from your graveyard to the battlefield tapped.',
    expect: { producers: ['tokens'], payoffs: ['sacrifice'] },
  },
  {
    name: 'Death-Priest of Myrkul',
    type_line: 'Creature \u2014 Tiefling Cleric',
    keywords: [],
    oracle_text:
      'Skeletons, Vampires, and Zombies you control get +1/+1.\nAt the beginning of your end step, if a creature died this turn, you may pay {1}. If you do, create a 1/1 black Skeleton creature token.',
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: 'Decree of Justice',
    type_line: 'Sorcery',
    keywords: ['Cycling'],
    oracle_text:
      'Create X 4/4 white Angel creature tokens with flying.\nCycling {2}{W} ({2}{W}, Discard this card: Draw a card.)\nWhen you cycle this card, you may pay {X}. If you do, create X 1/1 white Soldier creature tokens.',
    expect: { producers: ['cycling', 'tokens'], payoffs: ['cycling'] },
  },
  {
    name: 'Deepglow Skate',
    type_line: 'Creature \u2014 Fish',
    keywords: ['Double'],
    oracle_text:
      'When this creature enters, double the number of each kind of counter on any number of target permanents.',
    expect: { producers: [], payoffs: ['counters'] },
  },
  {
    name: 'Denethor, Stone Seer',
    type_line: 'Legendary Creature \u2014 Human Noble',
    keywords: ['Scry'],
    oracle_text:
      'When Denethor enters, scry 2.\n{3}{R}, {T}, Sacrifice Denethor: Target player becomes the monarch. Denethor deals 3 damage to any target.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Diseased Vermin',
    type_line: 'Creature \u2014 Rat',
    keywords: [],
    oracle_text:
      'Whenever this creature deals combat damage to a player, put an infection counter on it.\nAt the beginning of your upkeep, this creature deals X damage to target opponent previously dealt damage by it, where X is the number of infection counters on it.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Distant Melody',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text: 'Choose a creature type. Draw a card for each permanent you control of that type.',
    expect: { producers: ['tribal'], payoffs: [] },
  },
  {
    name: 'Drannith Healer',
    type_line: 'Creature \u2014 Human Cleric',
    keywords: ['Cycling'],
    oracle_text:
      'Whenever you cycle another card, you gain 1 life.\nCycling {1} ({1}, Discard this card: Draw a card.)',
    expect: { producers: ['cycling', 'lifegain'], payoffs: ['cycling'] },
  },
  {
    name: 'Drannith Stinger',
    type_line: 'Creature \u2014 Human Wizard',
    keywords: ['Cycling'],
    oracle_text:
      'Whenever you cycle another card, this creature deals 1 damage to each opponent.\nCycling {1} ({1}, Discard this card: Draw a card.)',
    expect: { producers: ['cycling'], payoffs: ['cycling'] },
  },
  {
    name: 'Drown in the Loch',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      "Choose one \u2014\n\u2022 Counter target spell with mana value less than or equal to the number of cards in its controller's graveyard.\n\u2022 Destroy target creature with mana value less than or equal to the number of cards in its controller's graveyard.",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Ellywick Tumblestrum',
    type_line: 'Legendary Planeswalker \u2014 Ellywick',
    keywords: ['Venture into the dungeon'],
    oracle_text:
      '+1: Venture into the dungeon. (Enter the first room or advance to the next room.)\n\u22122: Look at the top six cards of your library. You may reveal a creature card from among them and put it into your hand. If it\'s legendary, you gain 3 life. Put the rest on the bottom of your library in a random order.\n\u22127: You get an emblem with "Creatures you control have trample and haste and get +2/+2 for each differently named dungeon you\'ve completed."',
    expect: { producers: ['lifegain', 'superfriends', 'venture'], payoffs: [] },
  },
  {
    name: 'Empyreal Voyager',
    type_line: 'Creature \u2014 Vedalken Scout',
    keywords: ['Flying', 'Trample'],
    oracle_text:
      'Flying, trample\nWhenever this creature deals combat damage to a player, you get that many {E} (energy counters).',
    expect: { producers: ['energy'], payoffs: [] },
  },
  {
    name: 'Energy Bolt',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      'Choose one \u2014\n\u2022 Energy Bolt deals X damage to target player or planeswalker.\n\u2022 Target player gains X life.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Energy Reserve',
    type_line: 'Card',
    keywords: [],
    oracle_text: '(Place your energy counters in this area.)',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Exquisite Blood',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text: 'Whenever an opponent loses life, you gain that much life.',
    expect: { producers: ['lifegain'], payoffs: [] },
  },
  {
    name: "Faith's Fetters",
    type_line: 'Enchantment \u2014 Aura',
    keywords: ['Enchant'],
    oracle_text:
      "Enchant permanent\nWhen this Aura enters, you gain 4 life.\nEnchanted permanent can't attack or block, and its activated abilities can't be activated unless they're mana abilities.",
    expect: { producers: ['lifegain'], payoffs: [] },
  },
  {
    name: 'Far Traveler',
    type_line: 'Legendary Enchantment \u2014 Background',
    keywords: [],
    oracle_text:
      'Commander creatures you own have "At the beginning of your end step, exile up to one target tapped creature you control, then return it to the battlefield under its owner\'s control."',
    expect: { producers: ['blink'], payoffs: [] },
  },
  {
    name: 'Felidar Sovereign',
    type_line: 'Creature \u2014 Cat Beast',
    keywords: ['Lifelink', 'Vigilance'],
    oracle_text:
      "Vigilance (Attacking doesn't cause this creature to tap.)\nLifelink (Damage dealt by this creature also causes you to gain that much life.)\nAt the beginning of your upkeep, if you have 40 or more life, you win the game.",
    expect: { producers: ['lifegain'], payoffs: [] },
  },
  {
    name: 'Fleet Swallower',
    type_line: 'Creature \u2014 Fish',
    keywords: ['Mill'],
    oracle_text:
      'Whenever this creature attacks, target player mills half their library, rounded up.',
    expect: { producers: ['mill'], payoffs: [] },
  },
  {
    name: 'Fluctuator',
    type_line: 'Artifact',
    keywords: [],
    oracle_text: 'Cycling abilities you activate cost {2} less to activate.',
    expect: { producers: ['cycling'], payoffs: [] },
  },
  {
    name: 'Followed Footsteps',
    type_line: 'Enchantment \u2014 Aura',
    keywords: ['Enchant'],
    oracle_text:
      "Enchant creature\nAt the beginning of your upkeep, create a token that's a copy of enchanted creature.",
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: 'Fractured Identity',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      "Exile target nonland permanent. Each player other than its controller creates a token that's a copy of it.",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Fraying Sanity',
    type_line: 'Enchantment \u2014 Aura Curse',
    keywords: ['Enchant', 'Mill'],
    oracle_text:
      'Enchant player\nAt the beginning of each end step, enchanted player mills X cards, where X is the number of cards put into their graveyard from anywhere this turn.',
    expect: { producers: ['mill'], payoffs: [] },
  },
  {
    name: 'Geier Reach Sanitarium',
    type_line: 'Legendary Land',
    keywords: [],
    oracle_text: '{T}: Add {C}.\n{2}, {T}: Each player draws a card, then discards a card.',
    expect: { producers: ['grouphug'], payoffs: [] },
  },
  {
    name: 'Glimpse the Unthinkable',
    type_line: 'Sorcery',
    keywords: ['Mill'],
    oracle_text: 'Target player mills ten cards.',
    expect: { producers: ['mill'], payoffs: [] },
  },
  {
    name: 'Glistener Elf',
    type_line: 'Creature \u2014 Phyrexian Elf Warrior',
    keywords: ['Infect'],
    oracle_text:
      'Infect (This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)',
    expect: { producers: ['poison'], payoffs: [] },
  },
  {
    name: 'Gl\u00f3in, Dwarf Emissary',
    type_line: 'Legendary Creature \u2014 Dwarf Advisor',
    keywords: ['Goad', 'Treasure'],
    oracle_text:
      'Whenever you cast a historic spell, create a Treasure token. This ability triggers only once each turn. (Artifacts, legendaries, and Sagas are historic.)\n{T}, Sacrifice a Treasure: Goad target creature. (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)',
    expect: { producers: ['artifacts', 'sacrifice'], payoffs: [] },
  },
  {
    name: 'Grafted Exoskeleton',
    type_line: 'Artifact \u2014 Equipment',
    keywords: ['Equip'],
    oracle_text:
      'Equipped creature gets +2/+2 and has infect. (It deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)\nWhenever this Equipment becomes unattached from a permanent, sacrifice that permanent.\nEquip {2}',
    expect: { producers: ['equipment', 'poison'], payoffs: [] },
  },
  {
    name: "Gryff's Boon",
    type_line: 'Enchantment \u2014 Aura',
    keywords: ['Enchant'],
    oracle_text:
      'Enchant creature\nEnchanted creature gets +1/+0 and has flying.\n{3}{W}: Return this card from your graveyard to the battlefield attached to target creature. Activate only as a sorcery.',
    expect: { producers: ['auras'], payoffs: [] },
  },
  {
    name: 'Hand of the Praetors',
    type_line: 'Creature \u2014 Phyrexian Zombie',
    keywords: ['Infect'],
    oracle_text:
      'Infect (This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)\nOther creatures you control with infect get +1/+1.\nWhenever you cast a creature spell with infect, target player gets a poison counter.',
    expect: { producers: ['poison'], payoffs: ['poison'] },
  },
  {
    name: 'Hedron Crab',
    type_line: 'Creature \u2014 Crab',
    keywords: ['Mill', 'Landfall'],
    oracle_text:
      'Landfall \u2014 Whenever a land you control enters, target player mills three cards. (They put the top three cards of their library into their graveyard.)',
    expect: { producers: ['mill'], payoffs: ['landfall'] },
  },
  {
    name: 'Helm of the Host',
    type_line: 'Legendary Artifact \u2014 Equipment',
    keywords: ['Equip'],
    oracle_text:
      "At the beginning of combat on your turn, create a token that's a copy of equipped creature, except the token isn't legendary. That token gains haste.\nEquip {5}",
    expect: { producers: ['equipment', 'tokens'], payoffs: [] },
  },
  {
    name: 'Hollow One',
    type_line: 'Artifact Creature \u2014 Golem',
    keywords: ['Cycling'],
    oracle_text:
      "This spell costs {2} less to cast for each card you've cycled or discarded this turn.\nCycling {2} ({2}, Discard this card: Draw a card.)",
    expect: { producers: ['cycling'], payoffs: [] },
  },
  {
    name: 'Ichorclaw Myr',
    type_line: 'Artifact Creature \u2014 Phyrexian Myr',
    keywords: ['Infect'],
    oracle_text:
      'Infect (This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)\nWhenever this creature becomes blocked, it gets +2/+2 until end of turn.',
    expect: { producers: ['poison'], payoffs: [] },
  },
  {
    name: 'Increasing Confusion',
    type_line: 'Sorcery',
    keywords: ['Flashback', 'Mill'],
    oracle_text:
      'Target player mills X cards. If this spell was cast from a graveyard, that player mills twice that many cards instead.\nFlashback {X}{U} (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
    expect: { producers: ['mill'], payoffs: ['graveyard'] },
  },
  {
    name: 'Kiki-Jiki, Mirror Breaker',
    type_line: 'Legendary Creature \u2014 Goblin Shaman',
    keywords: ['Haste'],
    oracle_text:
      "Haste\n{T}: Create a token that's a copy of target nonlegendary creature you control, except it has haste. Sacrifice it at the beginning of the next end step.",
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: 'Kindred Dominance',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text: "Choose a creature type. Destroy all creatures that aren't of the chosen type.",
    expect: { producers: ['tribal'], payoffs: ['tribal'] },
  },
  {
    name: 'Knights of the Black Rose',
    type_line: 'Creature \u2014 Human Knight',
    keywords: [],
    oracle_text:
      'When this creature enters, you become the monarch.\nWhenever an opponent becomes the monarch, if you were the monarch as the turn began, that player loses 2 life and you gain 2 life.',
    expect: { producers: ['lifegain', 'monarch'], payoffs: ['monarch'] },
  },
  {
    name: 'Land Tax',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'At the beginning of your upkeep, if an opponent controls more lands than you, you may search your library for up to three basic land cards, reveal them, put them into your hand, then shuffle.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Live Fast',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text: 'You draw two cards, lose 2 life, and get {E}{E} (two energy counters).',
    expect: { producers: ['energy'], payoffs: [] },
  },
  {
    name: 'Lost Monarch of Ifnir',
    type_line: 'Creature \u2014 Zombie Noble',
    keywords: ['Afflict', 'Mill'],
    oracle_text:
      'Afflict 3 (Whenever this creature becomes blocked, defending player loses 3 life.)\nOther Zombies you control have afflict 3.\nAt the beginning of your second main phase, if a player was dealt combat damage by a Zombie this turn, mill three cards, then you may return a creature card from your graveyard to your hand.',
    expect: { producers: ['graveyard'], payoffs: ['graveyard'] },
  },
  {
    name: 'Maddening Cacophony',
    type_line: 'Sorcery',
    keywords: ['Mill', 'Kicker'],
    oracle_text:
      'Kicker {3}{U}\nEach opponent mills eight cards. If this spell was kicked, instead each opponent mills half their library, rounded up.',
    expect: { producers: ['mill'], payoffs: [] },
  },
  {
    name: "Magistrate's Scepter",
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      '{4}, {T}: Put a charge counter on this artifact.\n{T}, Remove three charge counters from this artifact: Take an extra turn after this one.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Marchesa, the Black Rose',
    type_line: 'Legendary Creature \u2014 Human Wizard',
    keywords: ['Dethrone'],
    oracle_text:
      'Dethrone (Whenever this creature attacks the player with the most life or tied for most life, put a +1/+1 counter on it.)\nOther creatures you control have dethrone.\nWhenever a creature you control with a +1/+1 counter on it dies, return that card to the battlefield under your control at the beginning of the next end step.',
    expect: { producers: [], payoffs: ['sacrifice'] },
  },
  {
    name: 'Massacre Wurm',
    type_line: 'Creature \u2014 Phyrexian Wurm',
    keywords: [],
    oracle_text:
      'When this creature enters, creatures your opponents control get -2/-2 until end of turn.\nWhenever a creature an opponent controls dies, that player loses 2 life.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Memory Erosion',
    type_line: 'Enchantment',
    keywords: ['Mill'],
    oracle_text: 'Whenever an opponent casts a spell, that player mills two cards.',
    expect: { producers: ['mill'], payoffs: [] },
  },
  {
    name: 'Mesmeric Orb',
    type_line: 'Artifact',
    keywords: ['Mill'],
    oracle_text: "Whenever a permanent becomes untapped, that permanent's controller mills a card.",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Migration Path',
    type_line: 'Sorcery',
    keywords: ['Cycling'],
    oracle_text:
      'Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.\nCycling {2} ({2}, Discard this card: Draw a card.)',
    expect: { producers: ['cycling', 'landfall'], payoffs: [] },
  },
  {
    name: 'Mind Grind',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      "Each opponent reveals cards from the top of their library until they reveal X land cards, then puts all cards revealed this way into their graveyard. X can't be 0.",
    expect: { producers: ['mill'], payoffs: [] },
  },
  {
    name: 'Mortician Beetle',
    type_line: 'Creature \u2014 Insect',
    keywords: [],
    oracle_text:
      'Whenever a player sacrifices a creature, you may put a +1/+1 counter on this creature.',
    expect: { producers: ['counters'], payoffs: ['sacrifice'] },
  },
  {
    name: 'Mu Yanling, Wind Rider',
    type_line: 'Legendary Creature \u2014 Human Wizard Pilot',
    keywords: [],
    oracle_text:
      'When Mu Yanling enters, create a 3/2 colorless Vehicle artifact token with crew 1.\nVehicles you control have flying.\nWhenever one or more creatures you control with flying deal combat damage to a player, draw a card.',
    expect: { producers: ['artifacts'], payoffs: ['vehicles'] },
  },
  {
    name: 'Nadaar, Selfless Paladin',
    type_line: 'Legendary Creature \u2014 Dragon Knight',
    keywords: ['Vigilance', 'Venture into the dungeon'],
    oracle_text:
      "Vigilance\nWhenever Nadaar enters or attacks, venture into the dungeon. (Enter the first room or advance to the next room.)\nOther creatures you control get +1/+1 as long as you've completed a dungeon.",
    expect: { producers: ['venture'], payoffs: ['tokens', 'venture'] },
  },
  {
    name: 'New Perspectives',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'When this enchantment enters, draw three cards.\nAs long as you have seven or more cards in hand, you may pay {0} rather than pay cycling costs.',
    expect: { producers: ['cycling'], payoffs: [] },
  },
  {
    name: 'On Thin Ice',
    type_line: 'Snow Enchantment \u2014 Aura',
    keywords: ['Enchant'],
    oracle_text:
      'Enchant snow land you control\nWhen this Aura enters, exile target creature an opponent controls until this Aura leaves the battlefield.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Palace Jailer',
    type_line: 'Creature \u2014 Human Soldier',
    keywords: [],
    oracle_text:
      'When this creature enters, you become the monarch.\nWhen this creature enters, exile target creature an opponent controls until an opponent becomes the monarch.',
    expect: { producers: ['monarch'], payoffs: [] },
  },
  {
    name: 'Palace Sentinels',
    type_line: 'Creature \u2014 Human Soldier',
    keywords: [],
    oracle_text: 'When this creature enters, you become the monarch.',
    expect: { producers: ['monarch'], payoffs: [] },
  },
  {
    name: 'Path to Exile',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      'Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Peema Trailblazer',
    type_line: 'Creature \u2014 Elephant Warrior',
    keywords: ['Trample', 'Exhaust'],
    oracle_text:
      'Trample\nWhenever this creature deals combat damage to a player, you get that many {E} (energy counters).\nExhaust \u2014 Pay six {E}: Put two +1/+1 counters on this creature. Then draw cards equal to the greatest power among creatures you control. (Activate each exhaust ability only once.)',
    expect: { producers: ['counters', 'energy'], payoffs: ['energy'] },
  },
  {
    name: 'Pir, Imaginative Rascal',
    type_line: 'Legendary Creature \u2014 Human',
    keywords: ['Partner with', 'Partner'],
    oracle_text:
      'Partner with Toothy, Imaginary Friend (When this creature enters, target player may put Toothy into their hand from their library, then shuffle.)\nIf one or more counters would be put on a permanent your team controls, that many plus one of each of those kinds of counters are put on that permanent instead.',
    expect: { producers: [], payoffs: ['counters'] },
  },
  {
    name: 'Plague Myr',
    type_line: 'Artifact Creature \u2014 Phyrexian Myr',
    keywords: ['Infect'],
    oracle_text:
      'Infect (This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)\n{T}: Add {C}.',
    expect: { producers: ['poison'], payoffs: [] },
  },
  {
    name: 'Planar Void',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text: 'Whenever another card is put into a graveyard from anywhere, exile that card.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Prowling Geistcatcher',
    type_line: 'Creature \u2014 Human Rogue',
    keywords: [],
    oracle_text:
      'Whenever you sacrifice another creature, exile it. If that creature was a token, put a +1/+1 counter on this creature.\nWhen this creature leaves the battlefield, return each card exiled with it to the battlefield under your control.',
    expect: { producers: ['counters'], payoffs: ['sacrifice'] },
  },
  {
    name: 'Ramunap Excavator',
    type_line: 'Creature \u2014 Snake Cleric',
    keywords: [],
    oracle_text: 'You may play lands from your graveyard.',
    expect: { producers: ['landfall'], payoffs: [] },
  },
  {
    name: 'Reservoir Walker',
    type_line: 'Artifact Creature \u2014 Construct',
    keywords: [],
    oracle_text:
      'When this creature enters, you gain 3 life and get {E}{E}{E} (three energy counters).',
    expect: { producers: ['energy', 'lifegain'], payoffs: [] },
  },
  {
    name: 'Resplendent Angel',
    type_line: 'Creature \u2014 Angel',
    keywords: ['Flying'],
    oracle_text:
      'Flying\nAt the beginning of each end step, if you gained 5 or more life this turn, create a 4/4 white Angel creature token with flying and vigilance.\n{3}{W}{W}{W}: Until end of turn, this creature gets +2/+2 and gains lifelink.',
    expect: { producers: ['tokens'], payoffs: ['lifegain'] },
  },
  {
    name: 'Rite of Replication',
    type_line: 'Sorcery',
    keywords: ['Kicker'],
    oracle_text:
      "Kicker {5} (You may pay an additional {5} as you cast this spell.)\nCreate a token that's a copy of target creature. If this spell was kicked, create five of those tokens instead.",
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: 'Ruin Crab',
    type_line: 'Creature \u2014 Crab',
    keywords: ['Mill', 'Landfall'],
    oracle_text:
      'Landfall \u2014 Whenever a land you control enters, each opponent mills three cards. (To mill a card, a player puts the top card of their library into their graveyard.)',
    expect: { producers: ['mill'], payoffs: ['landfall'] },
  },
  {
    name: 'Savra, Queen of the Golgari',
    type_line: 'Legendary Creature \u2014 Elf Shaman',
    keywords: [],
    oracle_text:
      'Whenever you sacrifice a black creature, you may pay 2 life. If you do, each other player sacrifices a creature of their choice.\nWhenever you sacrifice a green creature, you may gain 2 life.',
    expect: { producers: ['lifegain'], payoffs: ['sacrifice'] },
  },
  {
    name: 'Second Harvest',
    type_line: 'Instant',
    keywords: [],
    oracle_text: "For each token you control, create a token that's a copy of that permanent.",
    expect: { producers: ['tokens'], payoffs: [] },
  },
  {
    name: 'Settle the Wreckage',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      'Exile all attacking creatures target player controls. That player may search their library for that many basic land cards, put those cards onto the battlefield tapped, then shuffle.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Shark Typhoon',
    type_line: 'Enchantment',
    keywords: ['Cycling'],
    oracle_text:
      "Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell's mana value.\nCycling {X}{1}{U} ({X}{1}{U}, Discard this card: Draw a card.)\nWhen you cycle this card, create an X/X blue Shark creature token with flying.",
    expect: { producers: ['cycling', 'tokens'], payoffs: ['cycling'] },
  },
  {
    name: 'Skinrender',
    type_line: 'Creature \u2014 Phyrexian Zombie',
    keywords: [],
    oracle_text: 'When this creature enters, put three -1/-1 counters on target creature.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Skithiryx, the Blight Dragon',
    type_line: 'Legendary Creature \u2014 Phyrexian Dragon Skeleton',
    keywords: ['Flying', 'Infect'],
    oracle_text:
      'Flying\nInfect (This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)\n{B}: Skithiryx gains haste until end of turn.\n{B}{B}: Regenerate Skithiryx.',
    expect: { producers: ['poison'], payoffs: [] },
  },
  {
    name: 'Skyline Despot',
    type_line: 'Creature \u2014 Dragon',
    keywords: ['Flying'],
    oracle_text:
      "Flying\nWhen this creature enters, you become the monarch.\nAt the beginning of your upkeep, if you're the monarch, create a 5/5 red Dragon creature token with flying.",
    expect: { producers: ['monarch', 'tokens'], payoffs: ['monarch'] },
  },
  {
    name: 'Smothering Abomination',
    type_line: 'Creature \u2014 Eldrazi',
    keywords: ['Flying', 'Devoid'],
    oracle_text:
      'Devoid (This card has no color.)\nFlying\nAt the beginning of your upkeep, sacrifice a creature.\nWhenever you sacrifice a creature, draw a card.',
    expect: { producers: ['sacrifice'], payoffs: ['sacrifice'] },
  },
  {
    name: 'Sphinx of the Revelation',
    type_line: 'Artifact Creature \u2014 Sphinx',
    keywords: ['Flying', 'Lifelink'],
    oracle_text:
      'Flying, lifelink\nWhenever you gain life, you get that many {E} (energy counters).\n{W}{U}{U}, {T}, Pay X {E}: Draw X cards.',
    expect: { producers: ['energy', 'lifegain'], payoffs: ['energy', 'lifegain'] },
  },
  {
    name: "Sphinx's Tutelage",
    type_line: 'Enchantment',
    keywords: ['Mill'],
    oracle_text:
      'Whenever you draw a card, target opponent mills two cards. If two nonland cards that share a color were milled this way, repeat this process.\n{5}{U}: Draw a card, then discard a card.',
    expect: { producers: ['discard', 'mill'], payoffs: [] },
  },
  {
    name: 'Splendid Reclamation',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text: 'Return all land cards from your graveyard to the battlefield tapped.',
    expect: { producers: ['landfall'], payoffs: ['graveyard'] },
  },
  {
    name: 'Squee, Dubious Monarch',
    type_line: 'Legendary Creature \u2014 Goblin Noble',
    keywords: ['Haste'],
    oracle_text:
      "Haste\nWhenever Squee attacks, create a 1/1 red Goblin creature token that's tapped and attacking.\nYou may cast this card from your graveyard by paying {3}{R} and exiling four other cards from your graveyard rather than paying its mana cost.",
    expect: { producers: ['tokens'], payoffs: ['graveyard'] },
  },
  {
    name: 'Startled Awake // Persistent Nightmare',
    type_line: 'Sorcery',
    keywords: ['Skulk', 'Transform', 'Mill'],
    oracle_text:
      "Target opponent mills thirteen cards.\n{3}{U}{U}: Put this card from your graveyard onto the battlefield transformed. Activate only as a sorcery.\nSkulk (This creature can't be blocked by creatures with greater power.)\nWhen this creature deals combat damage to a player, return it to its owner's hand.",
    expect: { producers: ['mill'], payoffs: ['graveyard'] },
  },
  {
    name: 'Sylvan Scrying',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      'Search your library for a land card, reveal it, put it into your hand, then shuffle.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Synth Eradicator',
    type_line: 'Artifact Creature \u2014 Synth Soldier',
    keywords: ['Haste'],
    oracle_text:
      "Haste\nWhenever this creature attacks, exile the top card of your library. You may get {E}{E} (two energy counters). If you don't, you may play that card this turn.\n{T}, Pay {E}{E}{E}: This creature deals 3 damage to any target.",
    expect: { producers: ['energy'], payoffs: ['energy'] },
  },
  {
    name: 'Tempt with Discovery',
    type_line: 'Sorcery',
    keywords: ['Tempting offer'],
    oracle_text:
      'Tempting offer \u2014 Search your library for a land card and put it onto the battlefield. Each opponent may search their library for a land card and put it onto the battlefield. For each opponent who searches a library this way, search your library for a land card and put it onto the battlefield. Then each player who searched a library this way shuffles.',
    expect: { producers: ['landfall'], payoffs: [] },
  },
  {
    name: 'The Bus Runner',
    type_line: 'Legendary Creature \u2014 Human Gamer',
    keywords: [],
    oracle_text:
      'When The Bus Runner enters, create a 4/4 Desert Vehicle artifact land token with crew 2. Put eight hour counters on it. It has "{T}: Add {C}" and "Whenever this token or a Gamer you control becomes tapped, remove an hour counter from this token. Then if it has no hour counters on it, each opponent loses 1 life, you gain 1 life, and put eight hour counters on this token."\nReady to run (You can have two commanders if both have ready to run.)',
    expect: { producers: ['lifegain'], payoffs: [] },
  },
  {
    name: 'The Monarch',
    type_line: 'Card',
    keywords: [],
    oracle_text:
      'At the beginning of your end step, draw a card.\nWhenever a creature deals combat damage to you, its controller becomes the monarch.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Throne Warden',
    type_line: 'Creature \u2014 Human Soldier',
    keywords: [],
    oracle_text:
      "At the beginning of your end step, if you're the monarch, put a +1/+1 counter on this creature.",
    expect: { producers: ['counters'], payoffs: ['monarch'] },
  },
  {
    name: 'Throne of the High City',
    type_line: 'Land',
    keywords: [],
    oracle_text: '{T}: Add {C}.\n{4}, {T}, Sacrifice this land: You become the monarch.',
    expect: { producers: ['monarch', 'sacrifice'], payoffs: [] },
  },
  {
    name: 'Toxic Deluge',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      'As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Traumatize',
    type_line: 'Sorcery',
    keywords: ['Mill'],
    oracle_text: 'Target player mills half their library, rounded down.',
    expect: { producers: ['mill'], payoffs: [] },
  },
  {
    name: 'Triumph of the Hordes',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      'Until end of turn, creatures you control get +1/+1 and gain trample and infect. (Creatures with infect deal damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)',
    expect: { producers: ['poison'], payoffs: ['poison', 'tokens'] },
  },
  {
    name: 'True Conviction',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text: 'Creatures you control have double strike and lifelink.',
    expect: { producers: ['lifegain'], payoffs: [] },
  },
  {
    name: 'Tyrranax Rex',
    type_line: 'Creature \u2014 Phyrexian Dinosaur',
    keywords: ['Toxic', 'Haste', 'Trample', 'Ward'],
    oracle_text:
      "This spell can't be countered.\nTrample, ward {4}, haste\nToxic 4 (Players dealt combat damage by this creature also get four poison counters.)",
    expect: { producers: ['poison'], payoffs: [] },
  },
  {
    name: 'Undermountain Adventurer',
    type_line: 'Creature \u2014 Giant Warrior',
    keywords: ['Vigilance'],
    oracle_text:
      "Vigilance\nWhen this creature enters, you take the initiative.\n{T}: Add {G}{G}. If you've completed a dungeon, add six {G} instead.",
    expect: { producers: ['venture'], payoffs: ['venture'] },
  },
  {
    name: 'Valiant Rescuer',
    type_line: 'Creature \u2014 Human Soldier',
    keywords: ['Cycling'],
    oracle_text:
      'Whenever you cycle another card for the first time each turn, create a 1/1 white Human Soldier creature token.\nCycling {2} ({2}, Discard this card: Draw a card.)',
    expect: { producers: ['cycling', 'tokens'], payoffs: ['cycling'] },
  },
  {
    name: 'Veteran Dungeoneer',
    type_line: 'Creature \u2014 Human Warrior',
    keywords: ['Venture into the dungeon'],
    oracle_text:
      'When this creature enters, venture into the dungeon. (Enter the first room or advance to the next room.)',
    expect: { producers: ['venture'], payoffs: [] },
  },
  {
    name: 'Vito, Thorn of the Dusk Rose',
    type_line: 'Legendary Creature \u2014 Vampire Cleric',
    keywords: [],
    oracle_text:
      'Whenever you gain life, target opponent loses that much life.\n{3}{B}{B}: Creatures you control gain lifelink until end of turn.',
    expect: { producers: ['lifegain'], payoffs: ['lifegain', 'tokens'] },
  },
  {
    name: 'Vorinclex, Monstrous Raider',
    type_line: 'Legendary Creature \u2014 Phyrexian Praetor',
    keywords: ['Haste', 'Trample'],
    oracle_text:
      'Trample, haste\nIf you would put one or more counters on a permanent or player, put twice that many of each of those kinds of counters on that permanent or player instead.\nIf an opponent would put one or more counters on a permanent or player, they put half that many of each of those kinds of counters on that permanent or player instead, rounded down.',
    expect: { producers: [], payoffs: ['counters'] },
  },
  {
    name: "Vraska, Betrayal's Sting",
    type_line: 'Legendary Planeswalker \u2014 Vraska',
    keywords: ['Proliferate', 'Compleated'],
    oracle_text:
      'Compleated ({B/P} can be paid with {B} or 2 life. If life was paid, this planeswalker enters with two fewer loyalty counters.)\n0: You draw a card and lose 1 life. Proliferate.\n\u22122: Target creature becomes a Treasure artifact with "{T}, Sacrifice this artifact: Add one mana of any color" and loses all other card types and abilities.\n\u22129: If target player has fewer than nine poison counters, they get a number of poison counters equal to the difference.',
    expect: { producers: ['superfriends', 'sacrifice'], payoffs: [] },
  },
  {
    name: 'Wall of Reverence',
    type_line: 'Creature \u2014 Spirit Wall',
    keywords: ['Flying', 'Defender'],
    oracle_text:
      'Defender, flying\nAt the beginning of your end step, you may gain life equal to the power of target creature you control.',
    expect: { producers: ['lifegain'], payoffs: [] },
  },
  {
    name: 'White Plume Adventurer',
    type_line: 'Creature \u2014 Orc Cleric',
    keywords: [],
    oracle_text:
      "When this creature enters, you take the initiative.\nAt the beginning of each opponent's upkeep, untap a creature you control. If you've completed a dungeon, untap all creatures you control instead.",
    expect: { producers: ['venture'], payoffs: ['venture'] },
  },
  {
    name: 'Wild Growth',
    type_line: 'Enchantment \u2014 Aura',
    keywords: ['Enchant'],
    oracle_text:
      'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: "Woodweaver's Puzzleknot",
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      'When this artifact enters, you gain 3 life and get {E}{E}{E} (three energy counters).\n{2}{G}, Sacrifice this artifact: You gain 3 life and get {E}{E}{E}.',
    expect: { producers: ['energy', 'lifegain', 'sacrifice'], payoffs: [] },
  },
  {
    name: 'World Shaper',
    type_line: 'Creature \u2014 Merfolk Shaman',
    keywords: ['Mill'],
    oracle_text:
      'Whenever this creature attacks, you may mill three cards.\nWhen this creature dies, return all land cards from your graveyard to the battlefield tapped.',
    expect: { producers: ['graveyard', 'landfall'], payoffs: ['graveyard'] },
  },
  {
    name: 'Yahenni, Undying Partisan',
    type_line: 'Legendary Creature \u2014 Aetherborn Vampire',
    keywords: ['Haste'],
    oracle_text:
      'Haste\nWhenever a creature an opponent controls dies, put a +1/+1 counter on Yahenni.\nSacrifice another creature: Yahenni gains indestructible until end of turn.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Zenith Flare',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      'Zenith Flare deals X damage to any target and you gain X life, where X is the number of cards with a cycling ability in your graveyard.',
    expect: { producers: ['lifegain'], payoffs: [] },
  },
  {
    name: 'Aetherflux Reservoir',
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      "Whenever you cast a spell, you gain 1 life for each spell you've cast this turn.\nPay 50 life: This artifact deals 50 damage to any target.",
    expect: { producers: ['lifegain'], payoffs: [] },
  },
  {
    name: 'Archangel of Tithes',
    type_line: 'Creature \u2014 Angel',
    keywords: ['Flying'],
    oracle_text:
      "Flying\nAs long as this creature is untapped, creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.\nAs long as this creature is attacking, creatures can't block unless their controller pays {1} for each of those creatures.",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Astral Slide',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      "Whenever a player cycles a card, you may exile target creature. If you do, return that card to the battlefield under its owner's control at the beginning of the next end step.",
    expect: { producers: ['blink'], payoffs: ['cycling'] },
  },
  {
    name: 'Branching Evolution',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on that creature instead.',
    expect: { producers: [], payoffs: ['counters'] },
  },
  {
    name: 'Codex Shredder',
    type_line: 'Artifact',
    keywords: ['Mill'],
    oracle_text:
      '{T}: Target player mills a card. (They put the top card of their library into their graveyard.)\n{5}, {T}, Sacrifice this artifact: Return target card from your graveyard to your hand.',
    expect: { producers: ['mill', 'sacrifice'], payoffs: ['graveyard'] },
  },
  {
    name: 'Comeuppance',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      "Prevent all damage that would be dealt to you and planeswalkers you control this turn by sources you don't control. If damage from a creature source is prevented this way, Comeuppance deals that much damage to that creature. If damage from a noncreature source is prevented this way, Comeuppance deals that much damage to the source's controller.",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Consuming Aberration',
    type_line: 'Creature \u2014 Horror',
    keywords: [],
    oracle_text:
      "Consuming Aberration's power and toughness are each equal to the number of cards in your opponents' graveyards.\nWhenever you cast a spell, each opponent reveals cards from the top of their library until they reveal a land card, then puts those cards into their graveyard.",
    expect: { producers: ['mill'], payoffs: [] },
  },
  {
    name: 'Corpsejack Menace',
    type_line: 'Creature \u2014 Fungus',
    keywords: [],
    oracle_text:
      'If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on it instead.',
    expect: { producers: [], payoffs: ['counters'] },
  },
  {
    name: 'Crop Rotation',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      'As an additional cost to cast this spell, sacrifice a land.\nSearch your library for a land card, put that card onto the battlefield, then shuffle.',
    expect: { producers: ['landfall'], payoffs: [] },
  },
  {
    name: 'Farseek',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      'Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle.',
    expect: { producers: ['landfall'], payoffs: [] },
  },
  {
    name: 'Gavi, Nest Warden',
    type_line: 'Legendary Creature \u2014 Human Shaman',
    keywords: [],
    oracle_text:
      'You may pay {0} rather than pay the cycling cost of the first card you cycle each turn.\nWhenever you draw your second card each turn, create a 2/2 red and white Dinosaur Cat creature token.',
    expect: { producers: ['cycling', 'tokens'], payoffs: [] },
  },
  {
    name: 'Gray Merchant of Asphodel',
    type_line: 'Creature \u2014 Zombie',
    keywords: [],
    oracle_text:
      'When this creature enters, each opponent loses X life, where X is your devotion to black. You gain life equal to the life lost this way. (Each {B} in the mana costs of permanents you control counts toward your devotion to black.)',
    expect: { producers: ['lifegain'], payoffs: [] },
  },
  {
    name: 'Greater Mossdog',
    type_line: 'Creature \u2014 Plant Dog',
    keywords: ['Dredge', 'Mill'],
    oracle_text:
      'Dredge 3 (If you would draw a card, you may mill three cards instead. If you do, return this card from your graveyard to your hand.)',
    expect: { producers: ['graveyard'], payoffs: [] },
  },
  {
    name: 'Harvester of Souls',
    type_line: 'Creature \u2014 Demon',
    keywords: ['Deathtouch'],
    oracle_text:
      'Deathtouch (Any amount of damage this deals to a creature is enough to destroy it.)\nWhenever another nontoken creature dies, you may draw a card.',
    expect: { producers: [], payoffs: ['sacrifice'] },
  },
  {
    name: 'Lightning Rift',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'Whenever a player cycles a card, you may pay {1}. If you do, this enchantment deals 2 damage to any target.',
    expect: { producers: [], payoffs: ['cycling'] },
  },
  {
    name: 'Mind Funeral',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      'Target opponent reveals cards from the top of their library until four land cards are revealed. That player puts all cards revealed this way into their graveyard.',
    expect: { producers: ['mill'], payoffs: [] },
  },
  {
    name: "Nature's Lore",
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      'Search your library for a Forest card, put that card onto the battlefield, then shuffle.',
    expect: { producers: ['landfall'], payoffs: [] },
  },
  {
    name: 'Nemesis of Reason',
    type_line: 'Creature \u2014 Leviathan Horror',
    keywords: ['Mill'],
    oracle_text: 'Whenever this creature attacks, defending player mills ten cards.',
    expect: { producers: ['mill'], payoffs: [] },
  },
  {
    name: 'Poison-Tip Archer',
    type_line: 'Creature \u2014 Elf Archer',
    keywords: ['Reach', 'Deathtouch'],
    oracle_text:
      'Reach (This creature can block creatures with flying.)\nDeathtouch (Any amount of damage this deals to a creature is enough to destroy it.)\nWhenever another creature dies, each opponent loses 1 life.',
    expect: { producers: [], payoffs: ['sacrifice'] },
  },
  {
    name: 'Primal Vigor',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'If one or more tokens would be created, twice that many of those tokens are created instead.\nIf one or more +1/+1 counters would be put on a creature, twice that many +1/+1 counters are put on that creature instead.',
    expect: { producers: [], payoffs: ['counters', 'tokens'] },
  },
  {
    name: 'Queen Marchesa',
    type_line: 'Legendary Creature \u2014 Human Assassin',
    keywords: ['Haste', 'Deathtouch'],
    oracle_text:
      'Deathtouch, haste\nWhen Queen Marchesa enters, you become the monarch.\nAt the beginning of your upkeep, if an opponent is the monarch, create a 1/1 black Assassin creature token with deathtouch and haste.',
    expect: { producers: ['monarch', 'tokens'], payoffs: ['monarch'] },
  },
  {
    name: "Saheeli's Artistry",
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      "Choose one or both \u2014\n\u2022 Create a token that's a copy of target artifact.\n\u2022 Create a token that's a copy of target creature, except it's an artifact in addition to its other types.",
    expect: { producers: ['artifacts', 'tokens'], payoffs: [] },
  },
  {
    name: 'Skyshroud Claim',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      'Search your library for up to two Forest cards, put them onto the battlefield, then shuffle.',
    expect: { producers: ['landfall'], payoffs: [] },
  },
  {
    name: 'Soul Snare',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      "{W}, Sacrifice this enchantment: Exile target creature that's attacking you or a planeswalker you control.",
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Sun Droplet',
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      "Whenever you're dealt damage, put that many charge counters on this artifact.\nAt the beginning of each upkeep, you may remove a charge counter from this artifact. If you do, you gain 1 life.",
    expect: { producers: ['lifegain'], payoffs: [] },
  },
  {
    name: 'Three Visits',
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      'Search your library for a Forest card, put it onto the battlefield, then shuffle.',
    expect: { producers: ['landfall'], payoffs: [] },
  },
  {
    name: "Trostani, Selesnya's Voice",
    type_line: 'Legendary Creature \u2014 Dryad',
    keywords: ['Populate'],
    oracle_text:
      "Whenever another creature you control enters, you gain life equal to that creature's toughness.\n{1}{G}{W}, {T}: Populate. (Create a token that's a copy of a creature token you control.)",
    expect: { producers: ['lifegain'], payoffs: ['blink', 'tokens'] },
  },
  // ── E138: sacrifice-axis producer rebuild — new/updated shapes ────────────
  {
    name: 'Arbiter of Woe',
    type_line: 'Creature — Demon',
    keywords: ['Flying'],
    oracle_text:
      'As an additional cost to cast this spell, sacrifice a creature.\nFlying\nWhen this creature enters, each opponent discards a card and loses 2 life. You draw a card and gain 2 life.',
    expect: { producers: ['discard', 'lifegain'], payoffs: [] },
  },
  {
    name: 'Aura Fracture',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text: 'Sacrifice a land: Destroy target enchantment.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Bog Glider',
    type_line: 'Creature — Human Mercenary',
    keywords: ['Flying'],
    oracle_text:
      'Flying\n{T}, Sacrifice a land: Search your library for a Mercenary permanent card with mana value 2 or less, put it onto the battlefield, then shuffle.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Call the Scions',
    type_line: 'Sorcery',
    keywords: ['Devoid'],
    oracle_text:
      'Devoid (This card has no color.)\nCreate two 1/1 colorless Eldrazi Scion creature tokens. They have "Sacrifice this token: Add {C}."',
    expect: { producers: ['sacrifice', 'tokens'], payoffs: [] },
  },
  {
    name: 'Chronomancer',
    type_line: 'Artifact Creature — Necron Wizard',
    keywords: ['Flying', 'Atomic Transmutation', 'Unearth'],
    oracle_text:
      'Flying\nAtomic Transmutation — {1}, {T}, Sacrifice another artifact: Draw a card.\nUnearth {2}{B} ({2}{B}: Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)',
    expect: { producers: ['sacrifice'], payoffs: ['graveyard'] },
  },
  {
    name: 'Delraich',
    type_line: 'Creature — Horror',
    keywords: ['Trample'],
    oracle_text:
      "You may sacrifice three black creatures rather than pay this spell's mana cost.\nTrample",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Distended Mindbender',
    type_line: 'Creature — Eldrazi Insect',
    keywords: ['Emerge'],
    oracle_text:
      "Emerge {5}{B}{B} (You may cast this spell by sacrificing a creature and paying the emerge cost reduced by that creature's mana value.)\nWhen you cast this spell, target opponent reveals their hand. You choose from it a nonland card with mana value 3 or less and a card with mana value 4 or greater. That player discards those cards.",
    expect: { producers: ['discard'], payoffs: [] },
  },
  {
    name: 'Diversion Unit',
    type_line: 'Artifact Creature — Robot',
    keywords: ['Flying'],
    oracle_text:
      'Flying\n{U}, Sacrifice this creature: Counter target instant or sorcery spell unless its controller pays {3}.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Dread Return',
    type_line: 'Sorcery',
    keywords: ['Flashback'],
    oracle_text:
      'Return target creature card from your graveyard to the battlefield.\nFlashback—Sacrifice three creatures. (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
    expect: { producers: [], payoffs: ['graveyard'] },
  },
  {
    name: 'Fandaniel, Telophoroi Ascian',
    type_line: 'Legendary Creature — Elder Wizard',
    keywords: ['Surveil'],
    oracle_text:
      "Whenever you cast an instant or sorcery spell, surveil 1.\nAt the beginning of your end step, each opponent may sacrifice a nontoken creature of their choice. Each opponent who doesn't loses 2 life for each instant and sorcery card in your graveyard.",
    expect: { producers: ['graveyard'], payoffs: ['spellslinger'] },
  },
  {
    name: 'Fault Riders',
    type_line: 'Creature — Human Soldier',
    keywords: [],
    oracle_text:
      'Sacrifice a land: This creature gets +2/+0 and gains first strike until end of turn. Activate only once each turn.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Floating Shield',
    type_line: 'Enchantment — Aura',
    keywords: ['Enchant'],
    oracle_text:
      "Enchant creature\nAs this Aura enters, choose a color.\nEnchanted creature has protection from the chosen color. This effect doesn't remove this Aura.\nSacrifice this Aura: Target creature gains protection from the chosen color until end of turn.",
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Gaius van Baelsar',
    type_line: 'Legendary Creature — Human Soldier',
    keywords: [],
    oracle_text:
      'When Gaius van Baelsar enters, choose one —\n• Each player sacrifices a creature token of their choice.\n• Each player sacrifices a nontoken creature of their choice.\n• Each player sacrifices an enchantment of their choice.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Gift of Doom',
    type_line: 'Enchantment — Aura',
    keywords: ['Morph', 'Enchant'],
    oracle_text:
      'Enchant creature\nEnchanted creature has deathtouch and indestructible.\nMorph—Sacrifice another creature. (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)\nAs this Aura is turned face up, you may attach it to a creature.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Gilded Goose',
    type_line: 'Creature — Bird',
    keywords: ['Flying', 'Food'],
    oracle_text:
      'Flying\nWhen this creature enters, create a Food token. (It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")\n{1}{G}, {T}: Create a Food token.\n{T}, Sacrifice a Food: Add one mana of any color.',
    expect: { producers: ['artifacts', 'sacrifice'], payoffs: [] },
  },
  {
    name: 'Goblin Soothsayer',
    type_line: 'Creature — Goblin Shaman',
    keywords: [],
    oracle_text: '{R}, {T}, Sacrifice a Goblin: Red creatures get +1/+1 until end of turn.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Heart of Yavimaya',
    type_line: 'Land',
    keywords: [],
    oracle_text:
      "If this land would enter, sacrifice a Forest instead. If you do, put this land onto the battlefield. If you don't, put it into its owner's graveyard.\n{T}: Add {G}.\n{T}: Target creature gets +1/+1 until end of turn.",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Horror of Horrors',
    type_line: 'Enchantment',
    keywords: ['Heal', 'Regenerate'],
    oracle_text:
      'Sacrifice a Swamp: Regenerate target black creature. (The next time that creature would be destroyed this turn, instead tap it, remove it from combat, and heal all damage on it.)',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Illicit Shipment',
    type_line: 'Sorcery',
    keywords: ['Casualty'],
    oracle_text:
      'Casualty 3 (As you cast this spell, you may sacrifice a creature with power 3 or greater. When you do, copy this spell.)\nSearch your library for a card, put it into your hand, then shuffle.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: "Kazuul's Fury",
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      "As an additional cost to cast this spell, sacrifice a creature.\nKazuul's Fury deals damage equal to the sacrificed creature's power to any target.",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Krark-Clan Ironworks',
    type_line: 'Artifact',
    keywords: [],
    oracle_text: 'Sacrifice an artifact: Add {C}{C}.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Krenko, Baron of Tin Street',
    type_line: 'Legendary Creature — Goblin',
    keywords: ['Haste'],
    oracle_text:
      'Haste\n{T}, Sacrifice an artifact: Put a +1/+1 counter on each Goblin you control.\nWhenever an artifact is put into a graveyard from the battlefield, you may pay {R}. If you do, create a 1/1 red Goblin creature token. It gains haste until end of turn.',
    expect: { producers: ['counters', 'sacrifice', 'tokens'], payoffs: ['artifacts'] },
  },
  {
    name: "Life's Legacy",
    type_line: 'Sorcery',
    keywords: [],
    oracle_text:
      "As an additional cost to cast this spell, sacrifice a creature.\nDraw cards equal to the sacrificed creature's power.",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Mana Vortex',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      "When you cast this spell, counter it unless you sacrifice a land.\nAt the beginning of each player's upkeep, that player sacrifices a land of their choice.\nWhen there are no lands on the battlefield, sacrifice this enchantment.",
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Olivia, Opulent Outlaw',
    type_line: 'Legendary Creature — Vampire Assassin',
    keywords: ['Flying', 'Lifelink', 'Treasure'],
    oracle_text:
      'Flying, lifelink\nWhenever one or more outlaws you control deal combat damage to a player, create a Treasure token. (Assassins, Mercenaries, Pirates, Rogues, and Warlocks are outlaws.)\n{3}, Sacrifice two Treasures: Put two +1/+1 counters on each creature you control. Activate only as a sorcery.',
    expect: { producers: ['artifacts', 'counters', 'lifegain', 'sacrifice'], payoffs: [] },
  },
  {
    name: 'Plumb the Forbidden',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      'As an additional cost to cast this spell, you may sacrifice one or more creatures. When you do, copy this spell for each creature sacrificed this way.\nYou draw a card and lose 1 life.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Polygraph Orb',
    type_line: 'Artifact',
    keywords: ['Collect evidence'],
    oracle_text:
      'When this artifact enters, look at the top four cards of your library. Put two of them into your hand and the rest into your graveyard. You lose 2 life.\n{2}, {T}, Collect evidence 3: Each opponent loses 3 life unless they discard a card or sacrifice a creature. (To collect evidence 3, exile cards with total mana value 3 or greater from your graveyard.)',
    expect: { producers: ['discard', 'graveyard'], payoffs: [] },
  },
  {
    name: 'Predator Dragon',
    type_line: 'Creature — Dragon',
    keywords: ['Flying', 'Haste', 'Devour'],
    oracle_text:
      'Flying, haste\nDevour 2 (As this creature enters, you may sacrifice any number of creatures. It enters with twice that many +1/+1 counters on it.)',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Ravenous Rotbelly',
    type_line: 'Creature — Zombie Horror',
    keywords: [],
    oracle_text:
      'When this creature enters, you may sacrifice up to three Zombies. When you sacrifice one or more Zombies this way, each opponent sacrifices that many creatures of their choice.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Realm-Scorcher Hellkite',
    type_line: 'Creature — Dragon',
    keywords: ['Flying', 'Haste', 'Bargain'],
    oracle_text:
      'Bargain (You may sacrifice an artifact, enchantment, or token as you cast this spell.)\nFlying, haste\nWhen this creature enters, if it was bargained, add four mana in any combination of colors.\n{1}{R}: This creature deals 1 damage to any target.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Return of the Mole Man',
    type_line: 'Enchantment',
    keywords: ['Mill', 'Landfall'],
    oracle_text:
      'Landfall — Whenever a land you control enters, you may mill two cards.\n{5}{G}, Sacrifice this enchantment: Create X 1/1 green Minion creature tokens named Moloid, where X is the number of permanent cards in your graveyard. The tokens have "Whenever this token attacks, you may mill a card." Activate only as a sorcery.',
    expect: { producers: ['graveyard', 'sacrifice', 'tokens'], payoffs: ['landfall'] },
  },
  {
    name: 'Ribtruss Roaster',
    type_line: 'Creature — Troll Druid',
    keywords: ['Devour'],
    oracle_text:
      'Devour 1 (As this creature enters, you may sacrifice any number of creatures. This creature enters with that many +1/+1 counters on it.)\nAt the beginning of your end step, create a number of 1/1 black and green Pest creature tokens equal to the number of +1/+1 counters on this creature. They have "When this token dies, you gain 1 life."',
    expect: { producers: ['counters', 'lifegain', 'sacrifice', 'tokens'], payoffs: [] },
  },
  {
    name: 'Rush of Dread',
    type_line: 'Sorcery',
    keywords: ['Spree'],
    oracle_text:
      'Spree (Choose one or more additional costs.)\n+ {1} — Target opponent sacrifices half the creatures they control of their choice, rounded up.\n+ {2} — Target opponent discards half the cards in their hand, rounded up.\n+ {2} — Target opponent loses half their life, rounded up.',
    expect: { producers: ['discard'], payoffs: [] },
  },
  {
    name: 'Scrap Compactor',
    type_line: 'Artifact',
    keywords: [],
    oracle_text:
      '{3}, {T}, Sacrifice this artifact: It deals 3 damage to target creature.\n{6}, {T}, Sacrifice this artifact: Destroy target creature or Vehicle.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Seaside Haven',
    type_line: 'Land',
    keywords: [],
    oracle_text: '{T}: Add {C}.\n{W}{U}, {T}, Sacrifice a Bird: Draw a card.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Seasinger',
    type_line: 'Creature — Merfolk',
    keywords: [],
    oracle_text:
      'When you control no Islands, sacrifice this creature.\nYou may choose not to untap this creature during your untap step.\n{T}: Gain control of target creature whose controller controls an Island for as long as you control this creature and this creature remains tapped.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Seething Pathblazer',
    type_line: 'Creature — Elemental Warrior',
    keywords: [],
    oracle_text:
      'Sacrifice an Elemental: This creature gets +2/+0 and gains first strike until end of turn.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'She-Hulk, Jennifer Walters',
    type_line: 'Legendary Creature — Gamma Berserker Hero',
    keywords: ['Trample'],
    oracle_text:
      "Trample (This creature can deal excess combat damage to the player she's attacking.)\n{2}{R}, Sacrifice a land: Draw a card and put a +1/+1 counter on She-Hulk.",
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Springjack Pasture',
    type_line: 'Land',
    keywords: [],
    oracle_text:
      '{T}: Add {C}.\n{4}, {T}: Create a 0/1 white Goat creature token.\n{T}, Sacrifice X Goats: Add X mana of any one color. You gain X life.',
    expect: { producers: ['lifegain', 'sacrifice', 'tokens'], payoffs: [] },
  },
  {
    name: 'Sprouting Goblin',
    type_line: 'Creature — Goblin Druid',
    keywords: ['Kicker'],
    oracle_text:
      'Kicker {G} (You may pay an additional {G} as you cast this spell.)\nWhen this creature enters, if it was kicked, search your library for a land card with a basic land type, reveal it, put it into your hand, then shuffle.\n{R}, {T}, Sacrifice a land: Draw a card.',
    expect: { producers: ['sacrifice'], payoffs: [] },
  },
  {
    name: 'Task Mage Assembly',
    type_line: 'Enchantment',
    keywords: [],
    oracle_text:
      'When there are no creatures on the battlefield, sacrifice this enchantment.\n{2}: This enchantment deals 1 damage to target creature. Any player may activate this ability but only as a sorcery.',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Touch of Moonglove',
    type_line: 'Instant',
    keywords: [],
    oracle_text:
      'Target creature you control gets +1/+0 and gains deathtouch until end of turn. Whenever a creature dealt damage by that creature dies this turn, its controller loses 2 life. (Any amount of damage a creature with deathtouch deals to a creature is enough to destroy it.)',
    expect: { producers: [], payoffs: [] },
  },
  {
    name: 'Voice of Resurgence',
    type_line: 'Creature — Elemental',
    keywords: [],
    oracle_text:
      'Whenever an opponent casts a spell during your turn and when this creature dies, create a green and white Elemental creature token with "This token\'s power and toughness are each equal to the number of creatures you control."',
    expect: { producers: ['tokens'], payoffs: ['tokens'] },
  },
];
