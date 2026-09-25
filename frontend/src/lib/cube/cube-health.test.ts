import { describe, it, expect } from 'vitest';
import { computeCubeHealth, corpusWord } from './cube-health';
import { targetsForSize } from './targets';
import type { CubeCard } from './core';
import type { Pick } from './generate';

let id = 0;
function card(p: Partial<CubeCard>): CubeCard {
  return {
    name: p.name ?? `Card ${id++}`,
    oracleId: p.oracleId ?? `o${id++}`,
    colors: p.colors ?? ['W'],
    cmc: p.cmc ?? 2,
    typeLine: p.typeLine ?? 'Creature — Human',
    role: p.role ?? null,
    rank: p.rank,
    cubePop: p.cubePop,
    cubeElo: p.cubeElo,
    synergyProducers: p.synergyProducers,
    synergyPayoffs: p.synergyPayoffs,
  };
}

function pick(p: Partial<CubeCard>): Pick {
  return { card: card(p), bucket: 'W', reason: 'test' };
}

describe('computeCubeHealth', () => {
  it('flags a role far below the corpus range as low', () => {
    const picks: Pick[] = [];
    for (let i = 0; i < 300; i++) picks.push(pick({ typeLine: 'Creature', cmc: 3 }));
    for (let i = 0; i < 60; i++) picks.push(pick({ typeLine: 'Land', cmc: 0 }));
    const health = computeCubeHealth(picks, 360, 'limited');
    const removal = health.roles.find((r) => r.key === 'removal')!;
    expect(removal.count).toBe(0);
    expect(removal.status).toBe('low');
    expect(removal.lo).toBeGreaterThan(0);
  });

  it('flags a role far above the corpus range as high', () => {
    const picks: Pick[] = [];
    for (let i = 0; i < 300; i++)
      picks.push(pick({ typeLine: 'Instant', cmc: 1, role: 'removal' }));
    for (let i = 0; i < 60; i++) picks.push(pick({ typeLine: 'Land', cmc: 0 }));
    const health = computeCubeHealth(picks, 360, 'limited');
    const removal = health.roles.find((r) => r.key === 'removal')!;
    expect(removal.status).toBe('high');
  });

  it('reads types as a share of ALL cards, not just nonland', () => {
    const picks: Pick[] = [];
    for (let i = 0; i < 100; i++) picks.push(pick({ typeLine: 'Creature', cmc: 2 }));
    for (let i = 0; i < 260; i++) picks.push(pick({ typeLine: 'Land', cmc: 0 }));
    const health = computeCubeHealth(picks, 360, 'limited');
    const creature = health.types.find((t) => t.key === 'creature')!;
    // 100 of 360 total, not 100 of 100 nonland.
    expect(creature.count).toBe(100);
    expect(creature.median).toBeLessThan(200);
  });

  it('reports fixing lands against the absolute (already-scaled) target', () => {
    const band = targetsForSize(180);
    const picks: Pick[] = [];
    for (let i = 0; i < 150; i++) picks.push(pick({ typeLine: 'Creature', cmc: 2 }));
    for (let i = 0; i < 30; i++) picks.push(pick({ typeLine: 'Land', cmc: 0 }));
    const health = computeCubeHealth(picks, 180, 'limited');
    expect(health.fixingLands.count).toBe(30);
    expect(health.fixingLands.lo).toBe(Math.round(band.fixingLands.p25));
    expect(health.fixingLands.hi).toBe(Math.round(band.fixingLands.p75));
  });

  it('fixing lands within the corpus range read ok, not just in/out of bounds', () => {
    const band = targetsForSize(360);
    const picks: Pick[] = [];
    const onTarget = Math.round(band.fixingLands.median);
    for (let i = 0; i < 300; i++) picks.push(pick({ typeLine: 'Creature', cmc: 2 }));
    for (let i = 0; i < onTarget; i++) picks.push(pick({ typeLine: 'Land', cmc: 0 }));
    const health = computeCubeHealth(picks, 360, 'limited');
    expect(health.fixingLands.status).toBe('ok');
  });

  it('curve buckets 7+ CMC together', () => {
    const picks: Pick[] = [];
    for (let i = 0; i < 5; i++) picks.push(pick({ typeLine: 'Creature', cmc: 9 }));
    const health = computeCubeHealth(picks, 360, 'limited');
    const top = health.curve.find((c) => c.key === '7')!;
    expect(top.count).toBe(5);
    expect(top.label).toBe('7+ CMC');
  });

  it('180/270 bands are size-specific=false (reused from 360); mined sizes are true', () => {
    expect(computeCubeHealth([], 180, 'limited').bandIsSizeSpecific).toBe(false);
    expect(computeCubeHealth([], 270, 'limited').bandIsSizeSpecific).toBe(false);
    expect(computeCubeHealth([], 360, 'limited').bandIsSizeSpecific).toBe(true);
    expect(computeCubeHealth([], 720, 'limited').bandIsSizeSpecific).toBe(true);
  });

  it('commander format is never size-specific, even at a mined limited size', () => {
    expect(computeCubeHealth([], 360, 'commander').bandIsSizeSpecific).toBe(false);
  });

  it('works for a saved cube with no format recorded (defaults to limited)', () => {
    // Older saved cubes persisted before `format` shipped omit it entirely;
    // the call site passes `cube.format ?? 'limited'` — verify that default
    // produces the same result as passing 'limited' explicitly.
    const picks: Pick[] = [pick({ typeLine: 'Creature', cmc: 2 })];
    const withDefault = computeCubeHealth(picks, 360);
    const explicit = computeCubeHealth(picks, 360, 'limited');
    expect(withDefault).toEqual(explicit);
  });
});

describe('corpusWord', () => {
  it('names the literal size when the band was mined for it', () => {
    expect(corpusWord(360, true)).toBe('real 360s');
  });

  it('falls back to a generic word for a reused/scaled band', () => {
    expect(corpusWord(180, false)).toBe('real cubes');
  });
});
