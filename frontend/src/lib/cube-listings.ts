import { useMemo } from 'react';
import { useCubeStore, type SavedCube } from '../store/cube';

/** A cube that lists a card without holding a copy of it. */
export interface CubeListing {
  cubeId: string;
  cubeName: string;
}

/**
 * Which cubes list each card name WITHOUT reserving a copy, keyed by the
 * lowercased name. A draft cube lists every card it has. A physical cube lists
 * only what it could not reserve: a pick bound to no copy, and its commanders
 * (only `cube.picks` are ever bound).
 *
 * This is deliberately NOT an allocation. A listing claims nothing, so a listed
 * copy stays available to decks and binders; folding it into
 * `buildAllocationMap` would make every draft cube's cards read as taken. The
 * reserved half of a physical cube is already the claim-based cube badge.
 */
export function buildCubeListings(cubes: readonly SavedCube[]): Map<string, CubeListing[]> {
  const byName = new Map<string, CubeListing[]>();
  for (const cube of cubes) {
    const names = new Set<string>();
    if (cube.isPhysical) {
      for (const slot of cube.picks ?? []) {
        if (!slot.allocatedCopyId) names.add(slot.card.name.toLowerCase());
      }
    } else {
      for (const p of cube.cube.picks) names.add(p.card.name.toLowerCase());
    }
    for (const l of cube.cube.legends ?? []) names.add(l.card.name.toLowerCase());
    const listing = { cubeId: cube.id, cubeName: cube.name };
    for (const name of names) {
      const list = byName.get(name);
      if (list) list.push(listing);
      else byName.set(name, [listing]);
    }
  }
  return byName;
}

const NONE: CubeListing[] = [];

/** `buildCubeListings` over the saved cubes, as a by-name lookup. */
export function useCubeListings(): (name: string) => CubeListing[] {
  const cubes = useCubeStore((s) => s.saved);
  return useMemo(() => {
    const byName = buildCubeListings(cubes);
    return (name: string) => byName.get(name.toLowerCase()) ?? NONE;
  }, [cubes]);
}
