import { afterEach, describe, expect, it } from 'vitest';
import { readPhaseTrace, resetPhaseTrace, tracePhase } from './liveGenPhaseTrace';

const state = { categories: { creatures: [{ name: 'A' }], lands: [{ name: 'Forest' }] } };

describe('live panel phase trace (E1061)', () => {
  afterEach(() => {
    (globalThis as { __phaseTrace?: unknown }).__phaseTrace = undefined;
  });

  it('records nothing until the live test resets it', () => {
    const run = tracePhase('trim', (s: typeof state) => s.categories.creatures.length);
    expect(run(state)).toBe(1);
    expect(readPhaseTrace()).toBeNull();
  });

  it('snapshots the deck as picked, then after each phase, sync or async', async () => {
    resetPhaseTrace();
    const trim = tracePhase('trim', (s: typeof state) => {
      s.categories.creatures.push({ name: 'B' });
      return 7;
    });
    const search = tracePhase('search', async (s: typeof state) => {
      s.categories.creatures.shift();
      return 'done';
    });
    expect(trim(state)).toBe(7);
    expect(await search(state)).toBe('done');
    expect(readPhaseTrace()).toEqual([
      { phase: 'pick', names: ['A', 'Forest'] },
      { phase: 'trim', names: ['A', 'B', 'Forest'] },
      { phase: 'search', names: ['B', 'Forest'] },
    ]);
  });
});
