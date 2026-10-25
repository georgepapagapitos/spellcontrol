import { describe, expect, it } from 'vitest';
import { simulateAssemblyClock } from './clock';
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
});
