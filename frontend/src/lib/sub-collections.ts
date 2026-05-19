import type { EnrichedCard, SubCollectionDef } from '../types';
import { printingFinishKey } from './collection-mutations';

/** Matches the binder-name input cap in the UI. */
export const MAX_SUBCOLLECTION_NAME = 60;

export function clampSubCollectionName(name: string): string {
  return name.trim().slice(0, MAX_SUBCOLLECTION_NAME);
}

/**
 * Returns a new card assigned to `subCollectionId` (and stamps the durable
 * key shadow), or moved back to Main when `subCollectionId` is null.
 * Pure — never mutates the input.
 */
export function assignSubCollection(
  card: EnrichedCard,
  subCollectionId: string | null
): EnrichedCard {
  if (subCollectionId == null) {
    const { subCollectionId: _drop, subCollectionKey: _dropKey, ...rest } = card;
    return rest;
  }
  return { ...card, subCollectionId, subCollectionKey: printingFinishKey(card) };
}

/**
 * Builds a printingFinishKey → subCollectionId map from previously-assigned
 * cards, preserving multiplicity: if N prior copies of a key were assigned to
 * sc1, the map records N occurrences (as a count per key→id).
 */
export function buildSubCollectionKeyMap(
  prevCards: EnrichedCard[]
): Map<string, { id: string; count: number }> {
  const map = new Map<string, { id: string; count: number }>();
  for (const c of prevCards) {
    if (!c.subCollectionId) continue;
    const key = c.subCollectionKey ?? printingFinishKey(c);
    const entry = map.get(key);
    if (entry && entry.id === c.subCollectionId) entry.count += 1;
    else if (!entry) map.set(key, { id: c.subCollectionId, count: 1 });
  }
  return map;
}

/**
 * Re-applies sub-collection assignments onto a freshly-imported card array
 * (which has new copyIds) by matching on printingFinishKey, best-effort by
 * count. Cards that already carry an explicit subCollectionId are left as-is.
 * Pure — returns a new array; reuses element refs when unchanged.
 */
export function restoreSubCollectionAssignments(
  newCards: EnrichedCard[],
  prevCards: EnrichedCard[]
): EnrichedCard[] {
  const keyMap = buildSubCollectionKeyMap(prevCards);
  if (keyMap.size === 0) return newCards;
  const remaining = new Map([...keyMap].map(([k, v]) => [k, { id: v.id, count: v.count }]));
  return newCards.map((c) => {
    if (c.subCollectionId) return c;
    const key = printingFinishKey(c);
    const slot = remaining.get(key);
    if (!slot || slot.count <= 0) return c;
    slot.count -= 1;
    return { ...c, subCollectionId: slot.id, subCollectionKey: key };
  });
}

/**
 * Returns the id only if it resolves to a real def; otherwise undefined
 * (the defensive "treat unknown as Main" rule, also covers a delete racing
 * a sync). Undefined input → undefined.
 */
export function resolveSubCollectionId(
  id: string | undefined,
  defs: SubCollectionDef[]
): string | undefined {
  if (!id) return undefined;
  return defs.some((d) => d.id === id) ? id : undefined;
}
