import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  COUNTER_CATALOG,
  counterColor,
  counterGlyph,
  counterLabel,
  nextGenericCounter,
  sortCounters,
} from './counter-kinds';

describe('counter kinds', () => {
  it('draws every printed counter with a glyph mana-font actually ships', () => {
    // A misspelt class draws nothing at all, an empty black disc on the card.
    const css = readFileSync(
      createRequire(import.meta.url).resolve('mana-font/css/mana.css'),
      'utf8'
    );
    for (const { kind, glyph } of COUNTER_CATALOG) {
      expect(css.includes(`.${glyph}:before`) || css.includes(`.${glyph}::before`), kind).toBe(
        true
      );
    }
  });

  it('keeps the kinds a saved board already stores', () => {
    // Boards saved before the catalogue hold "charge" and "loyalty" in
    // lowercase; those must keep drawing as icons.
    expect(counterGlyph('charge')).toBe('ms-counter-charge');
    expect(counterGlyph('loyalty')).toBe('ms-counter-loyalty');
    expect(counterGlyph('+1/+1')).toBe('ms-counter-plus');
    expect(counterGlyph('Counter 1')).toBeUndefined();
  });

  it('names a printed counter in sentence case and leaves a named one alone', () => {
    expect(counterLabel('charge')).toBe('Charge');
    expect(counterLabel('first strike')).toBe('First strike');
    expect(counterLabel('-1/-1')).toBe('-1/-1');
    expect(counterLabel('my thing')).toBe('my thing');
  });

  it('numbers generic counters from the first free slot', () => {
    expect(nextGenericCounter({})).toBe('Counter 1');
    expect(nextGenericCounter({ 'Counter 1': 3 })).toBe('Counter 2');
    expect(nextGenericCounter({ 'Counter 2': 1 })).toBe('Counter 1');
  });

  it('gives a named counter one colour, and the next number a different one', () => {
    expect(counterColor('Counter 1')).toBe(counterColor('Counter 1'));
    expect(counterColor('Counter 1')).not.toBe(counterColor('Counter 2'));
  });

  it('puts the body counters first and drops spent kinds', () => {
    expect(sortCounters({ 'my thing': 1, charge: 2, '+1/+1': 1, stun: 0 })).toEqual([
      ['+1/+1', 1],
      ['charge', 2],
      ['my thing', 1],
    ]);
  });
});
