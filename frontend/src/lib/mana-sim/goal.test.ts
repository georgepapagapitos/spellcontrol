import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { compileManaDeck, identityMask, classifyManaCard, buildManaDeck } from './index';
import { simulateGoal } from './engine';
import type { ManaCard } from './types';
import { turnLabel } from './turn-distribution';
import { drawCard } from './__fixtures__/draw-cards';

// Every card is a real Scryfall record (draw.fixture.json). The deck is 99
// cards: the named ones, lands, and Counterspell as the blank spell that costs
// as much as the cards it stands in for and does nothing for the goal.
const ORACLE = [{ names: ["Thassa's Oracle"], need: 1 }];

function deckOf(
  named: ReadonlyArray<readonly [string, number]>,
  lands: ReadonlyArray<readonly [string, number]>,
  roleOf?: (name: string) => ManaCard['sim']['role']
) {
  const library: ScryfallCard[] = [];
  for (const [n, k] of [...named, ...lands]) for (let i = 0; i < k; i++) library.push(drawCard(n));
  while (library.length < 99) library.push(drawCard('Counterspell'));
  if (!roleOf) return compileManaDeck({ commanders: [], library });
  const id = identityMask(library);
  const cache = new Map<string, ManaCard>();
  const mana = library.map((c) => {
    let m = cache.get(c.name);
    if (!m) cache.set(c.name, (m = classifyManaCard(c, id, { roleOf })));
    return m;
  });
  return buildManaDeck([], mana);
}

const ISLANDS: ReadonlyArray<readonly [string, number]> = [['Island', 36]];
const UB_LANDS: ReadonlyArray<readonly [string, number]> = [
  ['Island', 20],
  ['Swamp', 16],
];
const run = (
  deck: ReturnType<typeof deckOf>,
  goal: Parameters<typeof simulateGoal>[1] = { options: ORACLE }
) => simulateGoal(deck, goal, { games: 1500, seed: 11 })!;

