// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { sharedCubeToGeneratedCube } from './copy-shared-cube';
import type { PublicCube } from './shared-types';

const fakeCube: PublicCube = {
  ownerUsername: 'alex',
  ownerDisplayName: null,
  id: 'cube-1',
  name: 'Pauper Cube',
  size: 360,
  cards: [
    {
      name: 'Lightning Bolt',
      oracleId: 'o-bolt',
      colors: ['R'],
      cmc: 1,
      typeLine: 'Instant',
      bucket: 'R',
      reason: 'removal',
    },
    {
      name: 'Counterspell',
      oracleId: 'o-cs',
      colors: ['U'],
      cmc: 2,
      typeLine: 'Instant',
      bucket: 'U',
      reason: 'interaction',
    },
  ],
  byBucket: { R: 1, U: 1 },
  targetByBucket: { R: 60, U: 60 },
  gaps: [{ severity: 'short', text: '58 short on red' }],
  shortfall: 358,
  poolSize: 2,
};

describe('sharedCubeToGeneratedCube', () => {
  it('preserves size and reconstructs one pick per card', () => {
    const { size, cube } = sharedCubeToGeneratedCube(fakeCube);
    expect(size).toBe(360);
    expect(cube.picks).toHaveLength(2);
    expect(cube.picks[0].card.name).toBe('Lightning Bolt');
    expect(cube.picks[0].bucket).toBe('R');
    expect(cube.picks[0].reason).toBe('removal');
  });

  it('nulls the role (projection drops it) and carries oracleId', () => {
    const { cube } = sharedCubeToGeneratedCube(fakeCube);
    expect(cube.picks[0].card.role).toBeNull();
    expect(cube.picks[0].card.oracleId).toBe('o-bolt');
  });

  it('carries balance stats through faithfully (no empty-target bug)', () => {
    const { cube } = sharedCubeToGeneratedCube(fakeCube);
    expect(cube.byBucket).toEqual({ R: 1, U: 1 });
    expect(cube.targetByBucket).toEqual({ R: 60, U: 60 });
    expect(cube.gaps).toEqual([{ severity: 'short', text: '58 short on red' }]);
    expect(cube.shortfall).toBe(358);
    expect(cube.poolSize).toBe(2);
  });
});
