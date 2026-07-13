import type { BinderDef, EnrichedCard } from '../types';
import { printingFinishKey } from './collection-mutations';

/**
 * Resilient binder pins/exclusions.
 *
 * `copyId` is minted fresh on every import (crypto.randomUUID), so re-uploading
 * the same CSV produces a collection of identical cards with brand-new ids.
 * Decks already self-heal — `remapAllocations` re-binds a slot by matching the
 * card's name/printing when its `allocatedCopyId` goes missing. Binder pins,
 * exclusions, and hand-arranged manual order had NO such fallback:
 * `pinnedCopyIds` / `excludedCopyIds` / `manualOrder` were raw id lists, so a
 * re-upload after a cache/sync loss silently dropped every manual pin,
 * exclusion, and custom card ordering with no way to recover them.
 *
 * Fix: persist the natural key (`printingFinishKey` = scryfallId+finish, the
 * same granularity decks remap at) alongside each ref. The key is stable across
 * imports; the copyId is not. `pinnedKeys`/`excludedKeys`/`manualKeys` are the
 * durable source of truth and `pinnedCopyIds`/`excludedCopyIds`/`manualOrder`
 * are re-derived from them against the live collection on every collection
 * change. This is the binder analogue of decks' remap pass.
 *
 * Semantics (intentionally identical to decks): a pin re-binds to AN equivalent
 * owned copy of that printing+finish, not necessarily the exact physical copy
 * it referenced before. Multiplicity is preserved (pinning 2 of 3 copies
 * re-resolves to 2 copies). A key with no owned copy is RETAINED (durable
 * intent) but contributes no copyId, so a later re-import restores it instead
 * of losing it forever.
 *
 * Granularity is deliberately printing+finish, NOT +condition/+language (E131
 * audit). A re-import can therefore rebind a pin to a different condition or
 * language copy of the same printing+finish than the one originally pinned.
 * This is intentional, mirroring the collection table's own stacking key
 * (`printingFinishKey`): collectors who don't care about condition/language
 * splits shouldn't see their binder pins fragment across them, and a re-import
 * has no reliable way to match the exact physical copy anyway (fresh copyIds
 * every time). If per-copy-detail-aware rebinding is ever wanted, it's a
 * follow-up to widen this key — not a bug in the current one.
 *
 * Mutator model: the KEY list is the source of truth. Both the reconcile pass
 * (collection change) and every mutator (pin/unpin/exclude/reorder) edit the
 * key list and re-derive ids from it via `resolveRefs`. A mutator never
 * reconstructs keys from the live ids, so an orphan-retained key (a pinned
 * printing the user doesn't currently own) cannot be silently dropped by an
 * unrelated later mutation — the failure mode of the old `keysForIds`, whose
 * positional id→key fallback collapsed the moment the id and key lists
 * diverged in length (which they do whenever a key is orphan-retained).
 */

export { printingFinishKey };

/**
 * Build the printingFinishKey → owned-copyIds queue map for a collection.
 * Fresh map per call; `resolveRefs` mutates the queues as it consumes them.
 */
function buildQueues(cards: readonly EnrichedCard[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const c of cards) {
    const k = printingFinishKey(c);
    const arr = m.get(k);
    if (arr) arr.push(c.copyId);
    else m.set(k, [c.copyId]);
  }
  return m;
}

function keyOfFrom(byId: Map<string, EnrichedCard>) {
  return (id: string): string | undefined => {
    const c = byId.get(id);
    return c ? printingFinishKey(c) : undefined;
  };
}

/**
 * Durable key list for a binder ref. Returns the persisted shadow as-is when
 * present; otherwise backfills from the current ids for a legacy binder that
 * predates the shadow (ids that can't be keyed are genuinely unknowable and
 * dropped — identical to the pre-shadow behavior).
 */
function durableKeys(
  keys: readonly string[] | undefined,
  ids: readonly string[],
  keyOf: (id: string) => string | undefined
): string[] {
  if (keys) return [...keys];
  const out: string[] = [];
  for (const id of ids) {
    const k = keyOf(id);
    if (k) out.push(k);
  }
  return out;
}

/** A durable ref: the persisted key shadow plus its live-collection ids. */
export interface RefList {
  /** Durable source of truth — survives copyId regeneration. */
  keys: string[];
  /** Re-derived against the live collection (what materialize consumes). */
  ids: string[];
}

