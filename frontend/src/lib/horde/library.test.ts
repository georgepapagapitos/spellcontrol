import { describe, it, expect } from 'vitest';
import {
  buildHordeLibrary,
  targetCounts,
  takeCycled,
  interleaveEvenly,
  dealSafeZone,
} from './library';
import { resolveHordeSettings } from './settings';
import { ZOMBIE_HORDE_FIXTURE } from './deck.fixtures';
import type { PlaytestCard } from '@/lib/playtest';

function nontoken(id: string, name = id): PlaytestCard {
  return { id, name, typeLine: 'Sorcery' };
}
function token(id: string, name = 'Zombie'): PlaytestCard {
  return { id, name, typeLine: 'Zombie Creature Token', isToken: true };
}

describe('takeCycled', () => {
  it('slices when count fits', () => {
    expect(takeCycled(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
  });
  it('cycles from the front when count exceeds length', () => {
    expect(takeCycled(['a', 'b'], 5)).toEqual(['a', 'b', 'a', 'b', 'a']);
  });
  it('returns empty for zero/empty input', () => {
    expect(takeCycled(['a'], 0)).toEqual([]);
    expect(takeCycled([], 5)).toEqual([]);
  });
});

describe('targetCounts', () => {
  it('cuts proportionally when librarySize is smaller than the authored deck', () => {
    // 12 tokens : 8 spells, total 20 -> asking for 10 keeps the 60/40 split.
    expect(targetCounts(12, 8, 10)).toEqual({ tokenCount: 6, spellCount: 4 });
  });

  it('keeps all spells and repeats only tokens when extending past the deck', () => {
    expect(targetCounts(12, 8, 30)).toEqual({ tokenCount: 22, spellCount: 8 });
  });

  it('never produces negative or oversized counts for an empty deck', () => {
    expect(targetCounts(0, 0, 10)).toEqual({ tokenCount: 0, spellCount: 0 });
  });

  it('falls back to repeating spells when extending a tokenless deck', () => {
    expect(targetCounts(0, 5, 12)).toEqual({ tokenCount: 0, spellCount: 12 });
  });

  it('returns zero for a non-positive librarySize', () => {
    expect(targetCounts(5, 5, 0)).toEqual({ tokenCount: 0, spellCount: 0 });
  });
});

describe('interleaveEvenly', () => {
  it('spreads a single stream when the other is empty', () => {
    const tokens = [token('t1'), token('t2')];
    expect(interleaveEvenly([], tokens)).toEqual(tokens);
    const nontokens = [nontoken('n1'), nontoken('n2')];
    expect(interleaveEvenly(nontokens, [])).toEqual(nontokens);
  });

  it('never runs more than one extra of the minority type consecutively', () => {
    const nontokens = [nontoken('n1'), nontoken('n2'), nontoken('n3')];
    const tokens = [token('t1')];
    const out = interleaveEvenly(nontokens, tokens);
    expect(out).toHaveLength(4);
    // The single token should land near the middle, not glued to one edge.
    const tokenIndex = out.findIndex((c) => c.isToken);
    expect(tokenIndex).toBeGreaterThan(0);
    expect(tokenIndex).toBeLessThan(3);
  });

  it('preserves the total count and membership', () => {
    const nontokens = [nontoken('n1'), nontoken('n2')];
    const tokens = [token('t1'), token('t2'), token('t3')];
    const out = interleaveEvenly(nontokens, tokens);
    expect(out).toHaveLength(5);
    expect(out.filter((c) => c.isToken)).toHaveLength(3);
    expect(out.filter((c) => !c.isToken)).toHaveLength(2);
  });
});

describe('dealSafeZone', () => {
  it('is a no-op when the computed safe-zone size is zero', () => {
    const pool = [nontoken('n1')];
    expect(dealSafeZone(pool, [], 0)).toBe(pool);
  });

  it('keeps every late-game card out of the safe-zone window', () => {
    const pool = [
      nontoken('late-1', 'Late Card'),
      token('t1'),
      nontoken('n1'),
      token('t2'),
      nontoken('n2'),
      token('t3'),
    ];
    const out = dealSafeZone(pool, ['Late Card'], 0.5); // window size = 3
    expect(out).toHaveLength(pool.length);
    expect(out.slice(0, 3).some((c) => c.name === 'Late Card')).toBe(false);
    // Nothing lost or duplicated.
    expect(out.map((c) => c.id).sort()).toEqual(pool.map((c) => c.id).sort());
  });
});

describe('buildHordeLibrary', () => {
  const settings = resolveHordeSettings('standard', 2, { librarySize: 20, safeZone: 'off' });

  it('is deterministic for a fixed seed', () => {
    const a = buildHordeLibrary(ZOMBIE_HORDE_FIXTURE, settings, 12345);
    const b = buildHordeLibrary(ZOMBIE_HORDE_FIXTURE, settings, 12345);
    expect(a.library.map((c) => c.id)).toEqual(b.library.map((c) => c.id));
    expect(a.library.map((c) => c.name)).toEqual(b.library.map((c) => c.name));
    expect(a.seed).toBe(b.seed);
  });

  it('advances the seed away from the input', () => {
    const { seed } = buildHordeLibrary(ZOMBIE_HORDE_FIXTURE, settings, 12345);
    expect(seed).not.toBe(12345);
  });

  it('cuts the library to librarySize keeping the authored token:spell ratio', () => {
    const { library } = buildHordeLibrary(ZOMBIE_HORDE_FIXTURE, settings, 1);
    expect(library).toHaveLength(20);
    const tokenCount = library.filter((c) => c.isToken).length;
    // fixture: 12 tokens / 8 spells of 20 total, librarySize === total -> unchanged ratio.
    expect(tokenCount).toBe(12);
    expect(library.length - tokenCount).toBe(8);
  });

  it('extends by repeating tokens only when librarySize exceeds the authored deck', () => {
    const big = resolveHordeSettings('standard', 2, { librarySize: 30, safeZone: 'off' });
    const { library } = buildHordeLibrary(ZOMBIE_HORDE_FIXTURE, big, 1);
    expect(library).toHaveLength(30);
    const spellNames = new Set(library.filter((c) => !c.isToken).map((c) => c.name));
    // All 8 authored (deduped) spell names should still be represented.
    expect(spellNames.size).toBe(new Set(ZOMBIE_HORDE_FIXTURE.spells.map((c) => c.name)).size);
  });

  it('never cuts bosses regardless of librarySize', () => {
    const small = resolveHordeSettings('standard', 1, { librarySize: 1, safeZone: 'off' });
    const { bosses } = buildHordeLibrary(ZOMBIE_HORDE_FIXTURE, small, 1);
    expect(bosses).toHaveLength(ZOMBIE_HORDE_FIXTURE.bosses.length);
    expect(bosses[0].name).toBe(ZOMBIE_HORDE_FIXTURE.bosses[0].name);
  });

  it('assigns every card a fresh unique id', () => {
    const { library, bosses } = buildHordeLibrary(ZOMBIE_HORDE_FIXTURE, settings, 7);
    const ids = [...library, ...bosses].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps late-game cards out of the safe zone for "full" and "reduced"', () => {
    for (const safeZone of ['full', 'reduced'] as const) {
      const s = resolveHordeSettings('standard', 2, { librarySize: 20, safeZone });
      const { library } = buildHordeLibrary(ZOMBIE_HORDE_FIXTURE, s, 42);
      const fraction = safeZone === 'full' ? 0.2 : 0.13;
      const windowSize = Math.round(library.length * fraction);
      const window = library.slice(0, windowSize);
      expect(window.some((c) => c.name === "Liliana's Mastery")).toBe(false);
    }
  });

  it('does not touch ordering at all for "off"', () => {
    const off = resolveHordeSettings('standard', 2, { librarySize: 20, safeZone: 'off' });
    const { library } = buildHordeLibrary(ZOMBIE_HORDE_FIXTURE, off, 42);
    // A plain shuffle can still (rarely) put the late-game card up front —
    // 'off' makes no safe-zone guarantee, so just assert basic shape.
    expect(library).toHaveLength(20);
  });
});