describe('simulateGoal', () => {
  it('is a turn distribution with the run count', () => {
    const d = run(deckOf([["Thassa's Oracle", 1]], ISLANDS));
    expect(d.runs).toBe(1500);
    expect(d.ceilingTurn).toBeLessThanOrEqual(d.typicalTurn);
    expect(d.typicalTurn).toBeLessThanOrEqual(d.p90Turn);
    expect(run(deckOf([["Thassa's Oracle", 1]], ISLANDS))).toEqual(d);
  });

  it('never brings a piece online off its colors', () => {
    // {U}{U} off Mountains: the colorless clock called this castable.
    const lands: ReadonlyArray<readonly [string, number]> = [['Mountain', 36]];
    const stuck = run(deckOf([["Thassa's Oracle", 8]], lands));
    expect(stuck.assembledBy[20]).toBe(0);
    expect(stuck.typicalTurn).toBe(99);
    const fine = run(deckOf([["Thassa's Oracle", 8]], ISLANDS));
    expect(fine.assembledBy[20]).toBeGreaterThan(0.9);
  });

  it('cuts games off at the horizon and says so', () => {
    const lands: ReadonlyArray<readonly [string, number]> = [['Mountain', 36]];
    const deck = deckOf([["Thassa's Oracle", 8]], lands);
    const capped = simulateGoal(deck, { options: ORACLE, horizon: 30 }, { games: 200, seed: 11 })!;
    expect(capped.horizon).toBe(30);
    expect(capped.typicalTurn).toBe(31);
    expect(turnLabel(capped, capped.typicalTurn)).toBe('30+');
    // Games that finish before the horizon are the same games either way.
    const ok = deckOf([["Thassa's Oracle", 3]], ISLANDS);
    const a = simulateGoal(ok, { options: ORACLE, horizon: 60 }, { games: 300, seed: 5 })!;
    const b = simulateGoal(ok, { options: ORACLE }, { games: 300, seed: 5 })!;
    expect(a.p90Turn).toBeLessThanOrEqual(60);
    expect({ ...a, horizon: undefined }).toEqual({ ...b, horizon: undefined });
  });

  it('counts a land piece once it is played', () => {
    // Phyrexian Tower-style pieces: a land is "cast" by being put onto the battlefield.
    const deck = deckOf([['Command Tower', 8]], ISLANDS);
    const d = run(deck, { options: [{ names: ['Command Tower'], need: 1 }] });
    expect(d.assembledBy[10]).toBeGreaterThan(0.8);
    expect(d.ceilingTurn).toBeGreaterThanOrEqual(1);
  });

  it('is null when no option has its pieces in the library, immediate for a command-zone one', () => {
    const deck = deckOf([["Thassa's Oracle", 1]], ISLANDS);
    expect(simulateGoal(deck, { options: [{ names: ['Not A Card'], need: 1 }] })).toBeNull();
    const now = simulateGoal(deck, { options: [{ names: [], need: 0 }] }, { games: 40 })!;
    expect(now).toMatchObject({ runs: 40, typicalTurn: 1, p90Turn: 1, ceilingTurn: 1 });
  });

  describe('card draw and selection', () => {
    const faster = (spell: string, k: number, lands = UB_LANDS) => {
      const blank = run(deckOf([["Thassa's Oracle", 1]], lands));
      const drawn = run(
        deckOf(
          [
            ["Thassa's Oracle", 1],
            [spell, k],
          ],
          lands
        )
      );
      return { blank, drawn };
    };

    it.each([
      ['Divination', 8],
      ['Brainstorm', 8],
      ['Ponder', 8],
      ['Preordain', 8],
      ['Impulse', 8],
      ['Mulldrifter', 8],
      ['Phyrexian Arena', 4],
    ])('%s ×%i brings the piece online sooner than blank spells at the same cost', (spell, k) => {
      const { blank, drawn } = faster(spell, k);
      expect(drawn.typicalTurn).toBeLessThan(blank.typicalTurn - 1);
    });

    it('a draw spell off its colors draws nothing', () => {
      // Phyrexian Arena is {1}{B}; with only Islands it is never cast.
      const blank = run(deckOf([["Thassa's Oracle", 1]], ISLANDS));
      const stuck = run(
        deckOf(
          [
            ["Thassa's Oracle", 1],
            ['Phyrexian Arena', 4],
          ],
          ISLANDS
        )
      );
      expect(stuck.typicalTurn).toBeGreaterThanOrEqual(blank.typicalTurn - 1);
    });

    it('a land-only reveal takes lands, never the piece', () => {
      const named = [
        ["Thassa's Oracle", 1],
        ['Satyr Wayfinder', 12],
      ] as const;
      const landOnly = deckOf(named, [
        ['Island', 20],
        ['Forest', 16],
      ]);
      const lands = run(landOnly);
      // The same card allowed to take anything finds the Oracle more often.
      const mana = landOnly.library.map((c) =>
        c.name === 'Satyr Wayfinder' ? { ...c, draw: { ...c.draw!, landOnly: false } } : c
      );
      const anything = run(buildManaDeck([], mana));
      expect(anything.assembledBy[8]).toBeGreaterThan(lands.assembledBy[8]);
    });

    it('a card the text does not show drawing but the tagger calls draw falls back to two cards', () => {
      const roleOf = (name: string) => (name === 'Rhystic Study' ? ('cardDraw' as const) : null);
      const named = [
        ["Thassa's Oracle", 1],
        ['Rhystic Study', 8],
      ] as const;
      const tagged = run(deckOf(named, UB_LANDS, roleOf));
      const untagged = run(deckOf(named, UB_LANDS, () => null));
      expect(tagged.typicalTurn).toBeLessThan(untagged.typicalTurn - 1);
    });
  });

  it('a tutor costs its mana and finds the piece into hand', () => {
    const named = [
      ["Thassa's Oracle", 1],
      ['Demonic Tutor', 8],
    ] as const;
    const deck = deckOf(named, UB_LANDS);
    const without = run(deck);
    const withTutors = run(deck, { options: ORACLE, tutors: ['Demonic Tutor'] });
    expect(withTutors.typicalTurn).toBeLessThan(without.typicalTurn - 3);
    // Still paid for: it cannot beat the earliest turn the Oracle itself could be cast.
    expect(withTutors.ceilingTurn).toBeGreaterThanOrEqual(3);
  });
});