/**
 * Add an owned copy to a ref list: append its key, then re-derive ids. The
 * added copy is preferred when binding so the exact copy the user clicked
 * stays bound in-session. No-op when `addId` isn't currently owned.
 */
export function addRef(
  prevKeys: readonly string[] | undefined,
  prevIds: readonly string[] | undefined,
  addId: string,
  cards: readonly EnrichedCard[]
): RefList {
  const byId = new Map(cards.map((c) => [c.copyId, c] as const));
  const keyOf = keyOfFrom(byId);
  const ids0 = prevIds ?? [];
  const base = durableKeys(prevKeys, ids0, keyOf);
  const k = keyOf(addId);
  if (!k) return { keys: base, ids: [...ids0] };
  const keys = [...base, k];
  const ids = resolveRefs(keys, [...ids0, addId], buildQueues(cards), keyOf);
  return { keys, ids };
}

/**
 * Remove `removeId`'s slot from a ref list: drop ONE occurrence of its key,
 * leaving every other key — including orphan-retained ones — intact. When the
 * copy isn't owned (its key is unknowable) the keys are left untouched
 * (over-retain rather than guess); only the id binding is dropped.
 */
export function removeRef(
  prevKeys: readonly string[] | undefined,
  prevIds: readonly string[] | undefined,
  removeId: string,
  cards: readonly EnrichedCard[]
): RefList {
  const byId = new Map(cards.map((c) => [c.copyId, c] as const));
  const keyOf = keyOfFrom(byId);
  const ids0 = (prevIds ?? []).filter((id) => id !== removeId);
  let keys = durableKeys(prevKeys, prevIds ?? [], keyOf);
  const k = keyOf(removeId);
  if (k) {
    const at = keys.indexOf(k);
    if (at !== -1) keys = [...keys.slice(0, at), ...keys.slice(at + 1)];
  }
  const ids = resolveRefs(keys, ids0, buildQueues(cards), keyOf);
  return { keys, ids };
}

/**
 * Replace an ordered ref list (manual order) wholesale with `orderIds`, which
 * come from the displayed binder and are all currently owned. Order is
 * preserved exactly; the key shadow mirrors it 1:1.
 */
export function setOrderRefs(orderIds: readonly string[], cards: readonly EnrichedCard[]): RefList {
  const byId = new Map(cards.map((c) => [c.copyId, c] as const));
  const keyOf = keyOfFrom(byId);
  const keys: string[] = [];
  const ids: string[] = [];
  for (const id of orderIds) {
    const k = keyOf(id);
    if (!k) continue;
    keys.push(k);
    ids.push(id);
  }
  return { keys, ids };
}

function arraysEqual(a: readonly string[] | undefined, b: readonly string[]): boolean {
  const an = a ?? [];
  if (an.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) if (an[i] !== b[i]) return false;
  return true;
}

/**
 * Re-resolve one durable key list to copyIds against the new collection.
 *
 * Two passes, mirroring decks.remapAllocations: first keep any current id whose
 * key still has that exact copy available (no churn in the common in-session
 * case), then fill the remaining key-occurrences from unclaimed copies. Returns
 * the resolved ids plus the (unchanged) durable keys.
 */
function resolveRefs(
  sourceKeys: readonly string[],
  currentIds: readonly string[],
  newByKey: Map<string, string[]>,
  keyOf: (id: string) => string | undefined
): string[] {
  // Stability hint: which still-valid ids the binder currently uses, per key.
  const currentByKey = new Map<string, string[]>();
  for (const id of currentIds) {
    const k = keyOf(id);
    if (!k) continue;
    const arr = currentByKey.get(k);
    if (arr) arr.push(id);
    else currentByKey.set(k, [id]);
  }

  const ids: string[] = [];
  for (const key of sourceKeys) {
    const queue = newByKey.get(key);
    if (!queue || queue.length === 0) continue; // not owned now; key retained
    let chosen: string | undefined;
    const pref = currentByKey.get(key);
    while (pref && pref.length > 0) {
      const cand = pref.shift()!;
      const pos = queue.indexOf(cand);
      if (pos !== -1) {
        queue.splice(pos, 1);
        chosen = cand;
        break;
      }
    }
    if (!chosen) chosen = queue.shift();
    if (chosen) ids.push(chosen);
  }
  return ids;
}

