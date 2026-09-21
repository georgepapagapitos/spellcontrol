import { describe, expect, it } from 'vitest';
import { firesAt, matchTriggers, type TriggerHit } from './triggers';

/**
 * Guard for the trigger matcher, against REAL oracle text.
 *
 * Every string below was fetched verbatim from Scryfall on 2026-09-20 and is
 * pinned here, not read from any snapshot under `public/` (see
 * `src/test/no-generated-assets-in-tests.test.ts` for why a regenerated
 * fixture is a debugging trap). Hand-written oracle prose would test the
 * matcher against the templating we imagine rather than the templating that
 * is printed, and one such assumption was already wrong before this file
 * existed: the postcombat trigger reads "each of your postcombat main
 * PHASES", plural, which a hand-written fixture would have missed.
 *
 * `oracle_text` is the property name on purpose. `copy-guards` skips test
 * files outright, but oracle text is full of em-dashes and typographic
 * apostrophes, so keeping it under a card-shaped key means it stays inert if
 * that skip is ever narrowed.
 */
const FIXTURES: { name: string; oracle_text: string; hits: TriggerHit[] }[] = [
  {
    name: 'Phyrexian Arena',
    oracle_text: 'At the beginning of your upkeep, you draw a card and you lose 1 life.',
    hits: [{ beat: 'beginning', scope: 'own' }],
  },
  {
    name: 'Bitterblossom',
    oracle_text:
      'At the beginning of your upkeep, you lose 1 life and create a 1/1 black Faerie Rogue creature token with flying.',
    hits: [{ beat: 'beginning', scope: 'own' }],
  },
  {
    // Two triggers on one card, and the pair the feature exists for: the
    // second fires on a turn that is not yours.
    name: 'Sheoldred, Whispering One',
    oracle_text:
      "Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)\nAt the beginning of your upkeep, return target creature card from your graveyard to the battlefield.\nAt the beginning of each opponent's upkeep, that player sacrifices a creature of their choice.",
    hits: [
      { beat: 'beginning', scope: 'own' },
      { beat: 'beginning', scope: 'table' },
    ],
  },
  {
    name: 'Mogis, God of Slaughter',
    oracle_text:
      "Indestructible\nAs long as your devotion to black and red is less than seven, Mogis isn't a creature.\nAt the beginning of each opponent's upkeep, Mogis deals 2 damage to that player unless they sacrifice a creature of their choice.",
    hits: [{ beat: 'beginning', scope: 'table' }],
  },
  {
    name: 'Howling Mine',
    oracle_text:
      "At the beginning of each player's draw step, if this artifact is untapped, that player draws an additional card.",
    hits: [{ beat: 'beginning', scope: 'table' }],
  },
  {
    name: 'Sulfuric Vortex',
    oracle_text:
      "At the beginning of each player's upkeep, this enchantment deals 2 damage to that player.\nIf a player would gain life, that player gains no life instead.",
    hits: [{ beat: 'beginning', scope: 'table' }],
  },
  {
    // "attack each combat if able" must not read as a combat trigger, and the
    // attack trigger is a `Whenever`, which is out of scope by design.
    name: 'Goblin Rabblemaster',
    oracle_text:
      'Other Goblin creatures you control attack each combat if able.\nAt the beginning of combat on your turn, create a 1/1 red Goblin creature token with haste.\nWhenever this creature attacks, it gets +1/+0 until end of turn for each other attacking Goblin.',
    hits: [{ beat: 'combat', scope: 'own' }],
  },
  {
    name: 'Absorbing Man',
    oracle_text:
      "Vigilance\nAt the beginning of your first main phase, until your next turn, Absorbing Man becomes a copy of up to one target artifact, non-Aura enchantment, or land, except his name is Absorbing Man, he's a legendary 4/4 Human Villain creature in addition to his other types, and he has vigilance.",
    hits: [{ beat: 'main1', scope: 'own' }],
  },
  {
    // The plural templating, and the reason these fixtures are fetched.
    name: 'Neheb, the Eternal',
    oracle_text:
      'Afflict 3 (Whenever this creature becomes blocked, defending player loses 3 life.)\nAt the beginning of each of your postcombat main phases, add {R} for each 1 life your opponents have lost this turn.',
    hits: [{ beat: 'main2', scope: 'own' }],
  },
  {
    name: 'Belbe, Corrupted Observer',
    oracle_text:
      'At the beginning of each postcombat main phase, the active player adds {C}{C} for each of your opponents who lost life this turn. (Damage causes loss of life.)',
    hits: [{ beat: 'main2', scope: 'table' }],
  },
  {
    // Unqualified "main phases" fires twice in a turn, so it reports twice.
    name: 'Carpet of Flowers',
    oracle_text:
      "At the beginning of each of your main phases, if you haven't added mana with this ability this turn, you may add X mana of any one color, where X is the number of Islands target opponent controls.",
    hits: [
      { beat: 'main1', scope: 'own' },
      { beat: 'main2', scope: 'own' },
    ],
  },
  {
    name: 'Growing Rites of Itlimoc (front)',
    oracle_text:
      'When Growing Rites of Itlimoc enters, look at the top four cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in any order.\nAt the beginning of your end step, if you control four or more creatures, transform Growing Rites of Itlimoc.',
    hits: [{ beat: 'end', scope: 'own' }],
  },
  {
    name: 'Growing Rites of Itlimoc (back)',
    oracle_text:
      '(Transforms from Growing Rites of Itlimoc.)\n{T}: Add {G}.\n{T}: Add {G} for each creature you control.',
    hits: [],
  },
  // ── The keyword upkeep taxes. Each carries its trigger ONLY inside the
  // reminder text, which is why this module does not strip parentheses.
  {
    name: 'Karmic Guide',
    oracle_text:
      'Flying, protection from black\nEcho {3}{W}{W} (At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.)\nWhen this creature enters, return target creature card from your graveyard to the battlefield.',
    hits: [{ beat: 'beginning', scope: 'own' }],
  },
  {
    name: 'Deep Forest Hermit',
    oracle_text:
      'Vanishing 3 (This creature enters with three time counters on it. At the beginning of your upkeep, remove a time counter from it. When the last is removed, sacrifice it.)\nWhen this creature enters, create four 1/1 green Squirrel creature tokens.\nSquirrels you control get +1/+1.',
    hits: [{ beat: 'beginning', scope: 'own' }],
  },
  {
    name: 'Mystic Remora',
    oracle_text:
      'Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)\nWhenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.',
    hits: [{ beat: 'beginning', scope: 'own' }],
  },
  // ── Negatives.
  {
    // A delayed trigger an activated ability sets up. Nothing on the permanent
    // says whether one is armed, so it is never reported.
    name: 'Whip of Erebos',
    oracle_text:
      'Creatures you control have lifelink.\n{2}{B}{B}, {T}: Return target creature card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else. Activate only as a sorcery.',
    hits: [],
  },
  {
    name: 'Sol Ring',
    oracle_text: '{T}: Add {C}{C}.',
    hits: [],
  },
];

