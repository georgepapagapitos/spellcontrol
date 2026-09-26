import { describe, it, expect } from 'vitest';
import type { CubeCard } from './core';
import type { CubeCobraCard, ImportedCube } from './import';
import { buildMyVersion } from './build-my-version';

let id = 0;
function card(p: Partial<CubeCard>): CubeCard {
  return {
    name: p.name ?? `Card ${id++}`,
    oracleId: p.oracleId ?? `o${id++}`,
    colors: p.colors ?? ['R'],
    cmc: p.cmc ?? 2,
    typeLine: p.typeLine ?? 'Creature — Goblin',
    role: p.role ?? null,
    rank: p.rank,
    cubePop: p.cubePop,
    cubeElo: p.cubeElo,
  };
}

function ccCard(p: Partial<CubeCobraCard>): CubeCobraCard {
  return {
    name: p.name ?? `Imported ${id++}`,
    oracleId: p.oracleId ?? `i${id++}`,
    cmc: p.cmc ?? 2,
    typeLine: p.typeLine ?? 'Creature — Goblin',
    colors: p.colors ?? ['R'],
  };
}

function importedOf(cards: CubeCobraCard[]): ImportedCube {
  return { id: 'test', name: 'Test import', cardCount: cards.length, likeCount: 0, cards };
}

describe('buildMyVersion', () => {
  it('keeps every card the user owns (same oracleId)', () => {
    const owned = card({ name: 'Sol Ring', oracleId: 'sol-ring' });
    const imported = ccCard({ name: 'Sol Ring', oracleId: 'sol-ring' });
    const result = buildMyVersion(importedOf([imported]), [owned]);
    expect(result.kept.map((c) => c.oracleId)).toEqual(['sol-ring']);
    expect(result.substituted).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  it('substitutes an unowned card with the closest owned match: same bucket, slot, type', () => {
    const imported = ccCard({
      name: 'Not Owned',
      oracleId: 'not-owned',
      colors: ['R'],
      cmc: 3,
      typeLine: 'Instant',
    });
    const wrongBucket = card({ colors: ['U'], cmc: 3, typeLine: 'Instant', rank: 1 });
    const wrongType = card({ colors: ['R'], cmc: 3, typeLine: 'Creature — Goblin', rank: 1 });
    const farSlot = card({ colors: ['R'], cmc: 6, typeLine: 'Instant', rank: 1 });
    const match = card({ colors: ['R'], cmc: 3, typeLine: 'Instant', rank: 50, name: 'Bolt' });
    const result = buildMyVersion(importedOf([imported]), [wrongBucket, wrongType, farSlot, match]);
    expect(result.substituted).toHaveLength(1);
    expect(result.substituted[0].substitute.name).toBe('Bolt');
    expect(result.substituted[0].original.oracleId).toBe('not-owned');
    expect(result.missing).toHaveLength(0);
    // No "Substitute for X:" prefix — every caller already shows the
    // original next to this reason, so repeating its name is redundant.
    expect(result.substituted[0].reason).toBe('Red, 3 mana');
  });

  it('reports a card as missing when no owned substitute matches', () => {
    const imported = ccCard({ colors: ['R'], cmc: 3, typeLine: 'Instant' });
    const result = buildMyVersion(importedOf([imported]), [
      card({ colors: ['U'], cmc: 3, typeLine: 'Instant' }),
    ]);
    expect(result.missing).toHaveLength(1);
    expect(result.substituted).toHaveLength(0);
    expect(result.cube.gaps.some((g) => /no owned match/.test(g.text))).toBe(true);
  });

  it('never uses a banned card, as an owned keep or as a substitute', () => {
    const owned = card({ oracleId: 'banned-id', name: 'Banned card' });
    const imported = ccCard({ oracleId: 'banned-id', name: 'Banned card' });
    const result = buildMyVersion(importedOf([imported]), [owned], { banned: ['banned-id'] });
    expect(result.kept).toHaveLength(0);
    expect(result.substituted).toHaveLength(0);
    expect(result.missing).toHaveLength(1);
  });

  it('never uses the same owned card twice, even for two matching imports', () => {
    const importedA = ccCard({ colors: ['G'], cmc: 2, typeLine: 'Sorcery', name: 'A' });
    const importedB = ccCard({ colors: ['G'], cmc: 2, typeLine: 'Sorcery', name: 'B' });
    const onlyMatch = card({ colors: ['G'], cmc: 2, typeLine: 'Sorcery', name: 'Only match' });
    const result = buildMyVersion(importedOf([importedA, importedB]), [onlyMatch]);
    expect(result.substituted).toHaveLength(1);
    expect(result.missing).toHaveLength(1);
  });

  it('dedupes the imported list by oracleId, keeping the first occurrence', () => {
    const owned = card({ oracleId: 'dup', name: 'Dup card' });
    const a = ccCard({ oracleId: 'dup', name: 'Dup card' });
    const b = ccCard({ oracleId: 'dup', name: 'Dup card' });
    const result = buildMyVersion(importedOf([a, b]), [owned]);
    expect(result.kept).toHaveLength(1);
    expect(result.cube.picks).toHaveLength(1);
  });

  it('picks the closest offered size and reports the imported count separately', () => {
    const cards = Array.from({ length: 200 }, () => ccCard({}));
    const result = buildMyVersion(importedOf(cards), []);
    expect(result.requestedSize).toBe(200);
    expect(result.cube.size).toBe(180); // closest of [180,270,360,450,540,720] to 200
  });

  it('is deterministic (same import + pool + options → same result)', () => {
    const imported = [ccCard({ colors: ['B'], cmc: 4, typeLine: 'Sorcery' })];
    const pool = [card({ colors: ['B'], cmc: 4, typeLine: 'Sorcery', rank: 10 })];
    const a = buildMyVersion(importedOf(imported), pool);
    const b = buildMyVersion(importedOf(imported), pool);
    expect(a.cube.picks.map((p) => p.card.oracleId)).toEqual(
      b.cube.picks.map((p) => p.card.oracleId)
    );
    expect(a.missing).toEqual(b.missing);
  });

  it('reports shortfall against the chosen size, not the imported count', () => {
    const imported = [ccCard({ colors: ['G'], cmc: 2, typeLine: 'Sorcery' })];
    // Nothing owned → nothing kept or substituted → shortfall = chosen size.
    const result = buildMyVersion(importedOf(imported), []);
    expect(result.cube.picks).toHaveLength(0);
    expect(result.cube.shortfall).toBe(result.cube.size);
  });
});
