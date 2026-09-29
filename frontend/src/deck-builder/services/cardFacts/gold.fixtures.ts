/**
 * Gold set for card facts: real cards, real oracle text, hand-written labels.
 *
 * Card fields are copied verbatim from Scryfall's oracle_cards bulk feed
 * (updated 2026-09-29T09:01:56Z); `tags` is each card's membership in the
 * committed tagger-tags.json (generated 2026-09-01). The labels were written
 * from the oracle text alone, before comparing with the extractor, so the
 * benchmark is not graded against its own output.
 *
 * Label grammar (see bench.ts):
 *  roles        role → "T SPEED REPEAT [fN]". T is P (primary: the card's main
 *               job), S (secondary: a real second job, a modal mode that isn't
 *               the card's point, a land's spell side) or I (incidental: a
 *               rider, an ultimate, a transformed back face). Only roles the
 *               text supports are listed; a role not listed is not one.
 *  interaction  "mode hits scope side [fN]" for every removal, wipe and
 *               counter effect. hits are sorted and |-joined; side is any
 *               (you pick the target), opponents (one-sided) or all (every
 *               player, yours included).
 *  produces /   the extended resources (mana, cards, treasure, clue, food,
 *  payoffs      other-token, gy-to-hand, gy-to-battlefield, ltb,
 *               cast-noncreature, cast-creature, attack, other-counter, copy,
 *               untap, extra-combat). Axis resources are gated by
 *               synergy/classify.fixtures.ts instead.
 *
 * Coverage: the E476/E486/E487 troublemakers (Liliana, Dreadhorde General;
 * counterspells vs removal; Deadbridge Chant; Elesh Norn's back face;
 * "Harmonized Trio // Brainstorm"), then a spread across every role, every
 * interaction mode, symmetric and one-sided wipes, modal spells, split,
 * adventure, MDFC, transform and prepare layouts, planeswalker ultimates and
 * lands.
 */
import type { GoldCard } from './bench';

