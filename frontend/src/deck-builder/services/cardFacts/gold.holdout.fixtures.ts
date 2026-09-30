/**
 * BLIND holdout for card facts: 100 commander-legal cards drawn at random, then
 * labeled from their oracle text before the extractor ever ran on them.
 *
 * Draw: Scryfall oracle_cards (updated 2026-09-29T09:01:56Z), commander-legal,
 * minus the dev gold set, stratified by front-face type (creature 34, instant
 * 14, sorcery 14, enchantment 12, artifact 12, planeswalker/battle 6, land 8),
 * each stratum sorted by oracle id and sampled with mulberry32(20260929).
 * Same label grammar as gold.fixtures.ts.
 *
 * Never tune the extractor against these labels. gold.test.ts records the
 * number this set scored the first time it was run (the honest estimate) next
 * to the current one; a rule change that moves the current number was made
 * with this set in view and must say so.
 */
import type { GoldCard } from './bench';

export const HOLDOUT: GoldCard[] = [
  {
    card: {
      oracle_id: '54accd4a-b471-4ae5-b3b2-a5cec44023b7',
      name: 'Rapacious Guest',
      layout: 'normal',
      type_line: 'Creature — Halfling Citizen',
      mana_cost: '{2}{B}',
      oracle_text:
        'Menace\nWhenever one or more creatures you control deal combat damage to a player, create a Food token.\nWhenever you sacrifice a Food, put a +1/+1 counter on this creature.\nWhen this creature leaves the battlefield, target opponent loses life equal to its power.',
      keywords: ['Food', 'Menace'],
      power: '2',
      toughness: '2',
      cmc: 3,
    },
    tags: ['lifegain'],
    expect: {
      roles: {},
      interaction: [],
      produces: ['food'],
      payoffs: ['attack', 'food'],
    },
  },
  {
    card: {
      oracle_id: 'bd73ab86-0ac9-4ce0-be41-f4ad257e74f6',
      name: 'Dread Reaper',
      layout: 'normal',
      type_line: 'Creature — Horror',
      mana_cost: '{3}{B}{B}{B}',
      oracle_text: 'Flying\nWhen this creature enters, you lose 5 life.',
      keywords: ['Flying'],
      power: '6',
      toughness: '5',
      cmc: 6,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '4af23012-16eb-47be-b666-3e536d8f6c1b',
      name: 'Flame-Kin Zealot',
      layout: 'normal',
      type_line: 'Creature — Elemental Berserker',
      mana_cost: '{1}{R}{R}{W}',
      oracle_text:
        'When this creature enters, creatures you control get +1/+1 and gain haste until end of turn.',
      keywords: [],
      power: '2',
      toughness: '2',
      cmc: 4,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '4163aa30-7e3d-424f-b003-f4a300f0071e',
      name: 'Elvish Vanguard',
      layout: 'normal',
      type_line: 'Creature — Elf Warrior',
      mana_cost: '{1}{G}',
      oracle_text: 'Whenever another Elf enters, put a +1/+1 counter on this creature.',
      keywords: [],
      power: '1',
      toughness: '1',
      cmc: 2,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '991fd651-0cba-41ee-855a-d01a1a7c8f60',
      name: 'Anikthea, Hand of Erebos',
      layout: 'normal',
      type_line: 'Legendary Enchantment Creature — Demigod',
      mana_cost: '{2}{W}{B}{G}',
      oracle_text:
        "Menace\nOther enchantment creatures you control have menace.\nWhenever Anikthea enters or attacks, exile up to one target non-Aura enchantment card from your graveyard. Create a token that's a copy of that card, except it's a 3/3 black Zombie creature in addition to its other types.",
      keywords: ['Menace'],
      power: '4',
      toughness: '4',
      cmc: 5,
    },
    tags: [],
    expect: {
      roles: {
        recursion: 'P triggered per-event',
      },
      interaction: [],
      produces: ['copy'],
      payoffs: ['attack'],
    },
  },
  {
    card: {
      oracle_id: '56c5afdc-6777-45c7-8e2c-3cadecb95c5a',
      name: 'Goblin Bully',
      layout: 'normal',
      type_line: 'Creature — Goblin',
      mana_cost: '{1}{R}',
      oracle_text: '',
      keywords: [],
      power: '2',
      toughness: '1',
      cmc: 2,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '9ae547df-d280-41fb-81b4-24e52d60c25b',
      name: 'Chameleon Spirit',
      layout: 'normal',
      type_line: 'Creature — Illusion Spirit',
      mana_cost: '{3}{U}',
      oracle_text:
        "As this creature enters, choose a color.\nChameleon Spirit's power and toughness are each equal to the number of permanents of the chosen color your opponents control.",
      keywords: [],
      power: '*',
      toughness: '*',
      cmc: 4,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '1d95b5c0-d193-4a03-9954-23861ac1c762',
      name: 'Ghost-Spider, Gwen Stacy',
      layout: 'normal',
      type_line: 'Legendary Creature — Spider Human Hero',
      mana_cost: '{3}{R}{R}',
      oracle_text:
        "Menace (This creature can't be blocked except by two or more creatures.)\nWhenever Ghost-Spider attacks, she deals X damage to defending player, where X is the number of attacking creatures.",
      keywords: ['Menace'],
      power: '4',
      toughness: '4',
      cmc: 5,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: ['attack'],
    },
  },
  {
    card: {
      oracle_id: 'a59a23f2-158f-4dea-8593-75fe7b31b726',
      name: 'Cursecatcher',
      layout: 'normal',
      type_line: 'Creature — Merfolk Wizard',
      mana_cost: '{U}',
      oracle_text:
        'Sacrifice this creature: Counter target instant or sorcery spell unless its controller pays {1}.',
      keywords: [],
      power: '1',
      toughness: '1',
      cmc: 1,
    },
    tags: ['counterspell'],
    expect: {
      roles: {
        counterspell: 'P activated once',
      },
      interaction: ['counter instant-sorcery-spell single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '3bc757c1-3adb-4321-8832-8e1cc9e687f7',
      name: 'Lurrus of the Dream-Den',
      layout: 'normal',
      type_line: 'Legendary Creature — Cat Nightmare',
      mana_cost: '{1}{W/B}{W/B}',
      oracle_text:
        'Companion — Each permanent card in your starting deck has mana value 2 or less. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} as a sorcery.)\nLifelink\nOnce during each of your turns, you may cast a permanent spell with mana value 2 or less from your graveyard.',
      keywords: ['Lifelink', 'Companion'],
      power: '3',
      toughness: '2',
      cmc: 3,
    },
    tags: ['lifegain'],
    expect: {
      roles: {
        recursion: 'P static static',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'a0665c10-e652-4608-920b-66206c0e5905',
      name: 'Temur Charger',
      layout: 'normal',
      type_line: 'Creature — Horse',
      mana_cost: '{1}{G}',
      oracle_text:
        'Morph—Reveal a green card in your hand. (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)\nWhen this creature is turned face up, target creature gains trample until end of turn.',
      keywords: ['Morph'],
      power: '3',
      toughness: '1',
      cmc: 2,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'eec7d4f4-4141-49ed-8978-aefacc0a6609',
      name: 'Raven of Fell Omens',
      layout: 'normal',
      type_line: 'Creature — Bird',
      mana_cost: '{1}{B}',
      oracle_text:
        'Flying\nWhenever you commit a crime, each opponent loses 1 life and you gain 1 life. This ability triggers only once each turn. (Targeting opponents, anything they control, and/or cards in their graveyards is a crime.)',
      keywords: ['Flying'],
      power: '1',
      toughness: '2',
      cmc: 2,
    },
    tags: ['lifegain'],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '97671aac-7322-44ae-8908-d573734db3af',
      name: 'Cliffside Lookout',
      layout: 'normal',
      type_line: 'Creature — Kor Scout Ally',
      mana_cost: '{W}',
      oracle_text: '{4}{W}: Creatures you control get +1/+1 until end of turn.',
      keywords: [],
      power: '1',
      toughness: '1',
      cmc: 1,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '6f6ac768-4c97-44db-933a-f2d442e7f665',
      name: 'Frostling',
      layout: 'normal',
      type_line: 'Creature — Spirit',
      mana_cost: '{R}',
      oracle_text: 'Sacrifice this creature: It deals 1 damage to target creature.',
      keywords: [],
      power: '1',
      toughness: '1',
      cmc: 1,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P activated once',
      },
      interaction: ['damage creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '376c6257-4a1a-42d4-8931-72068f38727f',
      name: 'Puppet Master, String Puller',
      layout: 'normal',
      type_line: 'Legendary Creature — Human Artificer Villain',
      mana_cost: '{2}{R}',
      oracle_text:
        "Whenever you attack, goad target creature an opponent controls. It can't block this turn. (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)\nWhenever one or more goaded creatures deal combat damage to one of your opponents, create a Treasure token.",
      keywords: ['Goad', 'Treasure'],
      power: '2',
      toughness: '4',
      cmc: 3,
    },
    tags: ['ramp'],
    expect: {
      roles: {
        ramp: 'S triggered per-event',
      },
      interaction: [],
      produces: ['treasure'],
      payoffs: ['attack'],
    },
  },
  {
    card: {
      oracle_id: '4e9b878b-80a2-433b-941b-92d854e83d58',
      name: 'Weatherseed Treefolk',
      layout: 'normal',
      type_line: 'Creature — Treefolk',
      mana_cost: '{2}{G}{G}{G}',
      oracle_text: "Trample\nWhen this creature dies, return it to its owner's hand.",
      keywords: ['Trample'],
      power: '5',
      toughness: '3',
      cmc: 5,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'de1cfa83-2049-48ab-b093-2f120a3ef4f2',
      name: 'Loyal Guardian',
      layout: 'normal',
      type_line: 'Creature — Rhino',
      mana_cost: '{4}{G}',
      oracle_text:
        'Trample\nLieutenant — At the beginning of combat on your turn, if you control your commander, put a +1/+1 counter on each creature you control.',
      keywords: ['Trample', 'Lieutenant'],
      power: '4',
      toughness: '4',
      cmc: 5,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'dcd4da46-5438-4454-8b1b-43ca51bda1f9',
      name: 'Murmuring Mystic',
      layout: 'normal',
      type_line: 'Creature — Human Wizard',
      mana_cost: '{3}{U}',
      oracle_text:
        'Whenever you cast an instant or sorcery spell, create a 1/1 blue Bird Illusion creature token with flying.',
      keywords: [],
      power: '1',
      toughness: '5',
      cmc: 4,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'd6273621-c36c-491b-85ca-37445ed30097',
      name: 'Illvoi Galeblade',
      layout: 'normal',
      type_line: 'Creature — Jellyfish Warrior',
      mana_cost: '{U}',
      oracle_text: 'Flash\nFlying\n{2}, Sacrifice this creature: Draw a card.',
      keywords: ['Flying', 'Flash'],
      power: '1',
      toughness: '1',
      cmc: 1,
    },
    tags: ['card-advantage', 'draw'],
    expect: {
      roles: {
        cardDraw: 'I activated once',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'cd539212-ef7b-4f78-8d62-c42289aedc51',
      name: 'Harvest Wurm',
      layout: 'normal',
      type_line: 'Creature — Wurm',
      mana_cost: '{1}{G}',
      oracle_text:
        'When this creature enters, sacrifice it unless you return a basic land card from your graveyard to your hand.',
      keywords: [],
      power: '3',
      toughness: '2',
      cmc: 2,
    },
    tags: ['card-advantage'],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'a73d9109-36e0-40ea-ab06-5c5f7eb4ac54',
      name: "Bilbo, Luckwearer // Burglar's Plot",
      layout: 'adventure',
      type_line: 'Legendary Creature — Halfling Rogue // Sorcery — Adventure',
      mana_cost: '{1}{U} // {4}{U}',
      keywords: [],
      power: '1',
      toughness: '1',
      cmc: 2,
      card_faces: [
        {
          name: 'Bilbo, Luckwearer',
          type_line: 'Legendary Creature — Halfling Rogue',
          mana_cost: '{1}{U}',
          oracle_text:
            "Bilbo can't be blocked.\nWhenever Bilbo deals combat damage to a player, draw a card, then discard a card.",
          power: '1',
          toughness: '1',
        },
        {
          name: "Burglar's Plot",
          type_line: 'Sorcery — Adventure',
          mana_cost: '{4}{U}',
          oracle_text:
            'Exchange control of two target nonland permanents that share a card type. (Then exile this card. You may cast the creature later from exile.)',
        },
      ],
    },
    tags: ['card-advantage', 'draw'],
    expect: {
      roles: {
        cardDraw: 'S triggered per-event f0',
        removal: 'S sorcery once f1',
      },
      interaction: ['steal nonland-permanent single any f1'],
      produces: ['cards'],
      payoffs: ['attack'],
    },
  },
  {
    card: {
      oracle_id: '2e735849-1930-4f43-86b4-da660ade15bc',
      name: 'Fire Nation Archers',
      layout: 'normal',
      type_line: 'Creature — Human Archer',
      mana_cost: '{3}{R}',
      oracle_text:
        'Reach (This creature can block creatures with flying.)\n{5}: This creature deals 2 damage to each opponent. Create a 2/2 red Soldier creature token.',
      keywords: ['Reach'],
      power: '3',
      toughness: '4',
      cmc: 4,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'd696aba9-ef3e-4f81-821a-c1df51431b8a',
      name: 'Cunning Lethemancer',
      layout: 'normal',
      type_line: 'Creature — Human Wizard',
      mana_cost: '{2}{B}',
      oracle_text: 'At the beginning of your upkeep, each player discards a card.',
      keywords: [],
      power: '2',
      toughness: '2',
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '8973bd99-20f8-4867-90ef-50392147ee1b',
      name: 'Wood Elves',
      layout: 'normal',
      type_line: 'Creature — Elf Scout',
      mana_cost: '{2}{G}',
      oracle_text:
        'When this creature enters, search your library for a Forest card, put that card onto the battlefield, then shuffle.',
      keywords: [],
      power: '1',
      toughness: '1',
      cmc: 3,
    },
    tags: ['ramp', 'tutor', 'land-tutor'],
    expect: {
      roles: {
        ramp: 'P sorcery once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '017f4471-db5a-4ad0-97b3-b1f12b52578a',
      name: 'Zulaport Chainmage',
      layout: 'normal',
      type_line: 'Creature — Human Shaman Ally',
      mana_cost: '{3}{B}',
      oracle_text: 'Cohort — {T}, Tap an untapped Ally you control: Target opponent loses 2 life.',
      keywords: ['Cohort'],
      power: '4',
      toughness: '2',
      cmc: 4,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '3508fd7d-ca02-47f9-8b0a-525f7bde4f57',
      name: 'Hulk, Gamma Goliath',
      layout: 'normal',
      type_line: 'Legendary Creature — Gamma Berserker Hero',
      mana_cost: '{3}{R}{G}',
      oracle_text:
        'Reach, trample\nPower-up abilities of other creatures you control cost {3} less to activate.\nPower-up — {6}{R}{G}: Put five +1/+1 counters on Hulk. (Activate each power-up ability only once. Reduce the cost by his mana cost if he entered this turn.)',
      keywords: ['Power-up', 'Reach', 'Trample'],
      power: '6',
      toughness: '5',
      cmc: 5,
    },
    tags: ['cost-reducer'],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'df9409e6-bd6d-4b5b-b807-fcf347ee940a',
      name: "Glarb, Calamity's Augur",
      layout: 'normal',
      type_line: 'Legendary Creature — Frog Wizard Noble',
      mana_cost: '{B}{G}{U}',
      oracle_text:
        'Deathtouch\nYou may look at the top card of your library any time.\nYou may play lands and cast spells with mana value 4 or greater from the top of your library.\n{T}: Surveil 2.',
      keywords: ['Surveil', 'Deathtouch'],
      power: '2',
      toughness: '4',
      cmc: 3,
    },
    tags: ['card-advantage'],
    expect: {
      roles: {
        cardDraw: 'P static static',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '197f3b17-ce21-430e-8e41-f5d02d5e3637',
      name: 'Wasteland Strangler',
      layout: 'normal',
      type_line: 'Creature — Eldrazi Processor',
      mana_cost: '{2}{B}',
      oracle_text:
        "Devoid (This card has no color.)\nWhen this creature enters, you may put a card an opponent owns from exile into that player's graveyard. If you do, target creature gets -3/-3 until end of turn.",
      keywords: ['Devoid'],
      power: '3',
      toughness: '2',
      cmc: 3,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['shrink creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'd4dd6edf-1e9e-46fa-92b5-5df9aa0e4338',
      name: 'Frodo Baggins',
      layout: 'normal',
      type_line: 'Legendary Creature — Halfling Scout',
      mana_cost: '{G}{W}',
      oracle_text:
        'Whenever Frodo Baggins or another legendary creature you control enters, the Ring tempts you.\nAs long as Frodo Baggins is your Ring-bearer, it must be blocked if able.',
      keywords: [],
      power: '1',
      toughness: '3',
      cmc: 2,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'b8ca5877-ac9e-4b15-8c23-c70f61b01895',
      name: 'Dryad Militant',
      layout: 'normal',
      type_line: 'Creature — Dryad Soldier',
      mana_cost: '{G/W}',
      oracle_text:
        '({G/W} can be paid with either {G} or {W}.)\nIf an instant or sorcery card would be put into a graveyard from anywhere, exile it instead.',
      keywords: [],
      power: '2',
      toughness: '1',
      cmc: 1,
    },
    tags: ['graveyard-hate'],
    expect: {
      roles: {
        graveyardHate: 'P static static',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'a7a6cdfd-10ac-49d0-a0a6-8ad37e326511',
      name: 'Hired Poisoner',
      layout: 'normal',
      type_line: 'Creature — Human Assassin',
      mana_cost: '{B}',
      oracle_text: 'Deathtouch',
      keywords: ['Deathtouch'],
      power: '1',
      toughness: '1',
      cmc: 1,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '2e677ded-7af3-4af0-81df-b70d6ee616ec',
      name: 'Daily Bugle Reporters',
      layout: 'normal',
      type_line: 'Creature — Human Citizen',
      mana_cost: '{3}{W}',
      oracle_text:
        'When this creature enters, choose one —\n• Puff Piece — Put a +1/+1 counter on each of up to two target creatures.\n• Investigative Journalism — Return target creature card with mana value 2 or less from your graveyard to your hand.',
      keywords: ['Puff Piece', 'Investigative Journalism'],
      power: '2',
      toughness: '3',
      cmc: 4,
    },
    tags: ['card-advantage'],
    expect: {
      roles: {
        recursion: 'S sorcery once',
      },
      interaction: [],
      produces: ['gy-to-hand'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '1e53032e-fe14-4424-86ee-f69336f049fe',
      name: 'Douser of Lights',
      layout: 'normal',
      type_line: 'Creature — Horror',
      mana_cost: '{4}{B}',
      oracle_text: '',
      keywords: [],
      power: '4',
      toughness: '5',
      cmc: 5,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '543071da-fc89-4274-a2ae-d5d755d1f2a9',
      name: 'Crossway Vampire',
      layout: 'normal',
      type_line: 'Creature — Vampire',
      mana_cost: '{1}{R}{R}',
      oracle_text: "When this creature enters, target creature can't block this turn.",
      keywords: [],
      power: '3',
      toughness: '2',
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '8e94ccdb-5978-440b-b7cd-11c7ca6b2c98',
      name: 'You Cannot Pass!',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{W}',
      oracle_text:
        'Destroy target creature that blocked or was blocked by a legendary creature this turn.',
      keywords: [],
      cmc: 1,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['destroy creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '3a225d39-c1f8-4ab0-98ec-dad63bf268db',
      name: 'Repopulate',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{G}',
      oracle_text:
        "Shuffle all creature cards from target player's graveyard into that player's library.\nCycling {2} ({2}, Discard this card: Draw a card.)",
      keywords: ['Cycling'],
      cmc: 2,
    },
    tags: ['card-advantage', 'draw', 'graveyard-hate'],
    expect: {
      roles: {
        graveyardHate: 'P instant once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '6db5f1a7-4cd8-42e2-a5d8-1603206ad0cc',
      name: "Dovin's Dismissal",
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{2}{W}{U}',
      oracle_text:
        "Put up to one target tapped creature on top of its owner's library. You may search your library and/or graveyard for a card named Dovin, Architect of Law, reveal it, and put it into your hand. If you search your library this way, shuffle.",
      keywords: [],
      cmc: 4,
    },
    tags: ['removal', 'spot-removal', 'card-advantage', 'tutor'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['tuck creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '285046f6-b3c4-4eb7-8712-9dffebabc762',
      name: "Waterbender's Restoration",
      layout: 'normal',
      type_line: 'Instant — Lesson',
      mana_cost: '{U}{U}',
      oracle_text:
        "As an additional cost to cast this spell, waterbend {X}. (While paying a waterbend cost, you can tap your artifacts and creatures to help. Each one pays for {1}.)\nExile X target creatures you control. Return those cards to the battlefield under their owner's control at the beginning of the next end step.",
      keywords: ['Waterbend'],
      cmc: 2,
    },
    tags: ['protection'],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '863d6607-912b-4186-9874-87d5473ec481',
      name: 'Seed of Hope',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{G}',
      oracle_text:
        'Mill two cards. You may put a permanent card from among the milled cards into your hand. You gain 2 life. (To mill two cards, put the top two cards of your library into your graveyard.)',
      keywords: ['Mill'],
      cmc: 1,
    },
    tags: ['card-advantage', 'lifegain'],
    expect: {
      roles: {
        cardDraw: 'S instant once',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'bdf80a55-b524-4d17-9be8-a0005403a0e7',
      name: 'Cunning Wish',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{2}{U}',
      oracle_text:
        'You may reveal an instant card you own from outside the game and put it into your hand. Exile Cunning Wish.',
      keywords: [],
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'e42ca67d-c9c3-499a-a7b7-63dc2dafdeab',
      name: 'Neutralizing Blast',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{U}',
      oracle_text: 'Counter target multicolored spell.',
      keywords: [],
      cmc: 2,
    },
    tags: ['counterspell'],
    expect: {
      roles: {
        counterspell: 'P instant once',
      },
      interaction: ['counter spell single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '61e09dd9-7870-48c2-9177-d6abc3162692',
      name: 'Titanic Growth',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{G}',
      oracle_text: 'Target creature gets +4/+4 until end of turn.',
      keywords: [],
      cmc: 2,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'ffcedb73-538a-45ea-8564-7b92624537e0',
      name: 'Skyshroud Blessing',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{G}',
      oracle_text:
        "All lands gain shroud until end of turn. (They can't be the targets of spells or abilities.)\nDraw a card.",
      keywords: [],
      cmc: 2,
    },
    tags: ['card-advantage', 'draw', 'cantrip', 'protection'],
    expect: {
      roles: {
        cardDraw: 'I instant once',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '7e24b4da-9728-43a0-8af4-f513a3e1104b',
      name: 'Charge Through',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{G}',
      oracle_text: 'Target creature gains trample until end of turn.\nDraw a card.',
      keywords: [],
      cmc: 1,
    },
    tags: ['card-advantage', 'draw', 'cantrip'],
    expect: {
      roles: {
        cardDraw: 'I instant once',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '686b44ec-3446-4e1f-a15f-9d8557db6d70',
      name: 'Center Soul',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{W}',
      oracle_text:
        'Target creature you control gains protection from the color of your choice until end of turn.\nRebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)',
      keywords: ['Rebound'],
      cmc: 2,
    },
    tags: ['protection'],
    expect: {
      roles: {
        protection: 'P instant once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'ebcd198e-7fbd-46e0-a6d9-ff499e541978',
      name: 'Reckless Ransacking',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{R}',
      oracle_text:
        'Target creature gets +3/+2 until end of turn. Create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
      keywords: ['Treasure'],
      cmc: 2,
    },
    tags: ['ramp'],
    expect: {
      roles: {
        ramp: 'I instant once',
      },
      interaction: [],
      produces: ['treasure'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '464c0150-3dbc-403b-9ada-fef25ab1f29d',
      name: 'Brain Freeze',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{U}',
      oracle_text:
        'Target player mills three cards.\nStorm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)',
      keywords: ['Storm', 'Mill'],
      cmc: 2,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '074e467e-f574-4b44-b5a3-798b592a5a87',
      name: 'Rain of Rust',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{3}{R}{R}',
      oracle_text:
        'Choose one —\n• Destroy target artifact.\n• Destroy target land.\nEntwine {3}{R} (Choose both if you pay the entwine cost.)',
      keywords: ['Entwine'],
      cmc: 5,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['destroy artifact single any', 'destroy land single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'ef47c447-bd7f-43c6-b4db-4a848c39820c',
      name: 'Visions of Glory',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{4}{W}',
      oracle_text:
        'Create a 1/1 white Human creature token for each creature you control.\nFlashback {8}{W}{W}. This spell costs {X} less to cast this way, where X is the greatest mana value of a commander you own on the battlefield or in the command zone. (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
      keywords: ['Flashback'],
      cmc: 5,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '56956afd-db53-4542-816b-490c8b0bbcf7',
      name: 'Serum Visions',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{U}',
      oracle_text: 'Draw a card. Scry 2.',
      keywords: ['Scry'],
      cmc: 1,
    },
    tags: ['card-advantage', 'draw', 'cantrip'],
    expect: {
      roles: {
        cardDraw: 'S sorcery once',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '4e769107-0f32-4181-9e57-ffebc2228d3a',
      name: 'Rise from the Grave',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{4}{B}',
      oracle_text:
        'Put target creature card from a graveyard onto the battlefield under your control. That creature is a black Zombie in addition to its other colors and types.',
      keywords: [],
      cmc: 5,
    },
    tags: [],
    expect: {
      roles: {
        recursion: 'P sorcery once',
      },
      interaction: [],
      produces: ['gy-to-battlefield'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '8923462f-0540-41e8-931e-97b5f1dadd51',
      name: 'Form a Posse',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{X}{R}{W}',
      oracle_text:
        'Create X 1/1 red Mercenary creature tokens with "{T}: Target creature you control gets +1/+0 until end of turn. Activate only as a sorcery."',
      keywords: [],
      cmc: 2,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'c9634afc-4a5b-4cf6-b63d-0ff9909dd5a7',
      name: 'Desolation of Smaug',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{R}{R}',
      oracle_text:
        'Desolation of Smaug deals 3 damage to each non-Dragon creature.\nAdd four mana in any combination of colors. Spend this mana only to cast Dragon spells.',
      keywords: [],
      cmc: 4,
    },
    tags: ['ramp', 'removal', 'boardwipe'],
    expect: {
      roles: {
        boardwipe: 'P sorcery once',
        ramp: 'I sorcery once',
      },
      interaction: ['damage creature mass all'],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'd5b021e3-a0c1-471b-9088-a76816806354',
      name: 'Spontaneous Generation',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{3}{G}',
      oracle_text: 'Create a 1/1 green Saproling creature token for each card in your hand.',
      keywords: [],
      cmc: 4,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '2097ac9e-0f9b-4cd0-8537-2518195e4549',
      name: 'Reality Strobe',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{4}{U}{U}',
      oracle_text:
        "Return target permanent to its owner's hand. Exile Reality Strobe with three time counters on it.\nSuspend 3—{2}{U} (Rather than cast this card from your hand, you may pay {2}{U} and exile it with three time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it without paying its mana cost.)",
      keywords: ['Suspend'],
      cmc: 6,
    },
    tags: ['removal', 'spot-removal', 'bounce'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['bounce permanent single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'fa04f161-4141-491b-ad6f-a16f69c862f3',
      name: 'Dark Inquiry',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{B}',
      oracle_text:
        'Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.',
      keywords: [],
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '274c5367-f02e-44a0-be8a-5ed03c831bda',
      name: 'Jovial Evil',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{B}',
      oracle_text:
        'Jovial Evil deals X damage to target opponent, where X is twice the number of white creatures that player controls.',
      keywords: [],
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '92f8c8b1-1fd5-4e80-b8a9-51671937aaf2',
      name: 'Devout Decree',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{1}{W}',
      oracle_text:
        "Exile target creature or planeswalker that's black or red. Scry 1. (Look at the top card of your library. You may put that card on the bottom.)",
      keywords: ['Scry'],
      cmc: 2,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['exile creature|planeswalker single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '61f2083b-3018-43a4-8852-8e6d2a97d5d6',
      name: 'Retribution of the Meek',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{W}',
      oracle_text: "Destroy all creatures with power 4 or greater. They can't be regenerated.",
      keywords: [],
      cmc: 3,
    },
    tags: ['removal', 'boardwipe'],
    expect: {
      roles: {
        boardwipe: 'P sorcery once',
      },
      interaction: ['destroy creature mass all'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '2c132e6f-2e9e-4b39-81a8-f88c32173cd5',
      name: 'Recross the Paths',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{G}',
      oracle_text:
        "Reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield and the rest on the bottom of your library in any order. Clash with an opponent. If you win, return Recross the Paths to its owner's hand. (Each clashing player reveals the top card of their library, then puts that card on their choice of the top or bottom. A player wins if their card had a greater mana value.)",
      keywords: ['Clash'],
      cmc: 3,
    },
    tags: ['ramp', 'card-advantage'],
    expect: {
      roles: {
        ramp: 'P sorcery once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '7f77de5d-1088-42d0-8f68-5633aeab0d74',
      name: 'Flowstone Flood',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{3}{R}',
      oracle_text:
        'Buyback—Pay 3 life, Discard a card at random. (You may pay 3 life and discard a card at random in addition to any other costs as you cast this spell. If you do, put this card into your hand as it resolves.)\nDestroy target land.',
      keywords: ['Buyback'],
      cmc: 4,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'I sorcery once',
      },
      interaction: ['destroy land single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'a5ce2ccd-8c78-4749-8854-cb5fa5f4738e',
      name: 'Allied Strategies',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{4}{U}',
      oracle_text:
        'Domain — Target player draws a card for each basic land type among lands they control.',
      keywords: ['Domain'],
      cmc: 5,
    },
    tags: ['card-advantage', 'draw'],
    expect: {
      roles: {
        cardDraw: 'P sorcery once',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '89fb21dc-4cf2-4c9a-b0ae-cc6e10277fb6',
      name: 'Fire-Rim Form',
      layout: 'normal',
      type_line: 'Enchantment — Aura',
      mana_cost: '{1}{R}',
      oracle_text:
        'Flash\nEnchant creature\nWhen this Aura enters, enchanted creature gains first strike until end of turn.\nEnchanted creature gets +2/+0.',
      keywords: ['Enchant', 'Flash'],
      cmc: 2,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '31c30c4f-12f4-4cbc-b7c1-123f36b8df75',
      name: "Runner's Bane",
      layout: 'normal',
      type_line: 'Enchantment — Aura',
      mana_cost: '{1}{U}',
      oracle_text:
        "Enchant creature with power 3 or less\nWhen this Aura enters, tap enchanted creature.\nEnchanted creature doesn't untap during its controller's untap step.",
      keywords: ['Enchant'],
      cmc: 2,
    },
    tags: ['removal'],
    expect: {
      roles: {
        removal: 'P static static',
      },
      interaction: ['neutralize creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'c8decfdf-1421-4649-acde-5215e7f08bb9',
      name: 'Martial Impetus',
      layout: 'normal',
      type_line: 'Enchantment — Aura',
      mana_cost: '{2}{W}',
      oracle_text:
        "Enchant creature\nEnchanted creature gets +1/+1 and is goaded. (It attacks each combat if able and attacks a player other than you if able.)\nWhenever enchanted creature attacks, each other creature that's attacking one of your opponents gets +1/+1 until end of turn.",
      keywords: ['Goad', 'Enchant'],
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '2ee9d018-02c7-43e7-ba2e-95e36d8ac0e8',
      name: 'Shadow of the Second Sun',
      layout: 'normal',
      type_line: 'Enchantment — Aura',
      mana_cost: '{4}{U}{U}',
      oracle_text:
        "Enchant player\nAt the beginning of each of enchanted player's postcombat main phases, there is an additional beginning phase after this phase. (The end step happens after the added untap, upkeep, and draw steps.)",
      keywords: ['Enchant'],
      cmc: 6,
    },
    tags: ['card-advantage', 'draw'],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '163f1fce-70c8-44e3-a679-f97d52cd1e9a',
      name: 'Spider-Man No More',
      layout: 'normal',
      type_line: 'Enchantment — Aura',
      mana_cost: '{1}{U}',
      oracle_text:
        'Enchant creature\nEnchanted creature is a Citizen with base power and toughness 1/1. It has defender and loses all other abilities. (It also loses all other creature types.)',
      keywords: ['Enchant'],
      cmc: 2,
    },
    tags: ['removal'],
    expect: {
      roles: {
        removal: 'P static static',
      },
      interaction: ['neutralize creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '8c55039d-1303-420c-8547-ebdffb63bf89',
      name: "Liliana's Talent",
      layout: 'normal',
      type_line: 'Enchantment — Aura',
      mana_cost: '{B}{B}',
      oracle_text:
        'Enchant planeswalker\nEnchanted planeswalker has "[−8]: Put all creature cards from all graveyards onto the battlefield under your control."\nWhenever a creature deals damage to enchanted planeswalker, destroy that creature.',
      keywords: ['Enchant'],
      cmc: 2,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'S triggered per-event',
        recursion: 'I static static',
      },
      interaction: ['destroy creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'dc0593c2-ccb4-4648-a592-c5bcd121dc72',
      name: 'Greater Good',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{2}{G}{G}',
      oracle_text:
        "Sacrifice a creature: Draw cards equal to the sacrificed creature's power, then discard three cards.",
      keywords: [],
      cmc: 4,
    },
    tags: ['card-advantage', 'draw', 'sacrifice'],
    expect: {
      roles: {
        cardDraw: 'P activated repeatable',
      },
      interaction: [],
      produces: ['cards', 'creature-death'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '7d84e667-2f14-437c-be4f-161b98d59341',
      name: "Vassal's Duty",
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{3}{W}',
      oracle_text:
        '{1}: The next 1 damage that would be dealt to target legendary creature you control this turn is dealt to you instead.',
      keywords: [],
      cmc: 4,
    },
    tags: ['protection'],
    expect: {
      roles: {
        protection: 'S activated repeatable',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '7f5f10ee-6428-4053-8824-3bc70420ec2c',
      name: "Estrid's Invocation",
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{2}{U}',
      oracle_text:
        'You may have this enchantment enter as a copy of an enchantment you control, except it has "At the beginning of your upkeep, you may exile this enchantment. If you do, return it to the battlefield under its owner\'s control."',
      keywords: [],
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: ['copy'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '13cf3ef7-d88e-4cc7-a4d8-cedc671f356a',
      name: "Ashiok's Erasure",
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{2}{U}{U}',
      oracle_text:
        "Flash\nWhen this enchantment enters, exile target spell.\nYour opponents can't cast spells with the same name as the exiled card.\nWhen this enchantment leaves the battlefield, return the exiled card to its owner's hand.",
      keywords: ['Flash'],
      cmc: 4,
    },
    tags: ['removal', 'counterspell'],
    expect: {
      roles: {
        counterspell: 'P flash once',
      },
      interaction: ['counter spell single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'c6639b52-b51d-46e7-a83c-c4621b1cecaa',
      name: 'Ever-Watching Threshold',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{2}{U}',
      oracle_text:
        'Whenever an opponent attacks, if they attacked you and/or a planeswalker you control, draw a card.',
      keywords: [],
      cmc: 3,
    },
    tags: ['card-advantage', 'draw'],
    expect: {
      roles: {
        cardDraw: 'P triggered per-event',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '9b3ddd31-c058-4846-8784-25c7a9bbcb31',
      name: 'Kellan Joins Up',
      layout: 'normal',
      type_line: 'Legendary Enchantment',
      mana_cost: '{G}{W}{U}',
      oracle_text:
        'When Kellan Joins Up enters, you may exile a nonland card with mana value 3 or less from your hand. If you do, it becomes plotted. (You may cast it as a sorcery on a later turn without paying its mana cost.)\nWhenever a legendary creature you control enters, put a +1/+1 counter on each creature you control.',
      keywords: ['Plot'],
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'c961373a-be0e-467c-92e0-33a0c953736a',
      name: 'Scroll of Griselbrand',
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{1}',
      oracle_text:
        '{1}, Sacrifice this artifact: Target opponent discards a card. If you control a Demon, that player loses 3 life.',
      keywords: [],
      cmc: 1,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '5ba73182-30a7-4bad-9cb6-c0feecc2db33',
      name: 'Meekstone',
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{1}',
      oracle_text:
        "Creatures with power 3 or greater don't untap during their controllers' untap steps.",
      keywords: [],
      cmc: 1,
    },
    tags: ['removal'],
    expect: {
      roles: {},
      interaction: ['neutralize creature mass all'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '55a4b186-c6d4-4b08-bf45-481429693948',
      name: 'Strandwalker',
      layout: 'normal',
      type_line: 'Artifact — Equipment',
      mana_cost: '{5}',
      oracle_text:
        'Living weapon (When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.)\nEquipped creature gets +2/+4 and has reach.\nEquip {4}',
      keywords: ['Equip', 'Living weapon'],
      cmc: 5,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '570de99a-7c65-4052-bc4b-cfb8caef40b3',
      name: 'Robe of the Archmagi',
      layout: 'normal',
      type_line: 'Artifact — Equipment',
      mana_cost: '{2}{U}',
      oracle_text:
        'Whenever equipped creature deals combat damage to a player, you draw that many cards.\nEquip {4}\nEquip Shaman, Warlock, or Wizard {1}',
      keywords: ['Equip'],
      cmc: 3,
    },
    tags: ['card-advantage', 'draw'],
    expect: {
      roles: {
        cardDraw: 'P triggered per-event',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: ['attack'],
    },
  },
  {
    card: {
      oracle_id: '7cea5b12-9483-4142-9efa-735305581e73',
      name: 'Caduceus, Staff of Hermes',
      layout: 'normal',
      type_line: 'Legendary Artifact — Equipment',
      mana_cost: '{2}{W}',
      oracle_text:
        'Equipped creature has lifelink.\nAs long as you have 30 or more life, equipped creature gets +5/+5 and has indestructible and "Prevent all damage that would be dealt to this creature."\nEquip {W}{W}',
      keywords: ['Equip'],
      cmc: 3,
    },
    tags: ['lifegain', 'protection'],
    expect: {
      roles: {
        protection: 'S static static',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '93e336e3-2be7-4581-8ab3-9bea422d81c3',
      name: 'Cargo Ship',
      layout: 'normal',
      type_line: 'Artifact — Vehicle',
      mana_cost: '{1}{U}',
      oracle_text:
        'Flying, vigilance\n{T}: Add {C}. Spend this mana only to cast an artifact spell or activate an ability of an artifact source.\nCrew 1 (Tap any number of creatures you control with total power 1 or more: This Vehicle becomes an artifact creature until end of turn.)',
      keywords: ['Flying', 'Vigilance', 'Crew'],
      power: '2',
      toughness: '3',
      cmc: 2,
    },
    tags: ['ramp', 'mana-rock'],
    expect: {
      roles: {
        ramp: 'P activated per-turn',
      },
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '2a956224-8bdb-40d8-8405-2aa29eb228e0',
      name: 'Golem-Skin Gauntlets',
      layout: 'normal',
      type_line: 'Artifact — Equipment',
      mana_cost: '{1}',
      oracle_text:
        'Equipped creature gets +1/+0 for each Equipment attached to it.\nEquip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)',
      keywords: ['Equip'],
      cmc: 1,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'c73c1d91-0163-49c6-832a-b9327e7a2c9b',
      name: 'Mindcrank',
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{2}',
      oracle_text:
        'Whenever an opponent loses life, that player mills that many cards. (Damage causes loss of life.)',
      keywords: ['Mill'],
      cmc: 2,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'd19a19ed-33f9-400d-9669-c393d7127652',
      name: 'Onyx Talisman',
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{2}',
      oracle_text:
        'Whenever a player casts a black spell, you may pay {3}. If you do, untap target permanent.',
      keywords: [],
      cmc: 2,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: ['untap'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '3986b284-f943-4570-ba26-3419910feeef',
      name: 'Rakdos Keyrune',
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{3}',
      oracle_text:
        '{T}: Add {B} or {R}.\n{B}{R}: This artifact becomes a 3/1 black and red Devil artifact creature with first strike until end of turn.',
      keywords: [],
      cmc: 3,
    },
    tags: ['ramp', 'mana-rock'],
    expect: {
      roles: {
        ramp: 'P activated per-turn',
      },
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '7f113875-a411-463b-8b4d-91d1dee95c2a',
      name: 'Scrap Compactor',
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{1}',
      oracle_text:
        '{3}, {T}, Sacrifice this artifact: It deals 3 damage to target creature.\n{6}, {T}, Sacrifice this artifact: Destroy target creature or Vehicle.',
      keywords: [],
      cmc: 1,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P activated once',
      },
      interaction: ['damage creature single any', 'destroy creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '4c774c6e-c5a0-4018-b494-d3c521d2cac3',
      name: 'Heart of Ramos',
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{3}',
      oracle_text: '{T}: Add {R}.\nSacrifice this artifact: Add {R}.',
      keywords: [],
      cmc: 3,
    },
    tags: ['ramp', 'mana-rock'],
    expect: {
      roles: {
        ramp: 'P activated per-turn',
      },
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'afc2269c-d3b5-487d-9445-800c7a8e526b',
      name: 'Domri, Anarch of Bolas',
      layout: 'normal',
      type_line: 'Legendary Planeswalker — Domri',
      mana_cost: '{1}{R}{G}',
      oracle_text:
        "Creatures you control get +1/+0.\n+1: Add {R} or {G}. Creature spells you cast this turn can't be countered.\n−2: Target creature you control fights target creature you don't control.",
      keywords: ['Fight'],
      loyalty: '3',
      cmc: 3,
    },
    tags: ['ramp', 'removal', 'spot-removal'],
    expect: {
      roles: {
        ramp: 'P sorcery per-turn',
        removal: 'S sorcery per-turn',
      },
      interaction: ['fight creature single opponents'],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'bc6f4f73-e10c-44ae-926d-9e5f6ddc14be',
      name: 'Invasion of Kaladesh // Aetherwing, Golden-Scale Flagship',
      layout: 'transform',
      type_line: 'Battle — Siege // Legendary Artifact — Vehicle',
      keywords: ['Flying', 'Transform', 'Crew'],
      cmc: 2,
      card_faces: [
        {
          name: 'Invasion of Kaladesh',
          type_line: 'Battle — Siege',
          mana_cost: '{U}{R}',
          oracle_text:
            "(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it's defeated, exile it, then cast it transformed.)\nWhen this Siege enters, create a 1/1 colorless Thopter artifact creature token with flying.",
        },
        {
          name: 'Aetherwing, Golden-Scale Flagship',
          type_line: 'Legendary Artifact — Vehicle',
          mana_cost: '',
          oracle_text:
            "Flying\nAetherwing's power is equal to the number of artifacts you control.\nCrew 1 (Tap any number of creatures you control with total power 1 or more: This Vehicle becomes an artifact creature until end of turn.)",
          power: '*',
          toughness: '4',
        },
      ],
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '761bb894-d3f9-4248-af76-1559c502e342',
      name: 'Teferi, Timebender',
      layout: 'normal',
      type_line: 'Legendary Planeswalker — Teferi',
      mana_cost: '{4}{W}{U}',
      oracle_text:
        '+2: Untap up to one target artifact or creature.\n−3: You gain 2 life and draw two cards.\n−9: Take an extra turn after this one.',
      keywords: [],
      loyalty: '5',
      cmc: 6,
    },
    tags: ['card-advantage', 'draw', 'lifegain', 'extra-turn'],
    expect: {
      roles: {
        cardDraw: 'P sorcery per-turn',
      },
      interaction: [],
      produces: ['cards', 'untap'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'a9855326-8958-4b03-b81b-1f9e4d1335b1',
      name: 'Invasion of Moag // Bloomwielder Dryads',
      layout: 'transform',
      type_line: 'Battle — Siege // Creature — Dryad',
      keywords: ['Transform', 'Ward'],
      cmc: 4,
      card_faces: [
        {
          name: 'Invasion of Moag',
          type_line: 'Battle — Siege',
          mana_cost: '{2}{G}{W}',
          oracle_text:
            "(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it's defeated, exile it, then cast it transformed.)\nWhen this Siege enters, put a +1/+1 counter on each creature you control.",
        },
        {
          name: 'Bloomwielder Dryads',
          type_line: 'Creature — Dryad',
          mana_cost: '',
          oracle_text:
            'Ward {2} (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays {2}.)\nAt the beginning of your end step, put a +1/+1 counter on target creature you control.',
          power: '3',
          toughness: '3',
        },
      ],
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '66914a34-59b3-48a0-9305-ebd956d34f02',
      name: 'Invasion of Kaldheim // Pyre of the World Tree',
      layout: 'transform',
      type_line: 'Battle — Siege // Enchantment',
      keywords: ['Transform'],
      cmc: 4,
      card_faces: [
        {
          name: 'Invasion of Kaldheim',
          type_line: 'Battle — Siege',
          mana_cost: '{3}{R}',
          oracle_text:
            "(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it's defeated, exile it, then cast it transformed.)\nWhen this Siege enters, exile all cards from your hand, then draw that many cards. Until the end of your next turn, you may play cards exiled this way.",
        },
        {
          name: 'Pyre of the World Tree',
          type_line: 'Enchantment',
          mana_cost: '',
          oracle_text:
            'Discard a land card: This enchantment deals 2 damage to any target.\nWhenever you discard a land card, exile the top card of your library. You may play that card this turn.',
        },
      ],
    },
    tags: ['removal', 'spot-removal', 'card-advantage', 'draw', 'wheel'],
    expect: {
      roles: {
        cardDraw: 'P sorcery once f0',
        removal: 'I activated repeatable f1',
      },
      interaction: ['damage battle|creature|planeswalker single any f1'],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '4b1874af-4ea5-4e22-a4d4-e718d75fe95e',
      name: 'Invasion of Zendikar // Awakened Skyclave',
      layout: 'transform',
      type_line: 'Battle — Siege // Creature — Elemental',
      keywords: ['Vigilance', 'Transform', 'Haste'],
      cmc: 4,
      card_faces: [
        {
          name: 'Invasion of Zendikar',
          type_line: 'Battle — Siege',
          mana_cost: '{3}{G}',
          oracle_text:
            "(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it's defeated, exile it, then cast it transformed.)\nWhen this Siege enters, search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.",
        },
        {
          name: 'Awakened Skyclave',
          type_line: 'Creature — Elemental',
          mana_cost: '',
          oracle_text:
            "Vigilance, haste\nAs long as this creature is on the battlefield, it's a land in addition to its other types.\n{T}: Add one mana of any color.",
          power: '4',
          toughness: '4',
        },
      ],
    },
    tags: ['ramp', 'mana-dork', 'tutor', 'land-tutor'],
    expect: {
      roles: {
        ramp: 'P sorcery once f0',
      },
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '33de01e9-ce5a-42d4-afcb-343cd54a6d80',
      name: 'Caves of Koilos',
      layout: 'normal',
      type_line: 'Land',
      mana_cost: '',
      oracle_text: '{T}: Add {C}.\n{T}: Add {W} or {B}. This land deals 1 damage to you.',
      keywords: [],
      cmc: 0,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'c6eb2814-0021-4308-ad44-6c8cc59b0d1c',
      name: 'Drifting Meadow',
      layout: 'normal',
      type_line: 'Land',
      mana_cost: '',
      oracle_text:
        'This land enters tapped.\n{T}: Add {W}.\nCycling {2} ({2}, Discard this card: Draw a card.)',
      keywords: ['Cycling'],
      cmc: 0,
    },
    tags: ['card-advantage', 'draw', 'utility-land', 'tapland'],
    expect: {
      roles: {},
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '6d6a25fb-0432-4c7d-b0e6-e787ddc71218',
      name: 'Cryptic Spires',
      layout: 'normal',
      type_line: 'Land',
      mana_cost: '',
      oracle_text:
        'As you create your deck, circle two of the colors below.\nThis land enters tapped.\n{T}: Add one mana of either of the circled colors.',
      keywords: [],
      cmc: 0,
    },
    tags: ['tapland'],
    expect: {
      roles: {},
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'e0c3c87b-83e3-4cff-b05f-78a192e2bba4',
      name: 'Irrigation Ditch',
      layout: 'normal',
      type_line: 'Land',
      mana_cost: '',
      oracle_text: 'This land enters tapped.\n{T}: Add {W}.\n{T}, Sacrifice this land: Add {G}{U}.',
      keywords: [],
      cmc: 0,
    },
    tags: ['ramp', 'tapland'],
    expect: {
      roles: {},
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '283f743f-6e79-49de-b7ed-08e6ffb64cc6',
      name: "Clive's Hideaway",
      layout: 'normal',
      type_line: 'Land — Town',
      mana_cost: '',
      oracle_text:
        'Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)\n{T}: Add {C}.\n{2}, {T}: You may play the exiled card without paying its mana cost if you control four or more legendary creatures.',
      keywords: ['Hideaway'],
      cmc: 0,
    },
    tags: ['utility-land'],
    expect: {
      roles: {},
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'c9b82110-7dfd-4617-9399-9510be449043',
      name: 'Dark Depths',
      layout: 'normal',
      type_line: 'Legendary Snow Land',
      mana_cost: '',
      oracle_text:
        'Dark Depths enters with ten ice counters on it.\n{3}: Remove an ice counter from Dark Depths.\nWhen Dark Depths has no ice counters on it, sacrifice it. If you do, create Marit Lage, a legendary 20/20 black Avatar creature token with flying and indestructible.',
      keywords: [],
      cmc: 0,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '1275653f-de4e-4fe9-aad8-88555fa11680',
      name: 'Wirewood Lodge',
      layout: 'normal',
      type_line: 'Land',
      mana_cost: '',
      oracle_text: '{T}: Add {C}.\n{G}, {T}: Untap target Elf.',
      keywords: [],
      cmc: 0,
    },
    tags: ['utility-land'],
    expect: {
      roles: {},
      interaction: [],
      produces: ['mana', 'untap'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'ce55657d-d82f-4528-a83e-5cad7de111fd',
      name: "Teferi's Isle",
      layout: 'normal',
      type_line: 'Legendary Land',
      mana_cost: '',
      oracle_text:
        "Phasing (This phases in or out before you untap during each of your untap steps. While it's phased out, it's treated as though it doesn't exist.)\nTeferi's Isle enters tapped.\n{T}: Add {U}{U}.",
      keywords: ['Phasing'],
      cmc: 0,
    },
    tags: ['tapland'],
    expect: {
      roles: {},
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
];
