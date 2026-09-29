// Real Scryfall Oracle text and type lines (default printings, 2026-09),
// the cards E511's tribal engine tests read.
import type { ScryfallCard } from '@/deck-builder/types';

type Printed = Pick<ScryfallCard, 'name' | 'type_line' | 'oracle_text' | 'keywords' | 'card_faces'>;

const RAW: Printed[] = [
  {
    name: 'Lathril, Blade of the Elves',
    type_line: 'Legendary Creature — Elf Noble',
    oracle_text:
      "Menace (This creature can't be blocked except by two or more creatures.)\nWhenever Lathril deals combat damage to a player, create that many 1/1 green Elf Warrior creature tokens.\n{T}, Tap ten untapped Elves you control: Each opponent loses 10 life and you gain 10 life.",
    keywords: ['Menace'],
  },
  {
    name: 'Elvish Archdruid',
    type_line: 'Creature — Elf Druid',
    oracle_text:
      'Other Elf creatures you control get +1/+1.\n{T}: Add {G} for each Elf you control.',
    keywords: [],
  },
  {
    name: 'Llanowar Elves',
    type_line: 'Creature — Elf Druid',
    oracle_text: '{T}: Add {G}.',
    keywords: [],
  },
  {
    name: 'Elvish Mystic',
    type_line: 'Creature — Elf Druid',
    oracle_text: '{T}: Add {G}.',
    keywords: [],
  },
  {
    name: 'Priest of Titania',
    type_line: 'Creature — Elf Druid',
    oracle_text: '{T}: Add {G} for each Elf on the battlefield.',
    keywords: [],
  },
  {
    name: 'Heritage Druid',
    type_line: 'Creature — Elf Druid',
    oracle_text: 'Tap three untapped Elves you control: Add {G}{G}{G}.',
    keywords: [],
  },
  {
    name: 'Elvish Warmaster',
    type_line: 'Creature — Elf Warrior',
    oracle_text:
      'Whenever one or more other Elves you control enter, create a 1/1 green Elf Warrior creature token. This ability triggers only once each turn.\n{5}{G}{G}: Elves you control get +2/+2 and gain deathtouch until end of turn.',
    keywords: [],
  },
  {
    name: 'Imperious Perfect',
    type_line: 'Creature — Elf Warrior',
    oracle_text:
      'Other Elves you control get +1/+1.\n{G}, {T}: Create a 1/1 green Elf Warrior creature token.',
    keywords: [],
  },
  {
    name: 'Marwyn, the Nurturer',
    type_line: 'Legendary Creature — Elf Druid',
    oracle_text:
      "Whenever another Elf you control enters, put a +1/+1 counter on Marwyn.\n{T}: Add an amount of {G} equal to Marwyn's power.",
    keywords: [],
  },
  {
    name: 'Elvish Visionary',
    type_line: 'Creature — Elf Shaman',
    oracle_text: 'When this creature enters, draw a card.',
    keywords: [],
  },
  {
    name: 'Fyndhorn Elves',
    type_line: 'Creature — Elf Druid',
    oracle_text: '{T}: Add {G}.',
    keywords: [],
  },
  {
    name: 'Allosaurus Shepherd',
    type_line: 'Creature — Elf Shaman',
    oracle_text:
      "This spell can't be countered.\nGreen spells you control can't be countered.\n{4}{G}{G}: Until end of turn, each Elf creature you control has base power and toughness 5/5 and becomes a Dinosaur in addition to its other creature types.",
    keywords: [],
  },
  {
    name: "Vanquisher's Banner",
    type_line: 'Artifact',
    oracle_text:
      'As this artifact enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.\nWhenever you cast a creature spell of the chosen type, draw a card.',
    keywords: [],
  },
  {
    name: 'Banner of Kinship',
    type_line: 'Artifact',
    oracle_text:
      'As this artifact enters, choose a creature type. This artifact enters with a fellowship counter on it for each creature you control of the chosen type.\nCreatures you control of the chosen type get +1/+1 for each fellowship counter on this artifact.',
    keywords: [],
  },
  {
    name: 'Patchwork Banner',
    type_line: 'Artifact',
    oracle_text:
      'As this artifact enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.\n{T}: Add one mana of any color.',
    keywords: [],
  },
  {
    name: 'Changeling Outcast',
    type_line: 'Creature — Shapeshifter',
    oracle_text:
      "Changeling (This card is every creature type.)\nThis creature can't block and can't be blocked.",
    keywords: ['Changeling'],
  },
  {
    name: 'Realmwalker',
    type_line: 'Creature — Shapeshifter',
    oracle_text:
      'Changeling (This card is every creature type.)\nAs this creature enters, choose a creature type.\nYou may look at the top card of your library any time.\nYou may cast creature spells of the chosen type from the top of your library.',
    keywords: ['Changeling'],
  },
  {
    name: 'Metallic Mimic',
    type_line: 'Artifact Creature — Shapeshifter',
    oracle_text:
      'As this creature enters, choose a creature type.\nThis creature is the chosen type in addition to its other types.\nEach other creature you control of the chosen type enters with an additional +1/+1 counter on it.',
    keywords: [],
  },
  {
    name: 'Lightning Greaves',
    type_line: 'Artifact — Equipment',
    oracle_text:
      "Equipped creature has haste and shroud. (It can't be the target of spells or abilities.)\nEquip {0}",
    keywords: ['Equip'],
  },
  {
    name: 'Swiftfoot Boots',
    type_line: 'Artifact — Equipment',
    oracle_text:
      "Equipped creature has hexproof and haste. (It can't be the target of spells or abilities your opponents control. It can attack and {T} no matter when it came under your control.)\nEquip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)",
    keywords: ['Equip'],
  },
  { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.', keywords: [] },
  {
    name: 'Krenko, Mob Boss',
    type_line: 'Legendary Creature — Goblin Warrior',
    oracle_text:
      '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
    keywords: [],
  },
  {
    name: 'Goblin Chieftain',
    type_line: 'Creature — Goblin',
    oracle_text:
      'Haste (This creature can attack and {T} as soon as it comes under your control.)\nOther Goblin creatures you control get +1/+1 and have haste.',
    keywords: ['Haste'],
  },
  {
    name: 'Goblin King',
    type_line: 'Creature — Goblin',
    oracle_text: 'Other Goblins get +1/+1 and have mountainwalk.',
    keywords: [],
  },
  {
    name: 'Goblin Warchief',
    type_line: 'Creature — Goblin Warrior',
    oracle_text: 'Goblin spells you cast cost {1} less to cast.\nGoblins you control have haste.',
    keywords: [],
  },
  {
    name: 'Skirk Prospector',
    type_line: 'Creature — Goblin',
    oracle_text: 'Sacrifice a Goblin: Add {R}.',
    keywords: [],
  },
  {
    name: 'Goblin Matron',
    type_line: 'Creature — Goblin',
    oracle_text:
      'When this creature enters, you may search your library for a Goblin card, reveal that card, put it into your hand, then shuffle.',
    keywords: [],
  },
  {
    name: 'Beetleback Chief',
    type_line: 'Creature — Goblin Warrior',
    oracle_text: 'When this creature enters, create two 1/1 red Goblin creature tokens.',
    keywords: [],
  },
  {
    name: 'Legion Loyalist',
    type_line: 'Creature — Goblin Soldier',
    oracle_text:
      "Haste\nBattalion — Whenever this creature and at least two other creatures attack, creatures you control gain first strike and trample until end of turn and can't be blocked by creature tokens this turn.",
    keywords: ['Battalion', 'Haste'],
  },
  {
    name: 'Goblin Lackey',
    type_line: 'Creature — Goblin',
    oracle_text:
      'Whenever this creature deals damage to a player, you may put a Goblin permanent card from your hand onto the battlefield.',
    keywords: [],
  },
  {
    name: 'Mogg War Marshal',
    type_line: 'Creature — Goblin Warrior',
    oracle_text:
      'Echo {1}{R} (At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.)\nWhen this creature enters or dies, create a 1/1 red Goblin creature token.',
    keywords: ['Echo'],
  },
  {
    name: 'Goblin Recruiter',
    type_line: 'Creature — Goblin',
    oracle_text:
      'When this creature enters, search your library for any number of Goblin cards, reveal them, then shuffle and put those cards on top in any order.',
    keywords: [],
  },
  {
    name: 'Conspicuous Snoop',
    type_line: 'Creature — Goblin Rogue',
    oracle_text:
      'Play with the top card of your library revealed.\nYou may cast Goblin spells from the top of your library.\nAs long as the top card of your library is a Goblin card, this creature has all activated abilities of that card.',
    keywords: [],
  },
  {
    name: 'Muxus, Goblin Grandee',
    type_line: 'Legendary Creature — Goblin Noble',
    oracle_text:
      'When Muxus enters, reveal the top six cards of your library. Put all Goblin creature cards with mana value 5 or less from among them onto the battlefield and the rest on the bottom of your library in a random order.\nWhenever Muxus attacks, it gets +1/+1 until end of turn for each other Goblin you control.',
    keywords: [],
  },
  {
    name: 'The Ur-Dragon',
    type_line: 'Legendary Creature — Dragon Avatar',
    oracle_text:
      'Eminence — As long as The Ur-Dragon is in the command zone or on the battlefield, other Dragon spells you cast cost {1} less to cast.\nFlying\nWhenever one or more Dragons you control attack, draw that many cards, then you may put a permanent card from your hand onto the battlefield.',
    keywords: ['Flying', 'Eminence'],
  },
  {
    name: "Dragonlord's Servant",
    type_line: 'Creature — Goblin Shaman',
    oracle_text: 'Dragon spells you cast cost {1} less to cast.',
    keywords: [],
  },
  {
    name: 'Dragonspeaker Shaman',
    type_line: 'Creature — Human Barbarian Shaman',
    oracle_text: 'Dragon spells you cast cost {2} less to cast.',
    keywords: [],
  },
  {
    name: 'Scourge of Valkas',
    type_line: 'Creature — Dragon',
    oracle_text:
      'Flying\nWhenever this creature or another Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.\n{R}: This creature gets +1/+0 until end of turn.',
    keywords: ['Flying'],
  },
  {
    name: 'Old Gnawbone',
    type_line: 'Legendary Creature — Dragon',
    oracle_text:
      'Flying\nWhenever a creature you control deals combat damage to a player, create that many Treasure tokens.',
    keywords: ['Flying', 'Treasure'],
  },
  {
    name: 'Lathliss, Dragon Queen',
    type_line: 'Legendary Creature — Dragon',
    oracle_text:
      'Flying\nWhenever another nontoken Dragon you control enters, create a 5/5 red Dragon creature token with flying.\n{1}{R}: Dragons you control get +1/+0 until end of turn.',
    keywords: ['Flying'],
  },
  {
    name: 'Miirym, Sentinel Wyrm',
    type_line: 'Legendary Creature — Dragon Spirit',
    oracle_text:
      "Flying, ward {2}\nWhenever another nontoken Dragon you control enters, create a token that's a copy of it, except the token isn't legendary.",
    keywords: ['Flying', 'Ward'],
  },
  {
    name: 'Goldspan Dragon',
    type_line: 'Creature — Dragon',
    oracle_text:
      'Flying, haste\nWhenever this creature attacks or becomes the target of a spell, create a Treasure token.\nTreasures you control have "{T}, Sacrifice this artifact: Add two mana of any one color."',
    keywords: ['Flying', 'Treasure', 'Haste'],
  },
  {
    name: 'Utvara Hellkite',
    type_line: 'Creature — Dragon',
    oracle_text:
      'Flying\nWhenever a Dragon you control attacks, create a 6/6 red Dragon creature token with flying.',
    keywords: ['Flying'],
  },
  {
    name: 'Dragon Tempest',
    type_line: 'Enchantment',
    oracle_text:
      'Whenever a creature you control with flying enters, it gains haste until end of turn.\nWhenever a Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.',
    keywords: [],
  },
  {
    name: 'Terror of the Peaks',
    type_line: 'Creature — Dragon',
    oracle_text:
      "Flying\nSpells your opponents cast that target this creature cost an additional 3 life to cast.\nWhenever another creature you control enters, this creature deals damage equal to that creature's power to any target.",
    keywords: ['Flying'],
  },
  {
    name: 'Klauth, Unrivaled Ancient',
    type_line: 'Legendary Creature — Dragon',
    oracle_text:
      "Flying, haste\nWhenever Klauth attacks, add X mana in any combination of colors, where X is the total power of attacking creatures. Spend this mana only to cast spells. Until end of turn, you don't lose this mana as steps and phases end.",
    keywords: ['Flying', 'Haste'],
  },
  {
    name: 'Wilhelt, the Rotcleaver',
    type_line: 'Legendary Creature — Zombie Warrior',
    oracle_text:
      "Whenever another Zombie you control dies, if it didn't have decayed, create a 2/2 black Zombie creature token with decayed. (It can't block. When it attacks, sacrifice it at end of combat.)\nAt the beginning of your end step, you may sacrifice a Zombie. If you do, draw a card.",
    keywords: [],
  },
  {
    name: 'Varina, Lich Queen',
    type_line: 'Legendary Creature — Zombie Wizard',
    oracle_text:
      'Whenever you attack with one or more Zombies, draw that many cards, then discard that many cards. You gain that much life.\n{2}, Exile two cards from your graveyard: Create a tapped 2/2 black Zombie creature token.',
    keywords: [],
  },
  {
    name: 'Death Baron',
    type_line: 'Creature — Zombie Wizard',
    oracle_text:
      'Skeletons you control and other Zombies you control get +1/+1 and have deathtouch. (Any amount of damage they deal to a creature is enough to destroy it.)',
    keywords: [],
  },
  {
    name: 'Diregraf Captain',
    type_line: 'Creature — Zombie Soldier',
    oracle_text:
      'Deathtouch\nOther Zombie creatures you control get +1/+1.\nWhenever another Zombie you control dies, target opponent loses 1 life.',
    keywords: ['Deathtouch'],
  },
  {
    name: 'Lord of the Accursed',
    type_line: 'Creature — Zombie',
    oracle_text:
      'Other Zombies you control get +1/+1.\n{1}{B}, {T}: All Zombies gain menace until end of turn.',
    keywords: [],
  },
  {
    name: 'Cryptbreaker',
    type_line: 'Creature — Zombie',
    oracle_text:
      '{1}{B}, {T}, Discard a card: Create a 2/2 black Zombie creature token.\nTap three untapped Zombies you control: You draw a card and lose 1 life.',
    keywords: [],
  },
  {
    name: 'Gray Merchant of Asphodel',
    type_line: 'Creature — Zombie',
    oracle_text:
      'When this creature enters, each opponent loses X life, where X is your devotion to black. You gain life equal to the life lost this way. (Each {B} in the mana costs of permanents you control counts toward your devotion to black.)',
    keywords: [],
  },
  {
    name: 'Undead Warchief',
    type_line: 'Creature — Zombie',
    oracle_text:
      'Zombie spells you cast cost {1} less to cast.\nZombie creatures you control get +2/+1.',
    keywords: [],
  },
  {
    name: 'Cemetery Reaper',
    type_line: 'Creature — Zombie',
    oracle_text:
      'Other Zombie creatures you control get +1/+1.\n{2}{B}, {T}: Exile target creature card from a graveyard. Create a 2/2 black Zombie creature token.',
    keywords: [],
  },
  {
    name: 'Champion of the Perished',
    type_line: 'Creature — Zombie',
    oracle_text:
      'Whenever another Zombie you control enters, put a +1/+1 counter on this creature.',
    keywords: [],
  },
  {
    name: 'Gravecrawler',
    type_line: 'Creature — Zombie',
    oracle_text:
      "This creature can't block.\nYou may cast this card from your graveyard as long as you control a Zombie.",
    keywords: [],
  },
  {
    name: 'Relentless Dead',
    type_line: 'Creature — Zombie',
    oracle_text:
      "Menace (This creature can't be blocked except by two or more creatures.)\nWhen this creature dies, you may pay {B}. If you do, return it to its owner's hand.\nWhen this creature dies, you may pay {X}. If you do, return another target Zombie creature card with mana value X from your graveyard to the battlefield.",
    keywords: ['Menace'],
  },
  {
    name: 'Diregraf Colossus',
    type_line: 'Creature — Zombie Giant',
    oracle_text:
      'This creature enters with a +1/+1 counter on it for each Zombie card in your graveyard.\nWhenever you cast a Zombie spell, create a tapped 2/2 black Zombie creature token.',
    keywords: [],
  },
  {
    name: 'Gisa, Glorious Resurrector',
    type_line: 'Legendary Creature — Human Wizard',
    oracle_text:
      "If a creature an opponent controls would die, exile it instead.\nAt the beginning of your upkeep, put all creature cards exiled with Gisa onto the battlefield under your control. They gain decayed. (A creature with decayed can't block. When it attacks, sacrifice it at end of combat.)",
    keywords: [],
  },
  {
    name: 'Dragonstorm Globe',
    type_line: 'Artifact',
    oracle_text:
      'Each Dragon you control enters with an additional +1/+1 counter on it.\n{T}: Add one mana of any color.',
    keywords: [],
  },
  {
    name: 'Sivitri, Dragon Master',
    type_line: 'Legendary Planeswalker — Sivitri',
    oracle_text:
      "+1: Until your next turn, creatures can't attack you or planeswalkers you control unless their controller pays 2 life for each of those creatures.\n−3: Search your library for a Dragon card, reveal it, put it into your hand, then shuffle.\n−7: Destroy all non-Dragon creatures.\nSivitri, Dragon Master can be your commander.",
    keywords: [],
  },
  {
    name: 'Headless Rider',
    type_line: 'Creature — Zombie',
    oracle_text:
      'Whenever this creature or another nontoken Zombie you control dies, create a 2/2 black Zombie creature token.',
    keywords: [],
  },
  {
    name: 'Tomb Tyrant',
    type_line: 'Creature — Zombie Noble',
    oracle_text:
      'Other Zombies you control get +1/+1.\n{2}{B}, {T}, Sacrifice a creature: Return a Zombie creature card at random from your graveyard to the battlefield. Activate only during your turn and only if there are at least three Zombie creature cards in your graveyard.',
    keywords: [],
  },
  {
    name: "Liliana's Mastery",
    type_line: 'Enchantment',
    oracle_text:
      'Zombies you control get +1/+1.\nWhen this enchantment enters, create two 2/2 black Zombie creature tokens.',
    keywords: [],
  },
];

/** Minimal ScryfallCard for the classifier and the tally: the rest is inert. */
export const TRIBAL_CARDS: ReadonlyMap<string, ScryfallCard> = new Map(
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