export const GOLD: GoldCard[] = [
  {
    card: {
      oracle_id: '5e958212-6a5b-4288-8d31-f1572619d7dc',
      name: 'Liliana, Dreadhorde General',
      layout: 'normal',
      type_line: 'Legendary Planeswalker — Liliana',
      mana_cost: '{4}{B}{B}',
      oracle_text:
        'Whenever a creature you control dies, draw a card.\n+1: Create a 2/2 black Zombie creature token.\n−4: Each player sacrifices two creatures of their choice.\n−9: Each opponent chooses a permanent they control of each permanent type and sacrifices the rest.',
      keywords: [],
      loyalty: '6',
      cmc: 6,
    },
    tags: ['removal', 'spot-removal', 'boardwipe', 'card-advantage', 'draw', 'mass-land-denial'],
    expect: {
      roles: {
        cardDraw: 'P triggered per-event',
        removal: 'S sorcery per-turn',
        boardwipe: 'I sorcery per-turn',
      },
      interaction: ['sacrifice creature single all', 'sacrifice permanent mass opponents'],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '506667b1-7922-4959-a5b3-0f8abe8c3615',
      name: 'Deadbridge Chant',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{4}{B}{G}',
      oracle_text:
        "When this enchantment enters, mill ten cards.\nAt the beginning of your upkeep, choose a card at random in your graveyard. If it's a creature card, put it onto the battlefield. Otherwise, put it into your hand.",
      keywords: ['Mill'],
      cmc: 6,
    },
    tags: ['card-advantage'],
    expect: {
      roles: {
        recursion: 'P triggered per-turn',
        cardDraw: 'P triggered per-turn',
      },
      interaction: [],
      produces: ['gy-to-battlefield', 'gy-to-hand'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '650ed75c-20b0-45b8-a4d4-813e0369aaf1',
      name: 'Elesh Norn // The Argent Etchings',
      layout: 'transform',
      type_line: 'Legendary Creature — Phyrexian Praetor // Enchantment — Saga',
      keywords: ['Incubate', 'Vigilance', 'Transform'],
      cmc: 4,
      card_faces: [
        {
          name: 'Elesh Norn',
          type_line: 'Legendary Creature — Phyrexian Praetor',
          mana_cost: '{2}{W}{W}',
          oracle_text:
            "Vigilance\nWhenever a source an opponent controls deals damage to you or a permanent you control, that source's controller loses 2 life unless they pay {1}.\n{2}{W}, Sacrifice three other creatures: Exile Elesh Norn, then return it to the battlefield transformed under its owner's control. Activate only as a sorcery.",
          power: '3',
          toughness: '5',
        },
        {
          name: 'The Argent Etchings',
          type_line: 'Enchantment — Saga',
          mana_cost: '',
          oracle_text:
            '(As this Saga enters and after your draw step, add a lore counter.)\nI — Incubate 2 five times, then transform all Incubator tokens you control.\nII — Creatures you control get +1/+1 and gain double strike until end of turn.\nIII — Destroy all other permanents except for artifacts, lands, and Phyrexians. Exile this Saga, then return it to the battlefield (front face up).',
        },
      ],
    },
    tags: ['removal', 'boardwipe', 'sacrifice'],
    expect: {
      roles: {
        boardwipe: 'I triggered once f1',
      },
      interaction: ['destroy battle|creature|enchantment|planeswalker mass all f1'],
      produces: ['other-token'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'f6036065-7196-44d4-8a27-2199f0e1a03c',
      name: 'Harmonized Trio // Brainstorm',
      layout: 'prepare',
      type_line: 'Creature — Merfolk Bard Wizard // Instant',
      mana_cost: '{U} // {U}',
      keywords: ['Prepared'],
      power: '1',
      toughness: '1',
      cmc: 1,
      card_faces: [
        {
          name: 'Harmonized Trio',
          type_line: 'Creature — Merfolk Bard Wizard',
          mana_cost: '{U}',
          oracle_text:
            "{T}, Tap two untapped creatures you control: This creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
          power: '1',
          toughness: '1',
        },
        {
          name: 'Brainstorm',
          type_line: 'Instant',
          mana_cost: '{U}',
          oracle_text:
            'Draw three cards, then put two cards from your hand on top of your library in any order.',
        },
      ],
    },
    tags: ['card-advantage', 'draw'],
    expect: {
      roles: {
        cardDraw: 'S instant once f1',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '36cd2364-d113-47d1-b2c4-b088d9eb88dd',
      name: 'Brainstorm',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{U}',
      oracle_text:
        'Draw three cards, then put two cards from your hand on top of your library in any order.',
      keywords: [],
      cmc: 1,
    },
    tags: ['card-advantage', 'draw', 'cantrip'],
    expect: {
      roles: {
        cardDraw: 'P instant once',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '74d3277a-38e5-4732-afed-084a56148f20',
      name: 'Mana Drain',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{U}{U}',
      oracle_text:
        "Counter target spell. At the beginning of your next main phase, add an amount of {C} equal to that spell's mana value.",
      keywords: [],
      cmc: 2,
    },
    tags: ['ramp', 'counterspell'],
    expect: {
      roles: {
        counterspell: 'P instant once',
        ramp: 'I instant once',
      },
      interaction: ['counter spell single any'],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'd0901053-6de0-46d0-9ee3-8d40510236c1',
      name: 'Sword of Feast and Famine',
      layout: 'normal',
      type_line: 'Artifact — Equipment',
      mana_cost: '{3}',
      oracle_text:
        'Equipped creature gets +2/+2 and has protection from black and from green.\nWhenever equipped creature deals combat damage to a player, that player discards a card and you untap all lands you control.\nEquip {2}',
      keywords: ['Equip'],
      cmc: 3,
    },
    tags: ['ramp', 'protection'],
    expect: {
      roles: {
        protection: 'I static static',
        ramp: 'I triggered per-event',
      },
      interaction: [],
      produces: ['untap'],
      payoffs: ['attack'],
    },
  },
  {
    card: {
      oracle_id: 'cc187110-1148-4090-bbb8-e205694a39f5',
      name: 'Counterspell',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{U}{U}',
      oracle_text: 'Counter target spell.',
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
      oracle_id: '3407fe41-fdd3-4119-8f70-4bc4590a379f',
      name: 'Negate',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{U}',
      oracle_text: 'Counter target noncreature spell.',
      keywords: [],
      cmc: 2,
    },
    tags: ['counterspell'],
    expect: {
      roles: {
        counterspell: 'P instant once',
      },
      interaction: ['counter noncreature-spell single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'd09c9cba-fdd2-479b-ad5d-d05181c3e3f9',
      name: 'Fierce Guardianship',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{2}{U}',
      oracle_text:
        'If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell.',
      keywords: [],
      cmc: 3,
    },
    tags: ['counterspell'],
    expect: {
      roles: {
        counterspell: 'P instant once',
      },
      interaction: ['counter noncreature-spell single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '956381ba-6d37-4a8a-846c-bad79222dbee',
      name: 'Force of Will',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{3}{U}{U}',
      oracle_text:
        "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target spell.",
      keywords: [],
      cmc: 5,
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
      oracle_id: '8ddfc283-c9b4-41a5-af88-cf0068e986cc',
      name: 'Swan Song',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{U}',
      oracle_text:
        'Counter target enchantment, instant, or sorcery spell. Its controller creates a 2/2 blue Bird creature token with flying.',
      keywords: [],
      cmc: 1,
    },
    tags: ['counterspell'],
    expect: {
      roles: {
        counterspell: 'P instant once',
      },
      interaction: ['counter instant-sorcery-spell|noncreature-spell single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'b3b00911-ece7-4484-bc36-f211ce72b6cc',
      name: 'Stifle',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{U}',
      oracle_text:
        "Counter target activated or triggered ability. (Mana abilities can't be targeted.)",
      keywords: [],
      cmc: 1,
    },
    tags: ['counterspell'],
    expect: {
      roles: {
        counterspell: 'P instant once',
      },
      interaction: ['counter ability single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '234a734b-ba28-4f1b-9d01-3c3e7d516590',
      name: "An Offer You Can't Refuse",
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{U}',
      oracle_text:
        'Counter target noncreature spell. Its controller creates two Treasure tokens. (They\'re artifacts with "{T}, Sacrifice this token: Add one mana of any color.")',
      keywords: ['Treasure'],
      cmc: 1,
    },
    tags: ['counterspell'],
    expect: {
      roles: {
        counterspell: 'P instant once',
      },
      interaction: ['counter noncreature-spell single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'c61fe162-2202-4e56-9ba0-393547f9875f',
      name: 'Mana Leak',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{U}',
      oracle_text: 'Counter target spell unless its controller pays {3}.',
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
      oracle_id: '1b388371-f9ef-45b4-82a3-ca20a8cd7807',
      name: "Dovin's Veto",
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{W}{U}',
      oracle_text: "This spell can't be countered.\nCounter target noncreature spell.",
      keywords: [],
      cmc: 2,
    },
    tags: ['counterspell'],
    expect: {
      roles: {
        counterspell: 'P instant once',
      },
      interaction: ['counter noncreature-spell single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'a3e51a35-09df-4189-b131-08a21e6a557d',
      name: 'Cryptic Command',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{U}{U}{U}',
      oracle_text:
        "Choose two —\n• Counter target spell.\n• Return target permanent to its owner's hand.\n• Tap all creatures your opponents control.\n• Draw a card.",
      keywords: [],
      cmc: 4,
    },
    tags: [
      'removal',
      'spot-removal',
      'counterspell',
      'bounce',
      'card-advantage',
      'draw',
      'cantrip',
    ],
    expect: {
      roles: {
        counterspell: 'P instant once',
        removal: 'S instant once',
        cardDraw: 'I instant once',
      },
      interaction: ['counter spell single any', 'bounce permanent single any'],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'b1544f21-7e98-461b-aed5-e748b0168c52',
      name: 'Swords to Plowshares',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{W}',
      oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
      keywords: [],
      cmc: 1,
    },
    tags: ['removal', 'spot-removal', 'lifegain'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['exile creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'd683d985-9888-4d21-8b5f-69e69ce4a03b',
      name: 'Path to Exile',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{W}',
      oracle_text:
        'Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
      keywords: [],
      cmc: 1,
    },
    tags: ['ramp', 'removal', 'spot-removal', 'tutor', 'land-tutor'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['exile creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '7735eeba-693b-47e2-bd51-414379cf1016',
      name: 'Beast Within',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{2}{G}',
      oracle_text:
        'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
      keywords: [],
      cmc: 3,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['destroy permanent single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'fae37e28-e137-4177-b973-fa8b4dd8f409',
      name: 'Generous Gift',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{2}{W}',
      oracle_text:
        'Destroy target permanent. Its controller creates a 3/3 green Elephant creature token.',
      keywords: [],
      cmc: 3,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['destroy permanent single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '07a0cba9-8768-4fd9-a3d5-b0f83b4bf8e8',
      name: 'Chaos Warp',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{2}{R}',
      oracle_text:
        "The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield.",
      keywords: [],
      cmc: 3,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['tuck permanent single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'ad09b3c3-c8e7-481c-8c45-e7f234935117',
      name: 'Anguished Unmaking',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{W}{B}',
      oracle_text: 'Exile target nonland permanent. You lose 3 life.',
      keywords: [],
      cmc: 3,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['exile nonland-permanent single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'ac10d218-f9a6-4058-9cda-a15ca1b0b7b5',
      name: "Assassin's Trophy",
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{B}{G}',
      oracle_text:
        'Destroy target permanent an opponent controls. Its controller may search their library for a basic land card, put it onto the battlefield, then shuffle.',
      keywords: [],
      cmc: 2,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['destroy permanent single opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '63c1ac21-e3d8-40c2-8c09-3f31c52992ef',
      name: 'Vindicate',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{1}{W}{B}',
      oracle_text: 'Destroy target permanent.',
      keywords: [],
      cmc: 3,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['destroy permanent single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'bd16434d-55ea-4c5a-a9ef-752971a4af16',
      name: 'Despark',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{W}{B}',
      oracle_text: 'Exile target permanent with mana value 4 or greater.',
      keywords: [],
      cmc: 2,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['exile permanent single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '94f0a572-e91c-4b56-a5d1-6cbbeabd210d',
      name: 'Infernal Grasp',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{B}',
      oracle_text: 'Destroy target creature. You lose 2 life.',
      keywords: [],
      cmc: 2,
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
      oracle_id: '2f092562-9e17-43cd-aeb8-d0567f99363e',
      name: 'Go for the Throat',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{B}',
      oracle_text: 'Destroy target nonartifact creature.',
      keywords: [],
      cmc: 2,
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
      oracle_id: '59e7f2ae-4535-4191-98be-3e65b6b2befa',
      name: 'Doom Blade',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{B}',
      oracle_text: 'Destroy target nonblack creature.',
      keywords: [],
      cmc: 2,
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
      oracle_id: '03df6a57-37c9-46d3-83b3-4a6240100714',
      name: "Hero's Downfall",
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{B}{B}',
      oracle_text: 'Destroy target creature or planeswalker.',
      keywords: [],
      cmc: 3,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['destroy creature|planeswalker single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '4457ed35-7c10-48c8-9776-456485fdf070',
      name: 'Lightning Bolt',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{R}',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      keywords: [],
      cmc: 1,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['damage battle|creature|planeswalker single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '3641d572-8335-4804-88ad-edf4dc67a8e4',
      name: 'Heartless Act',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{B}',
      oracle_text:
        'Choose one —\n• Destroy target creature with no counters on it.\n• Remove up to three counters from target creature.',
      keywords: [],
      cmc: 2,
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
      oracle_id: '5825997b-10d7-4a36-972c-a80ddd90b8ed',
      name: 'Feed the Swarm',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{1}{B}',
      oracle_text:
        "Destroy target creature or enchantment an opponent controls. You lose life equal to that permanent's mana value.",
      keywords: [],
      cmc: 2,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['destroy creature|enchantment single opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '6d4e558e-9109-4918-a082-fdcbaffd516b',
      name: "Nature's Claim",
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{G}',
      oracle_text: 'Destroy target artifact or enchantment. Its controller gains 4 life.',
      keywords: [],
      cmc: 1,
    },
    tags: ['removal', 'spot-removal', 'lifegain'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['destroy artifact|enchantment single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '3e39224c-72ce-4ecc-aa17-12c071ea1f3e',
      name: 'Krosan Grip',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{2}{G}',
      oracle_text:
        "Split second (As long as this spell is on the stack, players can't cast spells or activate abilities that aren't mana abilities.)\nDestroy target artifact or enchantment.",
      keywords: ['Split second'],
      cmc: 3,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['destroy artifact|enchantment single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'f9db72dc-9a5b-48a4-a86e-7464d9a2166a',
      name: 'Abrade',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{R}',
      oracle_text:
        'Choose one —\n• Abrade deals 3 damage to target creature.\n• Destroy target artifact.',
      keywords: [],
      cmc: 2,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['damage creature single any', 'destroy artifact single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '45f1e957-09f0-4d46-8e32-238f26060a87',
      name: "Kolaghan's Command",
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{B}{R}',
      oracle_text:
        "Choose two —\n• Return target creature card from your graveyard to your hand.\n• Target player discards a card.\n• Destroy target artifact.\n• Kolaghan's Command deals 2 damage to any target.",
      keywords: [],
      cmc: 3,
    },
    tags: ['removal', 'spot-removal', 'card-advantage'],
    expect: {
      roles: {
        removal: 'P instant once',
        recursion: 'S instant once',
      },
      interaction: [
        'destroy artifact single any',
        'damage battle|creature|planeswalker single any',
      ],
      produces: ['gy-to-hand'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'bd9b9772-f5f9-4c6b-913e-7193bea5d0a7',
      name: 'Oblivion Ring',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{2}{W}',
      oracle_text:
        "When this enchantment enters, exile another target nonland permanent.\nWhen this enchantment leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
      keywords: [],
      cmc: 3,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['exile nonland-permanent single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'f28b21a6-f7ce-437a-8c5b-0423cb55cefb',
      name: 'Banishing Light',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{2}{W}',
      oracle_text:
        'When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.',
      keywords: [],
      cmc: 3,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['exile nonland-permanent single opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '5f5e0b10-c8cf-450c-bfd3-bcb0528ec330',
      name: 'Pacifism',
      layout: 'normal',
      type_line: 'Enchantment — Aura',
      mana_cost: '{1}{W}',
      oracle_text: "Enchant creature\nEnchanted creature can't attack or block.",
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
      oracle_id: '05a4f8ff-49da-42af-add5-6248c4b0644b',
      name: 'Darksteel Mutation',
      layout: 'normal',
      type_line: 'Enchantment — Aura',
      mana_cost: '{1}{W}',
      oracle_text:
        'Enchant creature\nEnchanted creature is an Insect artifact creature with base power and toughness 0/1 and has indestructible, and it loses all other abilities, card types, and creature types.',
      keywords: ['Enchant'],
      cmc: 2,
    },
    tags: ['removal', 'spot-removal', 'protection'],
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
      oracle_id: '7c3944fa-7c86-4979-85a9-86196aa94594',
      name: 'Song of the Dryads',
      layout: 'normal',
      type_line: 'Enchantment — Aura',
      mana_cost: '{2}{G}',
      oracle_text: 'Enchant permanent\nEnchanted permanent is a colorless Forest land.',
      keywords: ['Enchant'],
      cmc: 3,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P static static',
      },
      interaction: ['neutralize permanent single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'cd0d7141-46d2-4aa3-bc77-6b3b4513803e',
      name: 'Control Magic',
      layout: 'normal',
      type_line: 'Enchantment — Aura',
      mana_cost: '{2}{U}{U}',
      oracle_text: 'Enchant creature\nYou control enchanted creature.',
      keywords: ['Enchant'],
      cmc: 4,
    },
    tags: [],
    expect: {
      roles: {
        removal: 'P static static',
      },
      interaction: ['steal creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '7b459306-149b-4f43-abc1-2dd70c748c0e',
      name: 'Ravenous Chupacabra',
      layout: 'normal',
      type_line: 'Creature — Beast Horror',
      mana_cost: '{2}{B}{B}',
      oracle_text: 'When this creature enters, destroy target creature an opponent controls.',
      keywords: [],
      power: '2',
      toughness: '2',
      cmc: 4,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['destroy creature single opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '717bbb9d-0a5b-4979-a24b-9d54aac7657a',
      name: 'Shriekmaw',
      layout: 'normal',
      type_line: 'Creature — Elemental',
      mana_cost: '{4}{B}',
      oracle_text:
        "Fear (This creature can't be blocked except by artifact creatures and/or black creatures.)\nWhen this creature enters, destroy target nonartifact, nonblack creature.\nEvoke {1}{B} (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)",
      keywords: ['Evoke', 'Fear'],
      power: '3',
      toughness: '2',
      cmc: 5,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['destroy creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '032ec6e2-6cc3-4a97-9cc7-3233f5e11904',
      name: 'Reclamation Sage',
      layout: 'normal',
      type_line: 'Creature — Elf Shaman',
      mana_cost: '{2}{G}',
      oracle_text: 'When this creature enters, you may destroy target artifact or enchantment.',
      keywords: [],
      power: '2',
      toughness: '1',
      cmc: 3,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['destroy artifact|enchantment single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '21f45043-5419-4019-8b6c-e5294bd5f549',
      name: 'Acidic Slime',
      layout: 'normal',
      type_line: 'Creature — Ooze',
      mana_cost: '{3}{G}{G}',
      oracle_text:
        'Deathtouch (Any amount of damage this deals to a creature is enough to destroy it.)\nWhen this creature enters, destroy target artifact, enchantment, or land.',
      keywords: ['Deathtouch'],
      power: '2',
      toughness: '2',
      cmc: 5,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['destroy artifact|enchantment|land single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '837182db-1bf3-4a2c-bd01-1af9d9873561',
      name: 'Unsummon',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{U}',
      oracle_text: "Return target creature to its owner's hand.",
      keywords: [],
      cmc: 1,
    },
    tags: ['removal', 'spot-removal', 'bounce'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['bounce creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'c2898bbd-82a4-4d26-b6ee-169b0ebe71b4',
      name: 'Into the Roil',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{U}',
      oracle_text:
        "Kicker {1}{U} (You may pay an additional {1}{U} as you cast this spell.)\nReturn target nonland permanent to its owner's hand. If this spell was kicked, draw a card.",
      keywords: ['Kicker'],
      cmc: 2,
    },
    tags: ['removal', 'spot-removal', 'bounce', 'card-advantage', 'draw', 'cantrip'],
    expect: {
      roles: {
        removal: 'P instant once',
        cardDraw: 'I instant once',
      },
      interaction: ['bounce nonland-permanent single any'],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'ac914d98-221e-426c-8a50-342896b15f9e',
      name: 'Snap',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{U}',
      oracle_text: "Return target creature to its owner's hand. Untap up to two lands.",
      keywords: [],
      cmc: 2,
    },
    tags: ['removal', 'spot-removal', 'bounce'],
    expect: {
      roles: {
        removal: 'P instant once',
        ramp: 'I instant once',
      },
      interaction: ['bounce creature single any'],
      produces: ['untap'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'd75b9c82-1b49-4c3e-a1b5-aeef57d6644b',
      name: 'Cyclonic Rift',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{U}',
      oracle_text:
        'Return target nonland permanent you don\'t control to its owner\'s hand.\nOverload {6}{U} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")',
      keywords: ['Overload'],
      cmc: 2,
    },
    tags: ['removal', 'spot-removal', 'bounce', 'boardwipe'],
    expect: {
      roles: {
        removal: 'P instant once',
        boardwipe: 'S instant once',
      },
      interaction: [
        'bounce nonland-permanent single opponents',
        'bounce nonland-permanent mass opponents',
      ],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'b3c12848-528d-4005-878f-4f950a07240a',
      name: 'Prey Upon',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{G}',
      oracle_text:
        "Target creature you control fights target creature you don't control. (Each deals damage equal to its power to the other.)",
      keywords: ['Fight'],
      cmc: 1,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['fight creature single opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '6d5dc34b-3eea-4b77-8db7-94bc30b14c4c',
      name: 'Rabid Bite',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{1}{G}',
      oracle_text:
        "Target creature you control deals damage equal to its power to target creature you don't control.",
      keywords: [],
      cmc: 2,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['damage creature single opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '058917c1-21ab-488a-9f9c-591c55f3c596',
      name: 'Diabolic Edict',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{B}',
      oracle_text: 'Target player sacrifices a creature of their choice.',
      keywords: [],
      cmc: 2,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['sacrifice creature single opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '4b1bf05e-753e-4350-a913-894cf3cecc0c',
      name: 'Fleshbag Marauder',
      layout: 'normal',
      type_line: 'Creature — Zombie Warrior',
      mana_cost: '{2}{B}',
      oracle_text: 'When this creature enters, each player sacrifices a creature of their choice.',
      keywords: [],
      power: '3',
      toughness: '1',
      cmc: 3,
    },
    tags: ['removal', 'spot-removal', 'sacrifice'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['sacrifice creature single all'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '6f4ac4a4-53ec-4bc9-8f5c-d4b801d867b2',
      name: 'Grave Pact',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{1}{B}{B}{B}',
      oracle_text:
        'Whenever a creature you control dies, each other player sacrifices a creature of their choice.',
      keywords: [],
      cmc: 4,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P triggered per-event',
      },
      interaction: ['sacrifice creature single opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '3e00326d-2bf4-4731-a6cd-1c015f94f553',
      name: 'Anchor to the Aether',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{U}',
      oracle_text:
        "Put target creature on top of its owner's library. Scry 1. (Look at the top card of your library. You may put that card on the bottom.)",
      keywords: ['Scry'],
      cmc: 3,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['tuck creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '377d31b5-0a48-4d5b-91bd-b5a62d4f7899',
      name: 'Condemn',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{W}',
      oracle_text:
        "Put target attacking creature on the bottom of its owner's library. Its controller gains life equal to its toughness.",
      keywords: [],
      cmc: 1,
    },
    tags: ['removal', 'spot-removal', 'lifegain'],
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
      oracle_id: '382097b3-f753-493c-bde4-101c0538feb4',
      name: 'Frost Breath',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{2}{U}',
      oracle_text:
        "Tap up to two target creatures. Those creatures don't untap during their controller's next untap step.",
      keywords: [],
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {
        removal: 'I instant once',
      },
      interaction: ['neutralize creature multi any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '0cf18002-1bbe-40b3-ae15-fa51e61e9391',
      name: 'Icefall Regent',
      layout: 'normal',
      type_line: 'Creature — Dragon',
      mana_cost: '{3}{U}{U}',
      oracle_text:
        "Flying\nWhen this creature enters, tap target creature an opponent controls. That creature doesn't untap during its controller's untap step for as long as you control this creature.\nSpells your opponents cast that target this creature cost {2} more to cast.",
      keywords: ['Flying'],
      power: '4',
      toughness: '3',
      cmc: 5,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['neutralize creature single opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'fd74f8eb-0253-42dd-8277-186d4934da38',
      name: 'Dismember',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{B/P}{B/P}',
      oracle_text:
        '({B/P} can be paid with either {B} or 2 life.)\nTarget creature gets -5/-5 until end of turn.',
      keywords: [],
      cmc: 3,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['shrink creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'afaef788-34d1-460b-b884-9d7ae6ddeb18',
      name: 'Toxic Deluge',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{B}',
      oracle_text:
        'As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.',
      keywords: [],
      cmc: 3,
    },
    tags: ['removal', 'boardwipe'],
    expect: {
      roles: {
        boardwipe: 'P sorcery once',
      },
      interaction: ['shrink creature mass all'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '34515b16-c9a4-4f98-8c77-416a7a523407',
      name: 'Wrath of God',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{W}{W}',
      oracle_text: "Destroy all creatures. They can't be regenerated.",
      keywords: [],
      cmc: 4,
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
      oracle_id: 'd57a8f0b-7989-4db5-8756-6f2690097252',
      name: 'Damnation',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{B}{B}',
      oracle_text: "Destroy all creatures. They can't be regenerated.",
      keywords: [],
      cmc: 4,
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
      oracle_id: '7a2484a9-04fd-41a0-8224-610c1c07ed10',
      name: 'Blasphemous Act',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{8}{R}',
      oracle_text:
        'This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature.',
      keywords: [],
      cmc: 9,
    },
    tags: ['removal', 'boardwipe'],
    expect: {
      roles: {
        boardwipe: 'P sorcery once',
      },
      interaction: ['damage creature mass all'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '4eb813fd-2d5a-4b02-8193-662681ef4e7d',
      name: 'Farewell',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{4}{W}{W}',
      oracle_text:
        'Choose one or more —\n• Exile all artifacts.\n• Exile all creatures.\n• Exile all enchantments.\n• Exile all graveyards.',
      keywords: [],
      cmc: 6,
    },
    tags: ['removal', 'boardwipe', 'graveyard-hate'],
    expect: {
      roles: {
        boardwipe: 'P sorcery once',
        graveyardHate: 'S sorcery once',
      },
      interaction: [
        'exile artifact mass all',
        'exile creature mass all',
        'exile enchantment mass all',
      ],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '09cc8709-fe10-472a-b05c-e89f3523018d',
      name: 'Austere Command',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{4}{W}{W}',
      oracle_text:
        'Choose two —\n• Destroy all artifacts.\n• Destroy all enchantments.\n• Destroy all creatures with mana value 3 or less.\n• Destroy all creatures with mana value 4 or greater.',
      keywords: [],
      cmc: 6,
    },
    tags: ['removal', 'boardwipe'],
    expect: {
      roles: {
        boardwipe: 'P sorcery once',
      },
      interaction: [
        'destroy artifact mass all',
        'destroy enchantment mass all',
        'destroy creature mass all',
        'destroy creature mass all',
      ],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'fdd94383-b573-439a-8e1c-925af887c5a6',
      name: 'Evacuation',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{3}{U}{U}',
      oracle_text: "Return all creatures to their owners' hands.",
      keywords: [],
      cmc: 5,
    },
    tags: ['removal', 'bounce', 'boardwipe'],
    expect: {
      roles: {
        boardwipe: 'P instant once',
      },
      interaction: ['bounce creature mass all'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '3567c3c8-b3c7-45b7-935b-b1fdbc973720',
      name: 'Vandalblast',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{R}',
      oracle_text:
        'Destroy target artifact you don\'t control.\nOverload {4}{R} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")',
      keywords: ['Overload'],
      cmc: 1,
    },
    tags: ['removal', 'spot-removal', 'boardwipe'],
    expect: {
      roles: {
        removal: 'P sorcery once',
        boardwipe: 'S sorcery once',
      },
      interaction: ['destroy artifact single opponents', 'destroy artifact mass opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '18ec721f-c1ac-4581-a61d-2f0b09d6bf92',
      name: 'Plague Wind',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{7}{B}{B}',
      oracle_text: "Destroy all creatures you don't control. They can't be regenerated.",
      keywords: [],
      cmc: 9,
    },
    tags: ['removal', 'boardwipe'],
    expect: {
      roles: {
        boardwipe: 'P sorcery once',
      },
      interaction: ['destroy creature mass opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'a6899b94-427d-4851-a474-4087e0a0918a',
      name: "In Garruk's Wake",
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{7}{B}{B}',
      oracle_text:
        "Destroy all creatures you don't control and all planeswalkers you don't control.",
      keywords: [],
      cmc: 9,
    },
    tags: ['removal', 'boardwipe'],
    expect: {
      roles: {
        boardwipe: 'P sorcery once',
      },
      interaction: ['destroy creature|planeswalker mass opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'a6f38908-aa4f-4f99-a28e-85d11dab52e4',
      name: 'Ruinous Ultimatum',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{R}{R}{W}{W}{W}{B}{B}',
      oracle_text: 'Destroy all nonland permanents your opponents control.',
      keywords: [],
      cmc: 7,
    },
    tags: ['removal', 'boardwipe'],
    expect: {
      roles: {
        boardwipe: 'P sorcery once',
      },
      interaction: ['destroy nonland-permanent mass opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '0342b085-be20-475a-bc38-59b9cb6012e8',
      name: 'Goblin Chainwhirler',
      layout: 'normal',
      type_line: 'Creature — Goblin Warrior',
      mana_cost: '{R}{R}{R}',
      oracle_text:
        'First strike\nWhen this creature enters, it deals 1 damage to each opponent and each creature and planeswalker they control.',
      keywords: ['First strike'],
      power: '3',
      toughness: '3',
      cmc: 3,
    },
    tags: ['removal', 'boardwipe'],
    expect: {
      roles: {
        boardwipe: 'S sorcery once',
      },
      interaction: ['damage creature|planeswalker mass opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '93cf50cf-0ecc-4d3e-abea-778c1ebacec4',
      name: 'Massacre Wurm',
      layout: 'normal',
      type_line: 'Creature — Phyrexian Wurm',
      mana_cost: '{3}{B}{B}{B}',
      oracle_text:
        'When this creature enters, creatures your opponents control get -2/-2 until end of turn.\nWhenever a creature an opponent controls dies, that player loses 2 life.',
      keywords: [],
      power: '6',
      toughness: '5',
      cmc: 6,
    },
    tags: ['removal', 'boardwipe'],
    expect: {
      roles: {
        boardwipe: 'P sorcery once',
      },
      interaction: ['shrink creature mass opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '62e44e0d-eda0-4275-8367-49dab9a087c3',
      name: 'Pernicious Deed',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{1}{B}{G}',
      oracle_text:
        '{X}, Sacrifice this enchantment: Destroy each artifact, creature, and enchantment with mana value X or less.',
      keywords: [],
      cmc: 3,
    },
    tags: ['removal', 'boardwipe'],
    expect: {
      roles: {
        boardwipe: 'P activated once',
      },
      interaction: ['destroy artifact|creature|enchantment mass all'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '3c8d4999-e18b-48d8-8ed9-f2feaa38300d',
      name: 'Merciless Eviction',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{4}{W}{B}',
      oracle_text:
        'Choose one —\n• Exile all artifacts.\n• Exile all creatures.\n• Exile all enchantments.\n• Exile all planeswalkers.',
      keywords: [],
      cmc: 6,
    },
    tags: ['removal', 'boardwipe'],
    expect: {
      roles: {
        boardwipe: 'P sorcery once',
      },
      interaction: [
        'exile artifact mass all',
        'exile creature mass all',
        'exile enchantment mass all',
        'exile planeswalker mass all',
      ],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '2b7c4dab-e432-4b34-b058-3cec5c0d72df',
      name: 'Martial Coup',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{X}{W}{W}',
      oracle_text:
        'Create X 1/1 white Soldier creature tokens. If X is 5 or more, destroy all other creatures.',
      keywords: [],
      cmc: 2,
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
      oracle_id: '2a2ea189-b663-4f4a-bb23-ff7a4af25f71',
      name: 'Settle the Wreckage',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{2}{W}{W}',
      oracle_text:
        'Exile all attacking creatures target player controls. That player may search their library for that many basic land cards, put those cards onto the battlefield tapped, then shuffle.',
      keywords: [],
      cmc: 4,
    },
    tags: ['ramp', 'removal', 'boardwipe', 'tutor', 'land-tutor'],
    expect: {
      roles: {
        boardwipe: 'P instant once',
      },
      interaction: ['exile creature mass opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '7c779721-cd1b-4696-9ae9-68ccc284ed2a',
      name: 'Aetherize',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{3}{U}',
      oracle_text: "Return all attacking creatures to their owner's hand.",
      keywords: [],
      cmc: 4,
    },
    tags: ['removal', 'bounce', 'boardwipe'],
    expect: {
      roles: {
        boardwipe: 'P instant once',
      },
      interaction: ['bounce creature mass opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'c9ed8b01-959a-47d6-891e-0abbdccf6e4f',
      name: 'Armageddon',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{3}{W}',
      oracle_text: 'Destroy all lands.',
      keywords: [],
      cmc: 4,
    },
    tags: ['removal', 'boardwipe', 'mass-land-denial'],
    expect: {
      roles: {},
      interaction: ['destroy land mass all'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'bf1341dd-41a3-49f6-87ec-63170dde4324',
      name: 'Boseiju, Who Endures',
      layout: 'normal',
      type_line: 'Legendary Land',
      mana_cost: '',
      oracle_text:
        '{T}: Add {G}.\nChannel — {1}{G}, Discard this card: Destroy target artifact, enchantment, or nonbasic land an opponent controls. That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle. This ability costs {1} less to activate for each legendary creature you control.',
      keywords: ['Channel'],
      cmc: 0,
    },
    tags: ['removal', 'spot-removal', 'utility-land'],
    expect: {
      roles: {
        removal: 'S activated once',
      },
      interaction: ['destroy artifact|enchantment|land single opponents'],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'e9b6a394-691c-425a-9307-76d8edc7375e',
      name: 'Otawara, Soaring City',
      layout: 'normal',
      type_line: 'Legendary Land',
      mana_cost: '',
      oracle_text:
        "{T}: Add {U}.\nChannel — {3}{U}, Discard this card: Return target artifact, creature, enchantment, or planeswalker to its owner's hand. This ability costs {1} less to activate for each legendary creature you control.",
      keywords: ['Channel'],
      cmc: 0,
    },
    tags: ['removal', 'spot-removal', 'bounce', 'utility-land'],
    expect: {
      roles: {
        removal: 'S activated once',
      },
      interaction: ['bounce artifact|creature|enchantment|planeswalker single any'],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '9e6a3df4-67a3-452e-a6ef-f04dbadb21ef',
      name: 'Living Death',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{3}{B}{B}',
      oracle_text:
        'Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield.',
      keywords: [],
      cmc: 5,
    },
    tags: ['removal', 'boardwipe'],
    expect: {
      roles: {
        boardwipe: 'P sorcery once',
        recursion: 'P sorcery once',
      },
      interaction: ['sacrifice creature mass all'],
      produces: ['gy-to-battlefield'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '6ad8011d-3471-4369-9d68-b264cc027487',
      name: 'Sol Ring',
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{1}',
      oracle_text: '{T}: Add {C}{C}.',
      keywords: [],
      cmc: 1,
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
      oracle_id: '0bc7f093-bef0-4f1a-852c-4b75ebf54838',
      name: 'Arcane Signet',
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{2}',
      oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
      keywords: [],
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
      oracle_id: '68954295-54e3-4303-a6bc-fc4547a4e3a3',
      name: 'Llanowar Elves',
      layout: 'normal',
      type_line: 'Creature — Elf Druid',
      mana_cost: '{G}',
      oracle_text: '{T}: Add {G}.',
      keywords: [],
      power: '1',
      toughness: '1',
      cmc: 1,
    },
    tags: ['ramp', 'mana-dork'],
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
      oracle_id: 'd3a0b660-358c-41bd-9cd2-41fbf3491b1a',
      name: 'Birds of Paradise',
      layout: 'normal',
      type_line: 'Creature — Bird',
      mana_cost: '{G}',
      oracle_text: 'Flying\n{T}: Add one mana of any color.',
      keywords: ['Flying'],
      power: '0',
      toughness: '1',
      cmc: 1,
    },
    tags: ['ramp', 'mana-dork'],
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
      oracle_id: '8b755881-a72d-4e21-a369-d2924eb4585a',
      name: 'Cultivate',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{G}',
      oracle_text:
        'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
      keywords: [],
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
      oracle_id: '1593ea18-2f2f-4ab4-83fb-6ccc0bec8a90',
      name: "Kodama's Reach",
      layout: 'normal',
      type_line: 'Sorcery — Arcane',
      mana_cost: '{2}{G}',
      oracle_text:
        'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
      keywords: [],
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
      oracle_id: '8539f295-5d58-4436-a73a-b9277c4c7795',
      name: 'Rampant Growth',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{1}{G}',
      oracle_text:
        'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
      keywords: [],
      cmc: 2,
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
      oracle_id: '78826359-fe63-44ad-adc4-a17ffcd710e4',
      name: "Nature's Lore",
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{1}{G}',
      oracle_text:
        'Search your library for a Forest card, put that card onto the battlefield, then shuffle.',
      keywords: [],
      cmc: 2,
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
      oracle_id: '495e52e6-4c2b-4574-9474-eadbdcc8b4ac',
      name: 'Farseek',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{1}{G}',
      oracle_text:
        'Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle.',
      keywords: [],
      cmc: 2,
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
      oracle_id: '153376c9-dffd-458c-8ce3-a4c8269bc4e9',
      name: 'Smothering Tithe',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{3}{W}',
      oracle_text:
        'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
      keywords: ['Treasure'],
      cmc: 4,
    },
    tags: ['ramp'],
    expect: {
      roles: {
        ramp: 'P triggered per-event',
      },
      interaction: [],
      produces: ['treasure'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '706ae742-1807-44b7-a4fa-f2e26f61519a',
      name: 'Wild Growth',
      layout: 'normal',
      type_line: 'Enchantment — Aura',
      mana_cost: '{G}',
      oracle_text:
        'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.',
      keywords: ['Enchant'],
      cmc: 1,
    },
    tags: ['ramp'],
    expect: {
      roles: {
        ramp: 'P triggered per-event',
      },
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '00d8efa6-a2d9-4249-8da7-b45173675329',
      name: 'Utopia Sprawl',
      layout: 'normal',
      type_line: 'Enchantment — Aura',
      mana_cost: '{G}',
      oracle_text:
        'Enchant Forest\nAs this Aura enters, choose a color.\nWhenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.',
      keywords: ['Enchant'],
      cmc: 1,
    },
    tags: ['ramp'],
    expect: {
      roles: {
        ramp: 'P triggered per-event',
      },
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '53f7c868-b03e-4fc2-8dcf-a75bbfa3272b',
      name: 'Dark Ritual',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{B}',
      oracle_text: 'Add {B}{B}{B}.',
      keywords: [],
      cmc: 1,
    },
    tags: ['ramp'],
    expect: {
      roles: {
        ramp: 'S instant once',
      },
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '0c2841bb-038c-4fbf-8360-bc0a1522b58d',
      name: 'Exploration',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{G}',
      oracle_text: 'You may play an additional land on each of your turns.',
      keywords: [],
      cmc: 1,
    },
    tags: ['ramp'],
    expect: {
      roles: {
        ramp: 'P static static',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '6c2c8bf3-9bf8-4a86-89d3-3bb36260dc51',
      name: 'Azusa, Lost but Seeking',
      layout: 'normal',
      type_line: 'Legendary Creature — Human Monk',
      mana_cost: '{2}{G}',
      oracle_text: 'You may play two additional lands on each of your turns.',
      keywords: [],
      power: '1',
      toughness: '2',
      cmc: 3,
    },
    tags: ['ramp'],
    expect: {
      roles: {
        ramp: 'P static static',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '88cf4c1a-5863-45fc-b76d-7ad33b175b2b',
      name: 'Burgeoning',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{G}',
      oracle_text:
        'Whenever an opponent plays a land, you may put a land card from your hand onto the battlefield.',
      keywords: [],
      cmc: 1,
    },
    tags: ['ramp'],
    expect: {
      roles: {
        ramp: 'P triggered per-event',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '6f856f99-4cb4-479d-958d-964220965ed6',
      name: 'Wilderness Reclamation',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{3}{G}',
      oracle_text: 'At the beginning of your end step, untap all lands you control.',
      keywords: [],
      cmc: 4,
    },
    tags: [],
    expect: {
      roles: {
        ramp: 'P triggered per-turn',
      },
      interaction: [],
      produces: ['untap'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'a3a8a044-283d-443e-bc40-c2f826d70c22',
      name: 'Mana Reflection',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{4}{G}{G}',
      oracle_text:
        'If you tap a permanent for mana, it produces twice as much of that mana instead.',
      keywords: [],
      cmc: 6,
    },
    tags: ['ramp'],
    expect: {
      roles: {
        ramp: 'P static static',
      },
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '6c5b02eb-7829-436a-8555-fea200e4b67f',
      name: 'Oracle of Mul Daya',
      layout: 'normal',
      type_line: 'Creature — Elf Shaman',
      mana_cost: '{3}{G}',
      oracle_text:
        'You may play an additional land on each of your turns.\nPlay with the top card of your library revealed.\nYou may play lands from the top of your library.',
      keywords: [],
      power: '2',
      toughness: '2',
      cmc: 4,
    },
    tags: ['ramp', 'card-advantage'],
    expect: {
      roles: {
        ramp: 'P static static',
        cardDraw: 'S static static',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '81f06f84-1580-43c0-89d5-08d34541a519',
      name: 'Goblin Electromancer',
      layout: 'normal',
      type_line: 'Creature — Goblin Wizard',
      mana_cost: '{U}{R}',
      oracle_text: 'Instant and sorcery spells you cast cost {1} less to cast.',
      keywords: [],
      power: '2',
      toughness: '2',
      cmc: 2,
    },
    tags: ['cost-reducer'],
    expect: {
      roles: {
        ramp: 'P static static',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'c02c5547-b9c9-4b2d-9d12-e87bfba8f2d2',
      name: "Herald's Horn",
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{3}',
      oracle_text:
        "As this artifact enters, choose a creature type.\nCreature spells you cast of the chosen type cost {1} less to cast.\nAt the beginning of your upkeep, look at the top card of your library. If it's a creature card of the chosen type, you may reveal it and put it into your hand.",
      keywords: [],
      cmc: 3,
    },
    tags: ['cost-reducer', 'card-advantage'],
    expect: {
      roles: {
        ramp: 'P static static',
        cardDraw: 'S triggered per-turn',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '53236dd7-845a-444c-96d5-f41ed7325d8f',
      name: 'Rhystic Study',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{2}{U}',
      oracle_text:
        'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
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
      oracle_id: '8a52f3c0-2552-4425-b2e3-5496eb2232a7',
      name: 'Mystic Remora',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{U}',
      oracle_text:
        'Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nWhenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.',
      keywords: ['Cumulative upkeep'],
      cmc: 1,
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
      oracle_id: 'ee579a32-a048-4335-b966-231ba731cdea',
      name: 'Phyrexian Arena',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{1}{B}{B}',
      oracle_text: 'At the beginning of your upkeep, you draw a card and lose 1 life.',
      keywords: [],
      cmc: 3,
    },
    tags: ['card-advantage', 'draw'],
    expect: {
      roles: {
        cardDraw: 'P triggered per-turn',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '7eff84f1-f772-497a-b350-bbc93d0230f7',
      name: 'Harmonize',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{G}{G}',
      oracle_text: 'Draw three cards.',
      keywords: [],
      cmc: 4,
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
      oracle_id: '7ffae8f8-3006-4969-a339-6d30678f87ea',
      name: "Night's Whisper",
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{1}{B}',
      oracle_text: 'You draw two cards and lose 2 life.',
      keywords: [],
      cmc: 2,
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
      oracle_id: '24d0f5e7-0d9e-4b76-900e-a7274e80312d',
      name: 'Mulldrifter',
      layout: 'normal',
      type_line: 'Creature — Elemental',
      mana_cost: '{4}{U}',
      oracle_text:
        "Flying\nWhen this creature enters, draw two cards.\nEvoke {2}{U} (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)",
      keywords: ['Flying', 'Evoke'],
      power: '2',
      toughness: '2',
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
      oracle_id: '5def9f38-0a0b-4e8d-9f9d-29dcb46520b4',
      name: 'Esper Sentinel',
      layout: 'normal',
      type_line: 'Artifact Creature — Human Soldier',
      mana_cost: '{W}',
      oracle_text:
        "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power.",
      keywords: [],
      power: '1',
      toughness: '1',
      cmc: 1,
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
      oracle_id: '5da7eea8-bb9e-47ce-a554-8a1ee058bd7a',
      name: 'Beast Whisperer',
      layout: 'normal',
      type_line: 'Creature — Elf Druid',
      mana_cost: '{2}{G}{G}',
      oracle_text: 'Whenever you cast a creature spell, draw a card.',
      keywords: [],
      power: '2',
      toughness: '3',
      cmc: 4,
    },
    tags: ['card-advantage', 'draw'],
    expect: {
      roles: {
        cardDraw: 'P triggered per-event',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: ['cast-creature'],
    },
  },
  {
    card: {
      oracle_id: '4f9e07ae-6341-4b46-9f77-f17ab659d266',
      name: 'Guardian Project',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{3}{G}',
      oracle_text:
        "Whenever a nontoken creature you control enters, if it doesn't have the same name as another creature you control or a creature card in your graveyard, draw a card.",
      keywords: [],
      cmc: 4,
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
      oracle_id: '92eed395-62ca-4293-882b-8565c40daab5',
      name: 'Sylvan Library',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{1}{G}',
      oracle_text:
        'At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.',
      keywords: [],
      cmc: 2,
    },
    tags: ['card-advantage', 'draw'],
    expect: {
      roles: {
        cardDraw: 'P triggered per-turn',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '02090581-61aa-4348-ad57-451be8ee91c2',
      name: 'Ponder',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{U}',
      oracle_text:
        'Look at the top three cards of your library, then put them back in any order. You may shuffle.\nDraw a card.',
      keywords: [],
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
      oracle_id: 'ac641490-ca14-48d7-8cc4-b69ce984befa',
      name: 'Preordain',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{U}',
      oracle_text:
        'Scry 2, then draw a card. (To scry 2, look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)',
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
      oracle_id: '713332c1-5bd8-400f-bfff-c1ca0697a043',
      name: 'Opt',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{U}',
      oracle_text:
        'Scry 1. (Look at the top card of your library. You may put that card on the bottom.)\nDraw a card.',
      keywords: ['Scry'],
      cmc: 1,
    },
    tags: ['card-advantage', 'draw', 'cantrip'],
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
      oracle_id: '3d6fa57a-aa53-4b5c-b8af-a7612c823117',
      name: 'Faithless Looting',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{R}',
      oracle_text:
        'Draw two cards, then discard two cards.\nFlashback {2}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
      keywords: ['Flashback'],
      cmc: 1,
    },
    tags: ['card-advantage', 'draw'],
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
      oracle_id: '08becc07-28bc-4a2f-a6b0-28a2998d2f50',
      name: 'Windfall',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{U}',
      oracle_text:
        'Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.',
      keywords: [],
      cmc: 3,
    },
    tags: ['card-advantage', 'draw', 'wheel'],
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
      oracle_id: '0fd114c4-092b-4e28-b0dc-ef529f3bc73e',
      name: "Jeska's Will",
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{R}',
      oracle_text:
        "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Add {R} for each card in target opponent's hand.\n• Exile the top three cards of your library. You may play them this turn.",
      keywords: [],
      cmc: 3,
    },
    tags: ['ramp', 'card-advantage'],
    expect: {
      roles: {
        ramp: 'P sorcery once',
        cardDraw: 'P sorcery once',
      },
      interaction: [],
      produces: ['cards', 'mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '8d286376-f386-43ab-a9bd-8478fb9e2497',
      name: 'Light Up the Stage',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{R}',
      oracle_text:
        'Spectacle {R} (You may cast this spell for its spectacle cost rather than its mana cost if an opponent lost life this turn.)\nExile the top two cards of your library. Until the end of your next turn, you may play those cards.',
      keywords: ['Spectacle'],
      cmc: 3,
    },
    tags: ['card-advantage'],
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
      oracle_id: '180eda7c-fca2-403b-85cd-8ffebaf9f408',
      name: 'Palace Jailer',
      layout: 'normal',
      type_line: 'Creature — Human Soldier',
      mana_cost: '{2}{W}{W}',
      oracle_text:
        'When this creature enters, you become the monarch.\nWhen this creature enters, exile target creature an opponent controls until an opponent becomes the monarch.',
      keywords: [],
      power: '2',
      toughness: '2',
      cmc: 4,
    },
    tags: ['removal', 'spot-removal', 'card-advantage', 'draw'],
    expect: {
      roles: {
        cardDraw: 'P sorcery once',
        removal: 'P sorcery once',
      },
      interaction: ['exile creature single opponents'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'e6555cca-e608-4c87-b835-9cd47fd1f543',
      name: 'Tireless Tracker',
      layout: 'normal',
      type_line: 'Creature — Human Scout',
      mana_cost: '{2}{G}',
      oracle_text:
        'Landfall — Whenever a land you control enters, investigate. (Create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")\nWhenever you sacrifice a Clue, put a +1/+1 counter on this creature.',
      keywords: ['Investigate', 'Landfall'],
      power: '3',
      toughness: '2',
      cmc: 3,
    },
    tags: ['card-advantage', 'draw'],
    expect: {
      roles: {
        cardDraw: 'P triggered per-event',
      },
      interaction: [],
      produces: ['clue'],
      payoffs: ['clue'],
    },
  },
  {
    card: {
      oracle_id: '437b2dab-15e0-4b9a-a204-58622d37a3b3',
      name: 'Fact or Fiction',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{3}{U}',
      oracle_text:
        'Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.',
      keywords: [],
      cmc: 4,
    },
    tags: ['card-advantage'],
    expect: {
      roles: {
        cardDraw: 'P instant once',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '65986c1b-8e51-4604-b685-d82fa7d1263a',
      name: 'Skullclamp',
      layout: 'normal',
      type_line: 'Artifact — Equipment',
      mana_cost: '{1}',
      oracle_text:
        'Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}',
      keywords: ['Equip'],
      cmc: 1,
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
      oracle_id: '2068185c-1b50-47d0-aa3f-bf505d199428',
      name: 'Dark Confidant',
      layout: 'normal',
      type_line: 'Creature — Human Wizard',
      mana_cost: '{1}{B}',
      oracle_text:
        'At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.',
      keywords: [],
      power: '2',
      toughness: '1',
      cmc: 2,
    },
    tags: ['card-advantage'],
    expect: {
      roles: {
        cardDraw: 'P triggered per-turn',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '311a449d-dc74-46e6-9a47-6a597931f736',
      name: 'Consecrated Sphinx',
      layout: 'normal',
      type_line: 'Creature — Sphinx',
      mana_cost: '{4}{U}{U}',
      oracle_text: 'Flying\nWhenever an opponent draws a card, you may draw two cards.',
      keywords: ['Flying'],
      power: '4',
      toughness: '6',
      cmc: 6,
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
      oracle_id: '69facbc7-3859-4716-b627-5199571fb3cf',
      name: 'Chasm Skulker',
      layout: 'normal',
      type_line: 'Creature — Squid Horror',
      mana_cost: '{2}{U}',
      oracle_text:
        "Whenever you draw a card, put a +1/+1 counter on this creature.\nWhen this creature dies, create X 1/1 blue Squid creature tokens with islandwalk, where X is the number of +1/+1 counters on this creature. (They can't be blocked as long as defending player controls an Island.)",
      keywords: [],
      power: '1',
      toughness: '1',
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: ['cards'],
    },
  },
  {
    card: {
      oracle_id: 'f6bd2902-7f8b-419e-bbc7-bcab0c1b7e01',
      name: 'Impulse',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{U}',
      oracle_text:
        'Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.',
      keywords: [],
      cmc: 2,
    },
    tags: ['card-advantage'],
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
      oracle_id: '0715e860-3b3b-4331-9718-207973e94fee',
      name: 'Tatyova, Benthic Druid',
      layout: 'normal',
      type_line: 'Legendary Creature — Merfolk Druid',
      mana_cost: '{3}{G}{U}',
      oracle_text:
        'Landfall — Whenever a land you control enters, you gain 1 life and draw a card.',
      keywords: ['Landfall'],
      power: '3',
      toughness: '3',
      cmc: 5,
    },
    tags: ['card-advantage', 'draw', 'lifegain'],
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
      oracle_id: '82004860-e589-4e38-8d61-8c0210e4ea39',
      name: 'Demonic Tutor',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{1}{B}',
      oracle_text: 'Search your library for a card, put that card into your hand, then shuffle.',
      keywords: [],
      cmc: 2,
    },
    tags: ['tutor'],
    expect: {
      roles: {
        tutor: 'P sorcery once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'ededbdae-d9dc-4206-9335-d7158f2d7700',
      name: 'Vampiric Tutor',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{B}',
      oracle_text:
        'Search your library for a card, then shuffle and put that card on top. You lose 2 life.',
      keywords: [],
      cmc: 1,
    },
    tags: ['tutor'],
    expect: {
      roles: {
        tutor: 'P instant once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'c5229c17-b7be-4b05-b683-f2277edc4849',
      name: 'Enlightened Tutor',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{W}',
      oracle_text:
        'Search your library for an artifact or enchantment card, reveal it, then shuffle and put that card on top.',
      keywords: [],
      cmc: 1,
    },
    tags: ['tutor'],
    expect: {
      roles: {
        tutor: 'P instant once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'fb81f95c-70f8-4eb7-8d15-15d0ae23ec03',
      name: 'Mystical Tutor',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{U}',
      oracle_text:
        'Search your library for an instant or sorcery card, reveal it, then shuffle and put that card on top.',
      keywords: [],
      cmc: 1,
    },
    tags: ['tutor'],
    expect: {
      roles: {
        tutor: 'P instant once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'e8863518-0bfa-49c3-8c6e-6c9116a81051',
      name: 'Worldly Tutor',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{G}',
      oracle_text:
        'Search your library for a creature card, reveal it, then shuffle and put the card on top.',
      keywords: [],
      cmc: 1,
    },
    tags: ['tutor'],
    expect: {
      roles: {
        tutor: 'P instant once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '038519b9-bca8-4b27-b5ac-2409595469d0',
      name: 'Diabolic Intent',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{1}{B}',
      oracle_text:
        'As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a card, put that card into your hand, then shuffle.',
      keywords: [],
      cmc: 2,
    },
    tags: ['tutor', 'sacrifice'],
    expect: {
      roles: {
        tutor: 'P sorcery once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '0d96b60b-a060-48ee-bb83-93f1c4a10669',
      name: "Green Sun's Zenith",
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{X}{G}',
      oracle_text:
        "Search your library for a green creature card with mana value X or less, put it onto the battlefield, then shuffle. Shuffle Green Sun's Zenith into its owner's library.",
      keywords: [],
      cmc: 1,
    },
    tags: ['tutor'],
    expect: {
      roles: {
        tutor: 'P sorcery once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '6789a170-f2c5-4fc0-8a45-2b2361e67410',
      name: 'Chord of Calling',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{X}{G}{G}{G}',
      oracle_text:
        "Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\nSearch your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.",
      keywords: ['Convoke'],
      cmc: 3,
    },
    tags: ['tutor'],
    expect: {
      roles: {
        tutor: 'P instant once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '69872a9a-fe54-4e58-940c-89395af71acd',
      name: 'Finale of Devastation',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{X}{G}{G}',
      oracle_text:
        'Search your library and/or graveyard for a creature card with mana value X or less and put it onto the battlefield. If you search your library this way, shuffle. If X is 10 or more, creatures you control get +X/+X and gain haste until end of turn.',
      keywords: [],
      cmc: 2,
    },
    tags: ['tutor'],
    expect: {
      roles: {
        tutor: 'P sorcery once',
        recursion: 'S sorcery once',
        finisher: 'S sorcery once',
      },
      interaction: [],
      produces: ['gy-to-battlefield'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '358789f9-7d87-411d-919e-d597da665cbd',
      name: 'Stoneforge Mystic',
      layout: 'normal',
      type_line: 'Creature — Kor Artificer',
      mana_cost: '{1}{W}',
      oracle_text:
        'When this creature enters, you may search your library for an Equipment card, reveal it, put it into your hand, then shuffle.\n{1}{W}, {T}: You may put an Equipment card from your hand onto the battlefield.',
      keywords: [],
      power: '1',
      toughness: '2',
      cmc: 2,
    },
    tags: ['tutor'],
    expect: {
      roles: {
        tutor: 'P sorcery once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '8fcf50cd-e6d0-4516-850f-d42ee75dcc3a',
      name: 'Expedition Map',
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{1}',
      oracle_text:
        '{2}, {T}, Sacrifice this artifact: Search your library for a land card, reveal it, put it into your hand, then shuffle.',
      keywords: [],
      cmc: 1,
    },
    tags: ['tutor', 'land-tutor'],
    expect: {
      roles: {
        tutor: 'I activated once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '299fc083-0834-4064-8344-f895aff68867',
      name: 'Entomb',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{B}',
      oracle_text:
        'Search your library for a card, put that card into your graveyard, then shuffle.',
      keywords: [],
      cmc: 1,
    },
    tags: ['tutor'],
    expect: {
      roles: {
        tutor: 'P instant once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '0826cf7d-7ccc-459b-a92f-29dc169628f8',
      name: 'Muddle the Mixture',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{U}{U}',
      oracle_text:
        'Counter target instant or sorcery spell.\nTransmute {1}{U}{U} ({1}{U}{U}, Discard this card: Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle. Transmute only as a sorcery.)',
      keywords: ['Transmute'],
      cmc: 2,
    },
    tags: ['counterspell', 'tutor'],
    expect: {
      roles: {
        counterspell: 'P instant once',
        tutor: 'S sorcery once',
      },
      interaction: ['counter instant-sorcery-spell single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '24882fa2-3fe9-4c1b-aa3d-0e6488b9db27',
      name: 'Heroic Intervention',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{G}',
      oracle_text: 'Permanents you control gain hexproof and indestructible until end of turn.',
      keywords: [],
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
      oracle_id: '0d4ecdb1-ec90-497f-a7a4-1c68092b8757',
      name: "Teferi's Protection",
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{2}{W}',
      oracle_text:
        "Until your next turn, your life total can't change and you gain protection from everything. All permanents you control phase out. (While they're phased out, they're treated as though they don't exist. They phase in before you untap during your untap step.)\nExile Teferi's Protection.",
      keywords: [],
      cmc: 3,
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
      oracle_id: 'ca204b66-8d0c-431a-8d34-282f7c2d17da',
      name: 'Lightning Greaves',
      layout: 'normal',
      type_line: 'Artifact — Equipment',
      mana_cost: '{2}',
      oracle_text:
        "Equipped creature has haste and shroud. (It can't be the target of spells or abilities.)\nEquip {0}",
      keywords: ['Equip'],
      cmc: 2,
    },
    tags: ['protection'],
    expect: {
      roles: {
        protection: 'P static static',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'c8b143ad-43ec-4e0d-a440-e348daa31391',
      name: 'Swiftfoot Boots',
      layout: 'normal',
      type_line: 'Artifact — Equipment',
      mana_cost: '{2}',
      oracle_text:
        "Equipped creature has hexproof and haste. (It can't be the target of spells or abilities your opponents control. It can attack and {T} no matter when it came under your control.)\nEquip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)",
      keywords: ['Equip'],
      cmc: 2,
    },
    tags: ['protection'],
    expect: {
      roles: {
        protection: 'P static static',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '60433b48-d27f-413c-905c-43839b1943f1',
      name: 'Mother of Runes',
      layout: 'normal',
      type_line: 'Creature — Human Cleric',
      mana_cost: '{W}',
      oracle_text:
        '{T}: Target creature you control gains protection from the color of your choice until end of turn.',
      keywords: [],
      power: '1',
      toughness: '1',
      cmc: 1,
    },
    tags: ['protection'],
    expect: {
      roles: {
        protection: 'P activated per-turn',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '4e183439-17d2-47ff-9d99-5e22821d91e3',
      name: 'Flawless Maneuver',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{2}{W}',
      oracle_text:
        'If you control a commander, you may cast this spell without paying its mana cost.\nCreatures you control gain indestructible until end of turn.',
      keywords: [],
      cmc: 3,
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
      oracle_id: 'ae120613-97d6-4393-b39d-c3e6c076f5d6',
      name: 'Deflecting Swat',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{2}{R}',
      oracle_text:
        'If you control a commander, you may cast this spell without paying its mana cost.\nYou may choose new targets for target spell or ability.',
      keywords: [],
      cmc: 3,
    },
    tags: [],
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
      oracle_id: '2679d0dd-ba30-4a1c-b6a0-b3ac6c790496',
      name: 'Boros Charm',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{R}{W}',
      oracle_text:
        'Choose one —\n• Boros Charm deals 4 damage to target player or planeswalker.\n• Permanents you control gain indestructible until end of turn.\n• Target creature gains double strike until end of turn.',
      keywords: [],
      cmc: 2,
    },
    tags: ['removal', 'spot-removal', 'protection'],
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
      oracle_id: '216cb26e-8da9-478b-bfbc-8030f7adee72',
      name: 'Avacyn, Angel of Hope',
      layout: 'normal',
      type_line: 'Legendary Creature — Angel',
      mana_cost: '{5}{W}{W}{W}',
      oracle_text:
        'Flying, vigilance, indestructible\nOther permanents you control have indestructible.',
      keywords: ['Flying', 'Indestructible', 'Vigilance'],
      power: '8',
      toughness: '8',
      cmc: 8,
    },
    tags: ['protection'],
    expect: {
      roles: {
        protection: 'P static static',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '30b24e8e-3b0e-4d8e-90f3-f66eb7c1858c',
      name: 'Eternal Witness',
      layout: 'normal',
      type_line: 'Creature — Human Shaman',
      mana_cost: '{1}{G}{G}',
      oracle_text:
        'When this creature enters, you may return target card from your graveyard to your hand.',
      keywords: [],
      power: '2',
      toughness: '1',
      cmc: 3,
    },
    tags: ['card-advantage'],
    expect: {
      roles: {
        recursion: 'P sorcery once',
      },
      interaction: [],
      produces: ['gy-to-hand'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'e6e4a8bd-5c40-4654-8de1-0da9afed90fd',
      name: 'Regrowth',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{1}{G}',
      oracle_text: 'Return target card from your graveyard to your hand.',
      keywords: [],
      cmc: 2,
    },
    tags: ['card-advantage'],
    expect: {
      roles: {
        recursion: 'P sorcery once',
      },
      interaction: [],
      produces: ['gy-to-hand'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'a044474a-cd72-4e9d-bd8d-a08f2de9cdc0',
      name: 'Reanimate',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{B}',
      oracle_text:
        "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value.",
      keywords: [],
      cmc: 1,
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
      oracle_id: 'c0d8fef4-65f4-4769-982d-b397d2b7e977',
      name: 'Animate Dead',
      layout: 'normal',
      type_line: 'Enchantment — Aura',
      mana_cost: '{1}{B}',
      oracle_text:
        'Enchant creature card in a graveyard\nWhen this Aura enters, if it\'s on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with this Aura." Return enchanted creature card to the battlefield under your control and attach this Aura to it. When this Aura leaves the battlefield, that creature\'s controller sacrifices it.\nEnchanted creature gets -1/-0.',
      keywords: ['Enchant'],
      cmc: 2,
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
      oracle_id: 'b2e950fb-cb7e-40a0-a311-5bbdd0477b29',
      name: 'Sun Titan',
      layout: 'normal',
      type_line: 'Creature — Giant',
      mana_cost: '{4}{W}{W}',
      oracle_text:
        'Vigilance\nWhenever this creature enters or attacks, you may return target permanent card with mana value 3 or less from your graveyard to the battlefield.',
      keywords: ['Vigilance'],
      power: '6',
      toughness: '6',
      cmc: 6,
    },
    tags: ['ramp'],
    expect: {
      roles: {
        recursion: 'P triggered per-event',
      },
      interaction: [],
      produces: ['gy-to-battlefield'],
      payoffs: ['attack'],
    },
  },
  {
    card: {
      oracle_id: 'a91a3266-cadd-47a0-9b20-160307f14c07',
      name: 'Archaeomancer',
      layout: 'normal',
      type_line: 'Creature — Human Wizard',
      mana_cost: '{2}{U}{U}',
      oracle_text:
        'When this creature enters, return target instant or sorcery card from your graveyard to your hand.',
      keywords: [],
      power: '1',
      toughness: '2',
      cmc: 4,
    },
    tags: ['card-advantage'],
    expect: {
      roles: {
        recursion: 'P sorcery once',
      },
      interaction: [],
      produces: ['gy-to-hand'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '2bb2eda7-3b38-4c56-870f-c3218a1056f5',
      name: 'Snapcaster Mage',
      layout: 'normal',
      type_line: 'Creature — Human Wizard',
      mana_cost: '{1}{U}',
      oracle_text:
        'Flash\nWhen this creature enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost. (You may cast that card from your graveyard for its flashback cost. Then exile it.)',
      keywords: ['Flash'],
      power: '2',
      toughness: '1',
      cmc: 2,
    },
    tags: [],
    expect: {
      roles: {
        recursion: 'P flash once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '0310dfdb-0498-488d-9f1a-279f8239e024',
      name: 'Meren of Clan Nel Toth',
      layout: 'normal',
      type_line: 'Legendary Creature — Human Shaman',
      mana_cost: '{2}{B}{G}',
      oracle_text:
        "Whenever another creature you control dies, you get an experience counter.\nAt the beginning of your end step, choose target creature card in your graveyard. If that card's mana value is less than or equal to the number of experience counters you have, return it to the battlefield. Otherwise, put it into your hand.",
      keywords: [],
      power: '3',
      toughness: '4',
      cmc: 4,
    },
    tags: ['card-advantage'],
    expect: {
      roles: {
        recursion: 'P triggered per-turn',
        cardDraw: 'S triggered per-turn',
      },
      interaction: [],
      produces: ['gy-to-battlefield', 'gy-to-hand', 'other-counter'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'e4625704-1d52-44e4-804f-2f45644d76ac',
      name: 'Muldrotha, the Gravetide',
      layout: 'normal',
      type_line: 'Legendary Creature — Elemental Avatar',
      mana_cost: '{3}{B}{G}{U}',
      oracle_text:
        'During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard. (If a card has multiple permanent types, choose one as you play it.)',
      keywords: [],
      power: '6',
      toughness: '6',
      cmc: 6,
    },
    tags: [],
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
      oracle_id: '4f819ba4-52ef-4fdd-8e4c-5ae3b2f44db5',
      name: 'Ramunap Excavator',
      layout: 'normal',
      type_line: 'Creature — Snake Cleric',
      mana_cost: '{2}{G}',
      oracle_text: 'You may play lands from your graveyard.',
      keywords: [],
      power: '2',
      toughness: '3',
      cmc: 3,
    },
    tags: [],
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
      oracle_id: '8c52bd39-0586-48ca-b263-17210cf9feb6',
      name: 'Craterhoof Behemoth',
      layout: 'normal',
      type_line: 'Creature — Beast',
      mana_cost: '{5}{G}{G}{G}',
      oracle_text:
        'Haste\nWhen this creature enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.',
      keywords: ['Haste'],
      power: '5',
      toughness: '5',
      cmc: 8,
    },
    tags: [],
    expect: {
      roles: {
        finisher: 'P sorcery once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '204f9afe-c20b-4933-b5cd-aa572784762a',
      name: 'Overrun',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{G}{G}{G}',
      oracle_text:
        "Creatures you control get +3/+3 and gain trample until end of turn. (Each of those creatures can deal excess combat damage to the player or planeswalker it's attacking.)",
      keywords: [],
      cmc: 5,
    },
    tags: [],
    expect: {
      roles: {
        finisher: 'P sorcery once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '1de1b591-a73f-4974-b507-8c63e07a0868',
      name: "Thassa's Oracle",
      layout: 'normal',
      type_line: 'Creature — Merfolk Wizard',
      mana_cost: '{U}{U}',
      oracle_text:
        'When this creature enters, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game. (Each {U} in the mana costs of permanents you control counts toward your devotion to blue.)',
      keywords: [],
      power: '1',
      toughness: '3',
      cmc: 2,
    },
    tags: ['card-advantage'],
    expect: {
      roles: {
        finisher: 'P sorcery once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'aa286dd5-aa19-446d-9003-684d81eb57ca',
      name: 'Laboratory Maniac',
      layout: 'normal',
      type_line: 'Creature — Human Wizard',
      mana_cost: '{2}{U}',
      oracle_text:
        'If you would draw a card while your library has no cards in it, you win the game instead.',
      keywords: [],
      power: '2',
      toughness: '2',
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {
        finisher: 'P static static',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'e4125377-34c0-4b54-bdf8-4e88f5d24565',
      name: 'Approach of the Second Sun',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{6}{W}',
      oracle_text:
        "If this spell was cast from your hand and you've cast another spell named Approach of the Second Sun this game, you win the game. Otherwise, put Approach of the Second Sun into its owner's library seventh from the top and you gain 7 life.",
      keywords: [],
      cmc: 7,
    },
    tags: ['lifegain'],
    expect: {
      roles: {
        finisher: 'P sorcery once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '8164b1e8-3350-465e-8a17-75f57d326344',
      name: 'Exsanguinate',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{X}{B}{B}',
      oracle_text: 'Each opponent loses X life. You gain life equal to the life lost this way.',
      keywords: [],
      cmc: 2,
    },
    tags: ['lifegain'],
    expect: {
      roles: {
        finisher: 'P sorcery once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '7f7c204f-be1a-47e4-91c6-ba6f906d9012',
      name: 'Insurrection',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{5}{R}{R}{R}',
      oracle_text:
        'Untap all creatures and gain control of them until end of turn. They gain haste until end of turn.',
      keywords: [],
      cmc: 8,
    },
    tags: [],
    expect: {
      roles: {
        finisher: 'P sorcery once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '20129459-a386-41eb-899d-1aede3427300',
      name: 'Aggravated Assault',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{2}{R}',
      oracle_text:
        '{3}{R}{R}: Untap all creatures you control. After this main phase, there is an additional combat phase followed by an additional main phase. Activate only as a sorcery.',
      keywords: [],
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {
        finisher: 'P sorcery repeatable',
      },
      interaction: [],
      produces: ['extra-combat', 'untap'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '83b43aba-bf9c-4da2-967d-9daa632e97d2',
      name: 'Helm of the Host',
      layout: 'normal',
      type_line: 'Legendary Artifact — Equipment',
      mana_cost: '{4}',
      oracle_text:
        "At the beginning of combat on your turn, create a token that's a copy of equipped creature, except the token isn't legendary. That token gains haste.\nEquip {5}",
      keywords: ['Equip'],
      cmc: 4,
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
      oracle_id: 'cc3fcd26-c088-4335-9a35-0e11019e3d5b',
      name: 'Revel in Riches',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{4}{B}',
      oracle_text:
        'Whenever a creature an opponent controls dies, create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")\nAt the beginning of your upkeep, if you control ten or more Treasures, you win the game.',
      keywords: ['Treasure'],
      cmc: 5,
    },
    tags: ['ramp'],
    expect: {
      roles: {
        finisher: 'P triggered per-turn',
        ramp: 'S triggered per-event',
      },
      interaction: [],
      produces: ['treasure'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '11b5308d-5bc0-4782-875f-a28be36e665d',
      name: 'Beastmaster Ascension',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{2}{G}',
      oracle_text:
        'Whenever a creature you control attacks, you may put a quest counter on this enchantment.\nAs long as this enchantment has seven or more quest counters on it, creatures you control get +5/+5.',
      keywords: [],
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {
        finisher: 'P static static',
      },
      interaction: [],
      produces: ['other-counter'],
      payoffs: ['attack'],
    },
  },
  {
    card: {
      oracle_id: '087f9ad7-e74f-40e2-8102-1ed2925d0418',
      name: 'Rest in Peace',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{1}{W}',
      oracle_text:
        'When this enchantment enters, exile all graveyards.\nIf a card or token would be put into a graveyard from anywhere, exile it instead.',
      keywords: [],
      cmc: 2,
    },
    tags: ['graveyard-hate'],
    expect: {
      roles: {
        graveyardHate: 'P sorcery once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '04b7362d-0490-4cb0-b5d7-2a7732f659ce',
      name: 'Bojuka Bog',
      layout: 'normal',
      type_line: 'Land',
      mana_cost: '',
      oracle_text:
        "This land enters tapped.\nWhen this land enters, exile target player's graveyard.\n{T}: Add {B}.",
      keywords: [],
      cmc: 0,
    },
    tags: ['graveyard-hate', 'utility-land', 'tapland'],
    expect: {
      roles: {
        graveyardHate: 'S sorcery once',
      },
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '6a9c3401-570c-41cb-a605-75dfa57d6ab7',
      name: 'Relic of Progenitus',
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{1}',
      oracle_text:
        '{T}: Target player exiles a card from their graveyard.\n{1}, Exile this artifact: Exile all graveyards. Draw a card.',
      keywords: [],
      cmc: 1,
    },
    tags: ['card-advantage', 'draw', 'graveyard-hate'],
    expect: {
      roles: {
        graveyardHate: 'P activated per-turn',
        cardDraw: 'I activated once',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '1573f7f9-672c-421a-b1ac-3d0d8aea59ca',
      name: "Tormod's Crypt",
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{0}',
      oracle_text: "{T}, Sacrifice this artifact: Exile target player's graveyard.",
      keywords: [],
      cmc: 0,
    },
    tags: ['graveyard-hate'],
    expect: {
      roles: {
        graveyardHate: 'P activated once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '1ff25f67-36a7-4cfa-a2b1-2135b5b6fb67',
      name: 'Scavenging Ooze',
      layout: 'normal',
      type_line: 'Creature — Ooze',
      mana_cost: '{1}{G}',
      oracle_text:
        '{G}: Exile target card from a graveyard. If it was a creature card, put a +1/+1 counter on this creature and you gain 1 life.',
      keywords: [],
      power: '2',
      toughness: '2',
      cmc: 2,
    },
    tags: ['lifegain', 'graveyard-hate'],
    expect: {
      roles: {
        graveyardHate: 'P activated repeatable',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '310f141c-7f37-4729-aed6-dd9c09db448d',
      name: 'Blood Artist',
      layout: 'normal',
      type_line: 'Creature — Vampire',
      mana_cost: '{1}{B}',
      oracle_text:
        'Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life.',
      keywords: [],
      power: '0',
      toughness: '1',
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
      oracle_id: '76b003e0-15af-4f22-bdf2-1ade5430964a',
      name: 'Zulaport Cutthroat',
      layout: 'normal',
      type_line: 'Creature — Human Rogue Ally',
      mana_cost: '{1}{B}',
      oracle_text:
        'Whenever this creature or another creature you control dies, each opponent loses 1 life and you gain 1 life.',
      keywords: [],
      power: '1',
      toughness: '1',
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
      oracle_id: 'a784481f-eccb-4112-bb38-04a659319660',
      name: 'Pitiless Plunderer',
      layout: 'normal',
      type_line: 'Creature — Human Pirate',
      mana_cost: '{3}{B}',
      oracle_text:
        'Whenever another creature you control dies, create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
      keywords: ['Treasure'],
      power: '1',
      toughness: '4',
      cmc: 4,
    },
    tags: ['ramp'],
    expect: {
      roles: {
        ramp: 'P triggered per-event',
      },
      interaction: [],
      produces: ['treasure'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'f36d1d8b-8303-44a9-ab56-531931641ea2',
      name: 'Academy Manufactor',
      layout: 'normal',
      type_line: 'Artifact Creature — Assembly-Worker',
      mana_cost: '{3}',
      oracle_text:
        'If you would create a Clue, Food, or Treasure token, instead create one of each.',
      keywords: ['Treasure', 'Food'],
      power: '1',
      toughness: '3',
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: ['clue', 'food', 'treasure'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '457af74a-02b3-4659-846d-63e482667f34',
      name: 'Deadly Dispute',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{B}',
      oracle_text:
        'As an additional cost to cast this spell, sacrifice an artifact or creature.\nDraw two cards and create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
      keywords: ['Treasure'],
      cmc: 2,
    },
    tags: ['ramp', 'card-advantage', 'draw', 'sacrifice'],
    expect: {
      roles: {
        cardDraw: 'P instant once',
        ramp: 'I instant once',
      },
      interaction: [],
      produces: ['cards', 'treasure'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '5fac139a-07d3-4e6c-98e3-d98b199f7a6f',
      name: 'Young Pyromancer',
      layout: 'normal',
      type_line: 'Creature — Human Shaman',
      mana_cost: '{1}{R}',
      oracle_text:
        'Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.',
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
      oracle_id: '3979067a-9c68-443d-a85f-d9f07be880b9',
      name: 'Monastery Mentor',
      layout: 'normal',
      type_line: 'Creature — Human Monk',
      mana_cost: '{2}{W}',
      oracle_text:
        'Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)\nWhenever you cast a noncreature spell, create a 1/1 white Monk creature token with prowess.',
      keywords: ['Prowess'],
      power: '2',
      toughness: '2',
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: ['cast-noncreature'],
    },
  },
  {
    card: {
      oracle_id: 'da46904c-8fb8-44c2-b2ab-775a1cc12ec3',
      name: 'Dramatic Reversal',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{U}',
      oracle_text: 'Untap all nonland permanents you control.',
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
      oracle_id: 'ddd649f4-dbaf-48ec-8ff7-95581257772d',
      name: 'Isochron Scepter',
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{2}',
      oracle_text:
        'Imprint — When this artifact enters, you may exile an instant card with mana value 2 or less from your hand.\n{2}, {T}: You may copy the exiled card. If you do, you may cast the copy without paying its mana cost.',
      keywords: ['Imprint'],
      cmc: 2,
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
      oracle_id: 'a1f55890-31c5-4ed4-a2cd-7a4a9f05f8ca',
      name: 'Reverberate',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{R}{R}',
      oracle_text: 'Copy target instant or sorcery spell. You may choose new targets for the copy.',
      keywords: [],
      cmc: 2,
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
      oracle_id: 'a34b7416-cfe3-4a1e-a8c1-a3056b747519',
      name: 'Kiki-Jiki, Mirror Breaker',
      layout: 'normal',
      type_line: 'Legendary Creature — Goblin Shaman',
      mana_cost: '{2}{R}{R}{R}',
      oracle_text:
        "Haste\n{T}: Create a token that's a copy of target nonlegendary creature you control, except it has haste. Sacrifice it at the beginning of the next end step.",
      keywords: ['Haste'],
      power: '2',
      toughness: '2',
      cmc: 5,
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
      oracle_id: 'a1f3da21-af6d-450e-bf0b-985d158418e6',
      name: 'Hardened Scales',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{G}',
      oracle_text:
        'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.',
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
      oracle_id: '605c1ee0-5e8a-4e0a-a99b-42a38873f822',
      name: 'Welcoming Vampire',
      layout: 'normal',
      type_line: 'Creature — Vampire',
      mana_cost: '{2}{W}',
      oracle_text:
        'Flying\nWhenever one or more other creatures you control with power 2 or less enter, draw a card. This ability triggers only once each turn.',
      keywords: ['Flying'],
      power: '2',
      toughness: '3',
      cmc: 3,
    },
    tags: ['card-advantage', 'draw'],
    expect: {
      roles: {
        cardDraw: 'P triggered per-turn',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '9242cd3e-1a71-4700-8182-9c1005616033',
      name: 'Impact Tremors',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{1}{R}',
      oracle_text:
        'Whenever a creature you control enters, this enchantment deals 1 damage to each opponent.',
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
      oracle_id: '4d18bcba-a346-445e-a182-6cc30b7e066d',
      name: "Ashnod's Altar",
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{3}',
      oracle_text: 'Sacrifice a creature: Add {C}{C}.',
      keywords: [],
      cmc: 3,
    },
    tags: ['ramp', 'mana-rock', 'sacrifice'],
    expect: {
      roles: {
        ramp: 'P activated repeatable',
      },
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '8d02b297-97c4-4379-9862-0a462400f66f',
      name: 'Phyrexian Altar',
      layout: 'normal',
      type_line: 'Artifact',
      mana_cost: '{3}',
      oracle_text: 'Sacrifice a creature: Add one mana of any color.',
      keywords: [],
      cmc: 3,
    },
    tags: ['ramp', 'mana-rock', 'sacrifice'],
    expect: {
      roles: {
        ramp: 'P activated repeatable',
      },
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'f82a4e85-526d-4456-b700-7760043a31be',
      name: 'Viscera Seer',
      layout: 'normal',
      type_line: 'Creature — Vampire Wizard',
      mana_cost: '{B}',
      oracle_text:
        'Sacrifice a creature: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)',
      keywords: ['Scry'],
      power: '1',
      toughness: '1',
      cmc: 1,
    },
    tags: ['sacrifice'],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '89738595-dafb-400a-bfba-91a53a37e717',
      name: 'Grim Hireling',
      layout: 'normal',
      type_line: 'Creature — Tiefling Rogue',
      mana_cost: '{3}{B}',
      oracle_text:
        'Whenever one or more creatures you control deal combat damage to a player, create two Treasure tokens.\n{B}, Sacrifice X Treasures: Target creature gets -X/-X until end of turn. Activate only as a sorcery.',
      keywords: ['Treasure'],
      power: '3',
      toughness: '2',
      cmc: 4,
    },
    tags: ['ramp', 'removal', 'spot-removal', 'sacrifice'],
    expect: {
      roles: {
        ramp: 'P triggered per-event',
        removal: 'S sorcery repeatable',
      },
      interaction: ['shrink creature single any'],
      produces: ['treasure'],
      payoffs: ['attack', 'treasure'],
    },
  },
  {
    card: {
      oracle_id: '04152e7a-969c-4858-841b-0a569a9fc1bf',
      name: 'Professional Face-Breaker',
      layout: 'normal',
      type_line: 'Creature — Human Warrior',
      mana_cost: '{2}{R}',
      oracle_text:
        'Menace\nWhenever one or more creatures you control deal combat damage to a player, create a Treasure token.\nSacrifice a Treasure: Exile the top card of your library. You may play that card this turn.',
      keywords: ['Treasure', 'Menace'],
      power: '2',
      toughness: '3',
      cmc: 3,
    },
    tags: ['ramp', 'card-advantage', 'sacrifice'],
    expect: {
      roles: {
        ramp: 'P triggered per-event',
        cardDraw: 'S activated repeatable',
      },
      interaction: [],
      produces: ['cards', 'treasure'],
      payoffs: ['attack', 'treasure'],
    },
  },
  {
    card: {
      oracle_id: 'ae92942b-919c-4ea9-b693-85fcef765d5a',
      name: 'Fire // Ice',
      layout: 'split',
      type_line: 'Instant // Instant',
      mana_cost: '{1}{R} // {1}{U}',
      keywords: [],
      cmc: 4,
      card_faces: [
        {
          name: 'Fire',
          type_line: 'Instant',
          mana_cost: '{1}{R}',
          oracle_text: 'Fire deals 2 damage divided as you choose among one or two targets.',
        },
        {
          name: 'Ice',
          type_line: 'Instant',
          mana_cost: '{1}{U}',
          oracle_text: 'Tap target permanent.\nDraw a card.',
        },
      ],
    },
    tags: ['removal', 'spot-removal', 'card-advantage', 'draw', 'cantrip'],
    expect: {
      roles: {
        removal: 'P instant once f0',
        cardDraw: 'I instant once f1',
      },
      interaction: ['damage battle|creature|planeswalker multi any f0'],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'd6d72f5f-8f5d-4180-b514-f22ff5482902',
      name: 'Bonecrusher Giant // Stomp',
      layout: 'adventure',
      type_line: 'Creature — Giant // Instant — Adventure',
      mana_cost: '{2}{R} // {1}{R}',
      keywords: [],
      power: '4',
      toughness: '3',
      cmc: 3,
      card_faces: [
        {
          name: 'Bonecrusher Giant',
          type_line: 'Creature — Giant',
          mana_cost: '{2}{R}',
          oracle_text:
            "Whenever this creature becomes the target of a spell, this creature deals 2 damage to that spell's controller.",
          power: '4',
          toughness: '3',
        },
        {
          name: 'Stomp',
          type_line: 'Instant — Adventure',
          mana_cost: '{1}{R}',
          oracle_text: "Damage can't be prevented this turn. Stomp deals 2 damage to any target.",
        },
      ],
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once f1',
      },
      interaction: ['damage battle|creature|planeswalker single any f1'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '053a69d8-2b5e-4f14-8b02-ca405891dc4a',
      name: 'Fell the Profane // Fell Mire',
      layout: 'modal_dfc',
      type_line: 'Instant // Land',
      keywords: [],
      cmc: 4,
      card_faces: [
        {
          name: 'Fell the Profane',
          type_line: 'Instant',
          mana_cost: '{2}{B}{B}',
          oracle_text: 'Destroy target creature or planeswalker.',
        },
        {
          name: 'Fell Mire',
          type_line: 'Land',
          mana_cost: '',
          oracle_text:
            "As this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {B}.",
        },
      ],
    },
    tags: ['removal', 'spot-removal', 'utility-land'],
    expect: {
      roles: {
        removal: 'P instant once f0',
      },
      interaction: ['destroy creature|planeswalker single any f0'],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'ff0ab867-b710-4b1a-baed-95fc3cf68f79',
      name: 'Valakut Awakening // Valakut Stoneforge',
      layout: 'modal_dfc',
      type_line: 'Instant // Land',
      keywords: [],
      cmc: 3,
      card_faces: [
        {
          name: 'Valakut Awakening',
          type_line: 'Instant',
          mana_cost: '{2}{R}',
          oracle_text:
            'Put any number of cards from your hand on the bottom of your library, then draw that many cards plus one.',
        },
        {
          name: 'Valakut Stoneforge',
          type_line: 'Land',
          mana_cost: '',
          oracle_text: 'This land enters tapped.\n{T}: Add {R}.',
        },
      ],
    },
    tags: ['card-advantage', 'draw', 'wheel', 'utility-land', 'tapland'],
    expect: {
      roles: {
        cardDraw: 'P instant once f0',
      },
      interaction: [],
      produces: ['cards', 'mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'edd531b9-f615-4399-8c8c-1c5e18c4acbf',
      name: 'Delver of Secrets // Insectile Aberration',
      layout: 'transform',
      type_line: 'Creature — Human Wizard // Creature — Human Insect',
      keywords: ['Flying', 'Transform'],
      cmc: 1,
      card_faces: [
        {
          name: 'Delver of Secrets',
          type_line: 'Creature — Human Wizard',
          mana_cost: '{U}',
          oracle_text:
            'At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform this creature.',
          power: '1',
          toughness: '1',
        },
        {
          name: 'Insectile Aberration',
          type_line: 'Creature — Human Insect',
          mana_cost: '',
          oracle_text: 'Flying',
          power: '3',
          toughness: '2',
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
      oracle_id: '0efb0d7e-dea0-4817-a243-15066e9ef333',
      name: 'Grist, the Hunger Tide',
      layout: 'normal',
      type_line: 'Legendary Planeswalker — Grist',
      mana_cost: '{1}{B}{G}',
      oracle_text:
        "As long as Grist isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types.\n+1: Create a 1/1 black and green Insect creature token, then mill a card. If an Insect card was milled this way, put a loyalty counter on Grist and repeat this process.\n−2: You may sacrifice a creature. When you do, destroy target creature or planeswalker.\n−5: Each opponent loses life equal to the number of creature cards in your graveyard.",
      keywords: ['Mill'],
      loyalty: '3',
      cmc: 3,
    },
    tags: ['removal', 'spot-removal', 'sacrifice'],
    expect: {
      roles: {
        removal: 'P sorcery per-turn',
        finisher: 'I sorcery per-turn',
      },
      interaction: ['destroy creature|planeswalker single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'f2f165b6-ef0a-42ad-9352-ba68be8248b0',
      name: 'Teferi, Hero of Dominaria',
      layout: 'normal',
      type_line: 'Legendary Planeswalker — Teferi',
      mana_cost: '{3}{W}{U}',
      oracle_text:
        '+1: Draw a card. At the beginning of the next end step, untap up to two lands.\n−3: Put target nonland permanent into its owner\'s library third from the top.\n−8: You get an emblem with "Whenever you draw a card, exile target permanent an opponent controls."',
      keywords: [],
      loyalty: '4',
      cmc: 5,
    },
    tags: ['ramp', 'removal', 'spot-removal', 'card-advantage', 'draw'],
    expect: {
      roles: {
        cardDraw: 'P sorcery per-turn',
        removal: 'S sorcery per-turn',
        ramp: 'I sorcery per-turn',
      },
      interaction: ['tuck nonland-permanent single any'],
      produces: ['cards', 'untap'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'eecb3047-a563-441a-9175-200421981ac3',
      name: 'Ugin, the Spirit Dragon',
      layout: 'normal',
      type_line: 'Legendary Planeswalker — Ugin',
      mana_cost: '{8}',
      oracle_text:
        "+2: Ugin deals 3 damage to any target.\n−X: Exile each permanent with mana value X or less that's one or more colors.\n−10: You gain 7 life, draw seven cards, then put up to seven permanent cards from your hand onto the battlefield.",
      keywords: [],
      loyalty: '7',
      cmc: 8,
    },
    tags: ['ramp', 'removal', 'spot-removal', 'boardwipe', 'card-advantage', 'draw', 'lifegain'],
    expect: {
      roles: {
        removal: 'P sorcery per-turn',
        boardwipe: 'S sorcery per-turn',
        cardDraw: 'I sorcery per-turn',
      },
      interaction: ['damage battle|creature|planeswalker single any', 'exile permanent mass all'],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'c7b044c3-3cfa-407e-bf20-2875e8e04b7b',
      name: 'Brazen Borrower // Petty Theft',
      layout: 'adventure',
      type_line: 'Creature — Faerie Rogue // Instant — Adventure',
      mana_cost: '{1}{U}{U} // {1}{U}',
      keywords: ['Flying', 'Flash'],
      power: '3',
      toughness: '1',
      cmc: 3,
      card_faces: [
        {
          name: 'Brazen Borrower',
          type_line: 'Creature — Faerie Rogue',
          mana_cost: '{1}{U}{U}',
          oracle_text: 'Flash\nFlying\nThis creature can block only creatures with flying.',
          power: '3',
          toughness: '1',
        },
        {
          name: 'Petty Theft',
          type_line: 'Instant — Adventure',
          mana_cost: '{1}{U}',
          oracle_text: "Return target nonland permanent an opponent controls to its owner's hand.",
        },
      ],
    },
    tags: ['removal', 'spot-removal', 'bounce'],
    expect: {
      roles: {
        removal: 'P instant once f1',
      },
      interaction: ['bounce nonland-permanent single opponents f1'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '6ec2a242-9068-4ee2-8ac8-8341cc570f56',
      name: "Emeria's Call // Emeria, Shattered Skyclave",
      layout: 'modal_dfc',
      type_line: 'Sorcery // Land',
      keywords: [],
      cmc: 7,
      card_faces: [
        {
          name: "Emeria's Call",
          type_line: 'Sorcery',
          mana_cost: '{4}{W}{W}{W}',
          oracle_text:
            'Create two 4/4 white Angel Warrior creature tokens with flying. Non-Angel creatures you control gain indestructible until your next turn.',
        },
        {
          name: 'Emeria, Shattered Skyclave',
          type_line: 'Land',
          mana_cost: '',
          oracle_text:
            "As this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {W}.",
        },
      ],
    },
    tags: ['protection', 'utility-land'],
    expect: {
      roles: {
        protection: 'S sorcery once f0',
      },
      interaction: [],
      produces: ['mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '1ed2d8e0-462b-468e-8fd3-1f3c6d99fb8a',
      name: 'Brutal Cathar // Moonrage Brute',
      layout: 'transform',
      type_line: 'Creature — Human Soldier Werewolf // Creature — Werewolf',
      keywords: ['Transform', 'Daybound', 'First strike', 'Ward', 'Nightbound'],
      cmc: 3,
      card_faces: [
        {
          name: 'Brutal Cathar',
          type_line: 'Creature — Human Soldier Werewolf',
          mana_cost: '{2}{W}',
          oracle_text:
            'Whenever this creature enters or transforms into Brutal Cathar, exile target creature an opponent controls until this creature leaves the battlefield.\nDaybound (If a player casts no spells during their own turn, it becomes night next turn.)',
          power: '2',
          toughness: '2',
        },
        {
          name: 'Moonrage Brute',
          type_line: 'Creature — Werewolf',
          mana_cost: '',
          oracle_text:
            'First strike\nWard—Pay 3 life.\nNightbound (If a player casts at least two spells during their own turn, it becomes day next turn.)',
          power: '3',
          toughness: '3',
        },
      ],
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P triggered per-event f0',
      },
      interaction: ['exile creature single opponents f0'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'dcb9c2a7-ae54-4ddc-a567-640bf4bf4366',
      name: 'Solitude',
      layout: 'normal',
      type_line: 'Creature — Elemental Incarnation',
      mana_cost: '{3}{W}{W}',
      oracle_text:
        "Flash\nLifelink\nWhen this creature enters, exile up to one other target creature. That creature's controller gains life equal to its power.\nEvoke—Exile a white card from your hand.",
      keywords: ['Lifelink', 'Evoke', 'Flash'],
      power: '3',
      toughness: '2',
      cmc: 5,
    },
    tags: ['removal', 'spot-removal', 'lifegain'],
    expect: {
      roles: {
        removal: 'P flash once',
      },
      interaction: ['exile creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'fbf9f8c5-849f-45d5-8129-5fc683c21a04',
      name: 'Fury',
      layout: 'normal',
      type_line: 'Creature — Elemental Incarnation',
      mana_cost: '{3}{R}{R}',
      oracle_text:
        'Double strike\nWhen this creature enters, it deals 4 damage divided as you choose among any number of target creatures and/or planeswalkers.\nEvoke—Exile a red card from your hand.',
      keywords: ['Evoke', 'Double strike'],
      power: '3',
      toughness: '3',
      cmc: 5,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: ['damage creature|planeswalker multi any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'ac2173f9-f223-440a-9231-fd98762bdc6f',
      name: 'Force of Negation',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{U}{U}',
      oracle_text:
        "If it's not your turn, you may exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target noncreature spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.",
      keywords: [],
      cmc: 3,
    },
    tags: ['counterspell'],
    expect: {
      roles: {
        counterspell: 'P instant once',
      },
      interaction: ['counter noncreature-spell single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '0456ec64-2c81-4763-a352-8ff64a4c3d6b',
      name: 'Deadly Rollick',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{3}{B}',
      oracle_text:
        'If you control a commander, you may cast this spell without paying its mana cost.\nExile target creature.',
      keywords: [],
      cmc: 4,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['exile creature single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '05849bd6-8f38-4031-be2b-e2aa03beb8cc',
      name: 'Pongify',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{U}',
      oracle_text:
        "Destroy target creature. It can't be regenerated. Its controller creates a 3/3 green Ape creature token.",
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
      oracle_id: '06692cd9-ac2f-4a32-8fd1-043ba3c0fe71',
      name: 'Rapid Hybridization',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{U}',
      oracle_text:
        "Destroy target creature. It can't be regenerated. That creature's controller creates a 3/3 green Frog Lizard creature token.",
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
      oracle_id: '38ddbe0b-07ef-4cdf-ad6c-cd8b8ba6d206',
      name: "Vraska's Contempt",
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{2}{B}{B}',
      oracle_text: 'Exile target creature or planeswalker. You gain 2 life.',
      keywords: [],
      cmc: 4,
    },
    tags: ['removal', 'spot-removal', 'lifegain'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['exile creature|planeswalker single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'faa01ed1-ccfa-4e58-951f-cd81f9068027',
      name: 'Mortify',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{W}{B}',
      oracle_text: 'Destroy target creature or enchantment.',
      keywords: [],
      cmc: 3,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P instant once',
      },
      interaction: ['destroy creature|enchantment single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '6257c2fd-005f-41e3-8a72-af76df1eb134',
      name: 'Terminate',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{B}{R}',
      oracle_text: "Destroy target creature. It can't be regenerated.",
      keywords: [],
      cmc: 2,
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
      oracle_id: '5c6c8fe7-3520-423b-a224-1c0af516871a',
      name: 'Casualties of War',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{B}{B}{G}{G}',
      oracle_text:
        'Choose one or more —\n• Destroy target artifact.\n• Destroy target creature.\n• Destroy target enchantment.\n• Destroy target land.\n• Destroy target planeswalker.',
      keywords: [],
      cmc: 6,
    },
    tags: ['removal', 'spot-removal'],
    expect: {
      roles: {
        removal: 'P sorcery once',
      },
      interaction: [
        'destroy artifact single any',
        'destroy creature single any',
        'destroy enchantment single any',
        'destroy land single any',
        'destroy planeswalker single any',
      ],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'd4a84e78-d9b9-4c67-8a4b-4329e65f0f15',
      name: 'Hullbreaker Horror',
      layout: 'normal',
      type_line: 'Creature — Kraken Horror',
      mana_cost: '{5}{U}{U}',
      oracle_text:
        "Flash\nThis spell can't be countered.\nWhenever you cast a spell, choose up to one —\n• Return target spell you don't control to its owner's hand.\n• Return target nonland permanent to its owner's hand.",
      keywords: ['Flash'],
      power: '7',
      toughness: '8',
      cmc: 7,
    },
    tags: ['removal', 'spot-removal', 'counterspell', 'bounce'],
    expect: {
      roles: {
        removal: 'P triggered per-event',
        counterspell: 'P triggered per-event',
      },
      interaction: ['counter spell single opponents', 'bounce nonland-permanent single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '161b6d06-e6a7-488e-9f9c-d266c1402a3a',
      name: 'Mystic Snake',
      layout: 'normal',
      type_line: 'Creature — Snake',
      mana_cost: '{1}{G}{U}{U}',
      oracle_text: 'Flash\nWhen this creature enters, counter target spell.',
      keywords: ['Flash'],
      power: '2',
      toughness: '2',
      cmc: 4,
    },
    tags: ['counterspell'],
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
      oracle_id: '5f3f68b5-8c6a-4181-bb8a-9c73967d198a',
      name: 'Glen Elendra Archmage',
      layout: 'normal',
      type_line: 'Creature — Faerie Wizard',
      mana_cost: '{3}{U}',
      oracle_text:
        "Flying\n{U}, Sacrifice this creature: Counter target noncreature spell.\nPersist (When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield under its owner's control with a -1/-1 counter on it.)",
      keywords: ['Flying', 'Persist'],
      power: '2',
      toughness: '2',
      cmc: 4,
    },
    tags: ['counterspell'],
    expect: {
      roles: {
        counterspell: 'P activated once',
      },
      interaction: ['counter noncreature-spell single any'],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'ab1cc360-b9de-48d9-9983-4dfe4a7d2a37',
      name: 'Arcane Denial',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{1}{U}',
      oracle_text:
        "Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep.\nYou draw a card at the beginning of the next turn's upkeep.",
      keywords: [],
      cmc: 2,
    },
    tags: ['counterspell', 'card-advantage', 'draw'],
    expect: {
      roles: {
        counterspell: 'P instant once',
        cardDraw: 'I instant once',
      },
      interaction: ['counter spell single any'],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'acfa77fd-3610-4f12-9c3c-bd860ce91700',
      name: 'Rhythm of the Wild',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{1}{R}{G}',
      oracle_text:
        "Creature spells you control can't be countered.\nNontoken creatures you control have riot. (They enter with your choice of a +1/+1 counter or haste.)",
      keywords: [],
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {
        protection: 'P static static',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '97407cd0-2bd2-4074-94d3-4ec3d243fa78',
      name: "Rishkar's Expertise",
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{4}{G}{G}',
      oracle_text:
        'Draw cards equal to the greatest power among creatures you control.\nYou may cast a spell with mana value 5 or less from your hand without paying its mana cost.',
      keywords: [],
      cmc: 6,
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
      oracle_id: '2b76f9e9-cd28-4eaf-8674-215c34263f96',
      name: 'Return of the Wildspeaker',
      layout: 'normal',
      type_line: 'Instant',
      mana_cost: '{4}{G}',
      oracle_text:
        'Choose one —\n• Draw cards equal to the greatest power among non-Human creatures you control.\n• Non-Human creatures you control get +3/+3 until end of turn.',
      keywords: [],
      cmc: 5,
    },
    tags: ['card-advantage', 'draw'],
    expect: {
      roles: {
        cardDraw: 'P instant once',
        finisher: 'P instant once',
      },
      interaction: [],
      produces: ['cards'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '382b7873-e78d-473b-8346-d92d16e8f634',
      name: 'Tooth and Nail',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{5}{G}{G}',
      oracle_text:
        'Choose one —\n• Search your library for up to two creature cards, reveal them, put them into your hand, then shuffle.\n• Put up to two creature cards from your hand onto the battlefield.\nEntwine {2} (Choose both if you pay the entwine cost.)',
      keywords: ['Entwine'],
      cmc: 7,
    },
    tags: ['tutor'],
    expect: {
      roles: {
        tutor: 'P sorcery once',
      },
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: 'd2075f58-b0e9-4e85-b7e6-0523a27a1d5b',
      name: 'Bala Ged Recovery // Bala Ged Sanctuary',
      layout: 'modal_dfc',
      type_line: 'Sorcery // Land',
      keywords: [],
      cmc: 3,
      card_faces: [
        {
          name: 'Bala Ged Recovery',
          type_line: 'Sorcery',
          mana_cost: '{2}{G}',
          oracle_text: 'Return target card from your graveyard to your hand.',
        },
        {
          name: 'Bala Ged Sanctuary',
          type_line: 'Land',
          mana_cost: '',
          oracle_text: 'This land enters tapped.\n{T}: Add {G}.',
        },
      ],
    },
    tags: ['card-advantage', 'utility-land', 'tapland'],
    expect: {
      roles: {
        recursion: 'P sorcery once f0',
      },
      interaction: [],
      produces: ['gy-to-hand', 'mana'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '1b9f9f5b-8712-4f00-90cb-1b7b9970eccc',
      name: "Sevinne's Reclamation",
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{W}',
      oracle_text:
        'Return target permanent card with mana value 3 or less from your graveyard to the battlefield. If this spell was cast from a graveyard, you may copy this spell and may choose a new target for the copy.\nFlashback {4}{W} (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
      keywords: ['Flashback'],
      cmc: 3,
    },
    tags: ['ramp'],
    expect: {
      roles: {
        recursion: 'P sorcery once',
      },
      interaction: [],
      produces: ['copy', 'gy-to-battlefield'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '09ff28b1-b6c9-48e6-b12e-2f0e644f709f',
      name: 'Gravecrawler',
      layout: 'normal',
      type_line: 'Creature — Zombie',
      mana_cost: '{B}',
      oracle_text:
        "This creature can't block.\nYou may cast this card from your graveyard as long as you control a Zombie.",
      keywords: [],
      power: '2',
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
      oracle_id: '240e85d3-e495-4877-8609-4b4056c402f7',
      name: 'Victimize',
      layout: 'normal',
      type_line: 'Sorcery',
      mana_cost: '{2}{B}',
      oracle_text:
        'Choose two target creature cards in your graveyard. Sacrifice a creature. If you do, return the chosen cards to the battlefield tapped.',
      keywords: [],
      cmc: 3,
    },
    tags: ['sacrifice'],
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
      oracle_id: '699b192c-f3f2-4ac5-9ca9-e35bcf08ad8a',
      name: 'Necromancy',
      layout: 'normal',
      type_line: 'Enchantment',
      mana_cost: '{2}{B}',
      oracle_text:
        "You may cast this spell as though it had flash. If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.\nWhen this enchantment enters, if it's on the battlefield, it becomes an Aura with \"enchant creature put onto the battlefield with Necromancy.\" Put target creature card from a graveyard onto the battlefield under your control and attach this enchantment to it. When this enchantment leaves the battlefield, that creature's controller sacrifices it.",
      keywords: [],
      cmc: 3,
    },
    tags: [],
    expect: {
      roles: {
        recursion: 'P flash once',
      },
      interaction: [],
      produces: ['gy-to-battlefield'],
      payoffs: [],
    },
  },
  {
    card: {
      oracle_id: '7e8c2a18-e404-40ff-a9e0-ec3eeb6d576e',
      name: 'Command Beacon',
      layout: 'normal',
      type_line: 'Land',
      mana_cost: '',
      oracle_text:
        '{T}: Add {C}.\n{T}, Sacrifice this land: Put your commander into your hand from the command zone.',
      keywords: [],
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
      oracle_id: 'c23e5b80-08d2-4e24-9908-fe2aa4f30f6f',
      name: 'Reliquary Tower',
      layout: 'normal',
      type_line: 'Land',
      mana_cost: '',
      oracle_text: 'You have no maximum hand size.\n{T}: Add {C}.',
      keywords: [],
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
      oracle_id: '27b047e3-0d41-45e2-98e9-9391d7923a1e',
      name: 'Exotic Orchard',
      layout: 'normal',
      type_line: 'Land',
      mana_cost: '',
      oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.',
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
      oracle_id: 'a75445d3-1303-4bb5-89ad-26ea93fecd48',
      name: 'Evolving Wilds',
      layout: 'normal',
      type_line: 'Land',
      mana_cost: '',
      oracle_text:
        '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
      keywords: [],
      cmc: 0,
    },
    tags: ['tutor', 'land-tutor'],
    expect: {
      roles: {},
      interaction: [],
      produces: [],
      payoffs: [],
    },
  },
];