describe('matchTriggers', () => {
  it.each(FIXTURES)('reads $name', ({ oracle_text, hits }) => {
    expect(matchTriggers(oracle_text)).toEqual(hits);
  });

  it('reads nothing off a card with no text', () => {
    expect(matchTriggers(undefined)).toEqual([]);
    expect(matchTriggers('')).toEqual([]);
  });

  // Table-level invariants, so deleting or weakening one fixture can't quietly
  // narrow the matcher without a second test failing.
  it('finds a trigger in every fixture that prints one', () => {
    for (const f of FIXTURES) {
      const prints = /at the beginning of/i.test(f.oracle_text) && !/the next/.test(f.oracle_text);
      expect(matchTriggers(f.oracle_text).length > 0, f.name).toBe(prints);
    }
  });

  it('covers every beat and both scopes', () => {
    const all = FIXTURES.flatMap((f) => matchTriggers(f.oracle_text));
    for (const beat of ['beginning', 'main1', 'combat', 'main2', 'end'] as const) {
      expect(
        all.some((h) => h.beat === beat),
        beat
      ).toBe(true);
    }
    expect(all.some((h) => h.scope === 'own')).toBe(true);
    expect(all.some((h) => h.scope === 'table')).toBe(true);
  });
});

describe('firesAt', () => {
  const own: TriggerHit[] = [{ beat: 'beginning', scope: 'own' }];
  const table: TriggerHit[] = [{ beat: 'beginning', scope: 'table' }];

  it('holds your own trigger back until your turn', () => {
    expect(firesAt(own, 'beginning', true)).toBe(true);
    expect(firesAt(own, 'beginning', false)).toBe(false);
  });

  it("fires a table trigger on anyone's turn", () => {
    expect(firesAt(table, 'beginning', true)).toBe(true);
    expect(firesAt(table, 'beginning', false)).toBe(true);
  });

  it('ignores a trigger due at another beat', () => {
    expect(firesAt(own, 'end', true)).toBe(false);
  });
});
