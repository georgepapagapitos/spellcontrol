import type { PublicCube } from './shared-types';
import { useCubeStore } from '../store/cube';
import type { GeneratedCube } from './cube/generate';
import type { CubeSize, ColorBucket } from './cube/targets';

/**
 * Reconstruct a GeneratedCube from a public cube projection (oracle-level cards
 * + balance stats). Pure — the copy is a stored snapshot, not re-generated, so
 * roles/ranks the projection drops are simply null. Exported for testing.
 */
export function sharedCubeToGeneratedCube(data: PublicCube): {
  size: CubeSize;
  cube: GeneratedCube;
} {
  const size = data.size as CubeSize;
  const cube: GeneratedCube = {
    size,
    picks: data.cards.map((c) => ({
      card: {
        name: c.name,
        oracleId: c.oracleId,
        colors: c.colors,
        cmc: c.cmc,
        typeLine: c.typeLine,
        role: null,
      },
      bucket: c.bucket as ColorBucket,
      reason: c.reason,
    })),
    byBucket: data.byBucket as Record<ColorBucket, number>,
    targetByBucket: data.targetByBucket as Record<ColorBucket, number>,
    gaps: data.gaps,
    shortfall: data.shortfall,
    poolSize: data.poolSize,
  };
  return { size, cube };
}

/**
 * Copy a shared cube into the visitor's own saved cubes via `saveDirectly`, so
 * the in-progress working cube is never clobbered. Works for guests — the cube
 * store has no auth check and its sync subscriber no-ops when logged out.
 * Returns the new saved-cube id.
 */
export function copySharedCube(data: PublicCube): string {
  const { size, cube } = sharedCubeToGeneratedCube(data);
  return useCubeStore.getState().saveDirectly(`${data.name} (copy)`, size, cube);
}
