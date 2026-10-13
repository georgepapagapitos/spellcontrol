import type { AllocationInfo } from './allocations-core';

/** A binder a copy is filed in: the shape `buildCardToBinder` produces. */
export interface BinderRef {
  id: string;
  name: string;
  color: string;
}

/** One place some of a stack's copies are right now. */
export interface CopyPlace {
  kind: 'deck' | 'cube' | 'binder';
  id: string;
  name: string;
  color: string;
  href: string;
  /** The copies here, so a caller can look up their pages and pockets. */
  copyIds: string[];
}

export interface CopyBreakdown {
  total: number;
  /** Decks, then cubes, then binders; most copies first within each. */
  places: CopyPlace[];
  /** Copies in no deck, cube or binder. */
  unplaced: number;
}

const KIND_ORDER: Record<CopyPlace['kind'], number> = { deck: 0, cube: 1, binder: 2 };

/**
 * Where each copy of a stack is now, one place per copy, so the counts add up
 * to the stack. A deck or cube claim wins over the binder pocket: a binder
 * keeps the pocket of a copy pulled into a deck, but the copy is in the deck.
 */
export function breakdownCopies(
  copyIds: readonly string[],
  allocations: ReadonlyMap<string, AllocationInfo>,
  binderOf: ReadonlyMap<string, BinderRef>
): CopyBreakdown {
  const places = new Map<string, CopyPlace>();
  let unplaced = 0;
  for (const copyId of copyIds) {
    const a = allocations.get(copyId);
    const b = a ? undefined : binderOf.get(copyId);
    const place: Omit<CopyPlace, 'copyIds'> | undefined = a
      ? {
          kind: a.ownerKind,
          id: a.ownerId,
          name: a.ownerName,
          color: a.ownerKind === 'cube' ? 'var(--cube-color)' : a.ownerColor || 'var(--accent)',
          href:
            a.href ?? (a.ownerKind === 'cube' ? `/decks/cube/${a.ownerId}` : `/decks/${a.ownerId}`),
        }
      : b
        ? {
            kind: 'binder',
            id: b.id,
            name: b.name,
            color: b.color || 'var(--accent)',
            href: `/collection/binders/${b.id}`,
          }
        : undefined;
    if (!place) {
      unplaced += 1;
      continue;
    }
    const key = `${place.kind}:${place.id}`;
    const existing = places.get(key);
    if (existing) existing.copyIds.push(copyId);
    else places.set(key, { ...place, copyIds: [copyId] });
  }
  const sorted = [...places.values()].sort(
    (x, y) =>
      KIND_ORDER[x.kind] - KIND_ORDER[y.kind] ||
      y.copyIds.length - x.copyIds.length ||
      x.name.localeCompare(y.name)
  );
  return { total: copyIds.length, places: sorted, unplaced };
}

/** Copies of one kind across every place of that kind. */
export function copiesIn(breakdown: CopyBreakdown, kind: CopyPlace['kind']): number {
  let n = 0;
  for (const p of breakdown.places) if (p.kind === kind) n += p.copyIds.length;
  return n;
}
