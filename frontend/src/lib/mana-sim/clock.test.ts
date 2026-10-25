import { describe, expect, it } from 'vitest';
import { assemblyClockAsync, clockKey, peekAssemblyClock, simulateAssemblyClock } from './clock';
import { buildManaDeck } from './index';
import { simulateGoalTurns } from './engine';
import { toClockLibrary } from './hand-classify';
import { simulateColorlessClock } from './opening-hand-sim';
import { drawCard } from './__fixtures__/draw-cards';

const library = (lands: string) => {
  const cards = Array.from({ length: 6 }, () => drawCard("Thassa's Oracle"));
  for (let i = 0; i < 36; i++) cards.push(drawCard(lands));
  while (cards.length < 99) cards.push(drawCard('Counterspell'));
  return cards;
};
const ORACLE = [{ names: ["Thassa's Oracle"], need: 1 }];

describe('simulateAssemblyClock', () => {
  it('runs on the colors-aware engine when every card carries its ManaCard', () => {
    const cards = library('Mountain');
    // Same list, two engines: the colorless clock casts {U}{U} off Mountains, the engine cannot.
    const colorless = simulateColorlessClock(
      toClockLibrary(cards).map(({ mana: _mana, ...c }) => c),
      ORACLE,
      { iterations: 400, seed: 5 }
    )!;
    const inColor = simulateAssemblyClock(toClockLibrary(cards), ORACLE, {
      iterations: 400,
      seed: 5,
    })!;
    expect(colorless.assembledBy[20]).toBeGreaterThan(0.3);
    expect(inColor.assembledBy[20]).toBe(0);
    expect(inColor.runs).toBe(400);
  });

  it('falls back to the colorless clock for a library without ManaCards', () => {
    const plain = toClockLibrary(library('Island')).map(({ mana: _mana, ...c }) => c);
    const a = simulateAssemblyClock(plain, ORACLE, { iterations: 200, seed: 5 });
    const b = simulateColorlessClock(plain, ORACLE, { iterations: 200, seed: 5 });
    expect(a).toEqual(b);
  });

  it('games split into slices are the games run at once', () => {
    const mana = toClockLibrary(library('Island')).map((c) => c.mana!);
    const deck = buildManaDeck([], mana);
    const goal = { options: ORACLE };
    const whole = simulateGoalTurns(deck, goal, { games: 90, seed: 3 })!;
    const sliced = [
      ...simulateGoalTurns(deck, goal, { games: 25, firstGame: 0, seed: 3 })!,
      ...simulateGoalTurns(deck, goal, { games: 40, firstGame: 25, seed: 3 })!,
      ...simulateGoalTurns(deck, goal, { games: 25, firstGame: 65, seed: 3 })!,
    ];
    expect(sliced).toEqual(whole);
  });

  describe('assemblyClockAsync', () => {
    it('gives the numbers of the synchronous call, and shares one run between callers', async () => {
      const lib = toClockLibrary(library('Island'));
      const opts = { iterations: 300, seed: 9 };
      const sync = simulateAssemblyClock(lib, ORACLE, opts);
      const key = clockKey(lib, ORACLE, opts);
      expect(peekAssemblyClock(key)).toBeUndefined();
      const a = assemblyClockAsync(lib, ORACLE, opts);
      const b = assemblyClockAsync(lib, ORACLE, opts);
      expect(b).toBe(a);
      expect(await a).toEqual(sync);
      expect(peekAssemblyClock(key)).toEqual(sync);
    });

    it('is null when no piece is in the library', async () => {
      const lib = toClockLibrary(library('Island'));
      expect(
        await assemblyClockAsync(lib, [{ names: ['Nope'], need: 1 }], { iterations: 50 })
      ).toBeNull();
    });
  });
});