/**
 * Re-resolve every binder's pin/exclusion/manual-order lists against
 * `newCards`, using each binder's durable key shadow (backfilled from current
 * ids for binders created before the shadow existed, while those ids still
 * resolve in prev/new).
 *
 * Pure: returns a new binders array only if something actually changed, and
 * reuses the original element references for untouched binders, so the sync
 * subscriber and React memoization don't see spurious mutations.
 */
export function reconcileBinderRefs(
  binders: BinderDef[],
  newCards: EnrichedCard[],
  prevCards: EnrichedCard[]
): { binders: BinderDef[]; changed: boolean } {
  const prevById = new Map(prevCards.map((c) => [c.copyId, c]));
  const newById = new Map(newCards.map((c) => [c.copyId, c]));
  const keyOf = (id: string): string | undefined => {
    const c = prevById.get(id) ?? newById.get(id);
    return c ? printingFinishKey(c) : undefined;
  };

  let changed = false;
  const out = binders.map((b) => {
    const hasPins = (b.pinnedCopyIds?.length ?? 0) > 0 || (b.pinnedKeys?.length ?? 0) > 0;
    const hasExcl = (b.excludedCopyIds?.length ?? 0) > 0 || (b.excludedKeys?.length ?? 0) > 0;
    const hasManual = (b.manualOrder?.length ?? 0) > 0 || (b.manualKeys?.length ?? 0) > 0;
    if (!hasPins && !hasExcl && !hasManual) return b;

    // Durable keys: persisted shadow if present, else backfill from the current
    // ids (legacy binder) — immunizes the current good state for the next
    // round-trip. `buildQueues(newCards)` returns a fresh map per call so each
    // resolveRefs consumes multiplicity locally.
    //
    // Backfill resolves against prev ∪ new (via keyOf): covers legacy binders
    // whose ids are still in the old collection AND freshly-created binder-mode
    // pins whose ids only exist in the new collection.
    const backfill = (ids: readonly string[]): string[] => {
      const ks: string[] = [];
      for (const id of ids) {
        const k = keyOf(id);
        if (k) ks.push(k);
      }
      return ks;
    };
    const pinKeys = b.pinnedKeys ?? backfill(b.pinnedCopyIds ?? []);
    const exclKeys = b.excludedKeys ?? backfill(b.excludedCopyIds ?? []);
    // manualOrder is an ordered sequence with multiplicity, not a set; the
    // printingFinishKey granularity collapses identical copies, so the order
    // is restored at printing+finish resolution — which is what the user
    // perceives. resolveRefs preserves key order, prefers a still-valid
    // current id (no churn in-session), and skips keys with no owned copy
    // (the slot's intent is retained in manKeys for a later re-import).
    const manKeys = b.manualKeys ?? backfill(b.manualOrder ?? []);

    const nextPinIds = resolveRefs(pinKeys, b.pinnedCopyIds ?? [], buildQueues(newCards), keyOf);
    const nextExclIds = resolveRefs(
      exclKeys,
      b.excludedCopyIds ?? [],
      buildQueues(newCards),
      keyOf
    );
    const nextManIds = resolveRefs(manKeys, b.manualOrder ?? [], buildQueues(newCards), keyOf);

    const pinIdsChanged = hasPins && !arraysEqual(b.pinnedCopyIds, nextPinIds);
    const pinKeysChanged = hasPins && !arraysEqual(b.pinnedKeys, pinKeys);
    const exclIdsChanged = hasExcl && !arraysEqual(b.excludedCopyIds, nextExclIds);
    const exclKeysChanged = hasExcl && !arraysEqual(b.excludedKeys, exclKeys);
    const manIdsChanged = hasManual && !arraysEqual(b.manualOrder, nextManIds);
    const manKeysChanged = hasManual && !arraysEqual(b.manualKeys, manKeys);

    if (
      !pinIdsChanged &&
      !pinKeysChanged &&
      !exclIdsChanged &&
      !exclKeysChanged &&
      !manIdsChanged &&
      !manKeysChanged
    ) {
      return b;
    }
    changed = true;
    const next: BinderDef = { ...b };
    if (hasPins) {
      next.pinnedCopyIds = nextPinIds;
      next.pinnedKeys = pinKeys;
    }
    if (hasExcl) {
      next.excludedCopyIds = nextExclIds;
      next.excludedKeys = exclKeys;
    }
    if (hasManual) {
      next.manualOrder = nextManIds;
      next.manualKeys = manKeys;
    }
    return next;
  });

  return { binders: changed ? out : binders, changed };
}
