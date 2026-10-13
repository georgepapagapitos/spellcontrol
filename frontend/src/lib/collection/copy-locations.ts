import type { AllocationInfo } from './allocations-core';
import type { CubeListing } from '@/lib/cube/cube-listings';

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

/** A kind of mark the trigger draws. `listed` is a cube that lists the card
 *  but holds no copy (DeckBadge's dashed mark). */
export type MarkKind = 'deck' | 'cube' | 'binder' | 'listed';

export const ALL_MARK_KINDS: readonly MarkKind[] = ['deck', 'cube', 'binder', 'listed'];

/** Cubes that list the card but hold none of the stack's copies. */
export function listedNotHeld(
  breakdown: CopyBreakdown,
  listedIn: readonly CubeListing[]
): CubeListing[] {
  const held = new Set(breakdown.places.filter((p) => p.kind === 'cube').map((p) => p.id));
  return listedIn.filter((l) => !held.has(l.cubeId));
}

/** One mark: every place of one kind, merged. */
export interface MarkGroup {
  kind: MarkKind;
  /** The one owner's color, or undefined when there are several. */
  color: string | undefined;
  /** Copies in this group's places; 0 for a listing, which holds none. */
  copies: number;
  /** Show `copies` on the mark: only when it is part of the stack, never all. */
  counted: boolean;
}

/**
 * The marks a stack gets. A mark carries a count only when its copies are
 * part of the stack and the stack has more than one: "1 in a deck" beside
 * "× 5" is the point, and "5" beside "× 5" says nothing new. The count is
 * copies, never owners; how many decks is in the tooltip and the list.
 */
export function markGroups(
  breakdown: CopyBreakdown,
  listedIn: readonly CubeListing[],
  kinds: readonly MarkKind[] = ALL_MARK_KINDS
): MarkGroup[] {
  const out: MarkGroup[] = [];
  for (const kind of ['deck', 'cube', 'binder'] as const) {
    if (!kinds.includes(kind)) continue;
    const places = breakdown.places.filter((p) => p.kind === kind);
    if (places.length === 0) continue;
    const copies = places.reduce((n, p) => n + p.copyIds.length, 0);
    out.push({
      kind,
      color: places.length === 1 ? places[0].color : undefined,
      copies,
      counted: breakdown.total > 1 && copies < breakdown.total,
    });
  }
  if (kinds.includes('listed') && listedNotHeld(breakdown, listedIn).length > 0) {
    out.push({
      kind: 'listed',
      color: 'var(--cube-color)',
      copies: 0,
      counted: false,
    });
  }
  return out;
}

export const copiesWord = (n: number) => `${n} ${n === 1 ? 'copy' : 'copies'}`;

/** The whole breakdown in one sentence: the trigger's name and tooltip. */
export function describeCopyPlaces(
  breakdown: CopyBreakdown,
  listedIn: readonly CubeListing[]
): string {
  const parts = breakdown.places.map((p) => `${p.copyIds.length} in ${p.name}`);
  if (breakdown.unplaced > 0) parts.push(`${breakdown.unplaced} not in a deck or binder`);
  const listed = listedNotHeld(breakdown, listedIn).map((l) => l.cubeName);
  if (listed.length > 0) parts.push(`listed in ${listed.join(', ')}`);
  return `Where your ${breakdown.total === 1 ? 'copy is' : 'copies are'}: ${parts.join(', ')}`;
}
