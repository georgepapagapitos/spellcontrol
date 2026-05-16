import type { BinderDef, EnrichedCard } from '../types';
import { printingFinishKey } from './collection-mutations';

/**
 * Resilient binder pins/exclusions.
 *
 * `copyId` is minted fresh on every import (crypto.randomUUID), so re-uploading
 * the same CSV produces a collection of identical cards with brand-new ids.
 * Decks already self-heal — `remapAllocations` re-binds a slot by matching the
 * card's name/printing when its `allocatedCopyId` goes missing. Binder pins had
 * NO such fallback: `pinnedCopyIds` / `excludedCopyIds` were raw id lists, so a
 * re-upload after a cache/sync loss silently dropped every manual pin and
 * exclusion with no way to recover them.
 *
 * Fix: persist the natural key (`printingFinishKey` = scryfallId+finish, the
 * same granularity decks remap at) alongside each ref. The key is stable across
 * imports; the copyId is not. `pinnedKeys`/`excludedKeys` are the durable
 * source of truth and `pinnedCopyIds`/`excludedCopyIds` are re-derived from
 * them against the live collection on every collection change. This is the
 * binder analogue of decks' remap pass.
 *
 * Semantics (intentionally identical to decks): a pin re-binds to AN equivalent
 * owned copy of that printing+finish, not necessarily the exact physical copy
 * it referenced before. Multiplicity is preserved (pinning 2 of 3 copies
 * re-resolves to 2 copies). A key with no owned copy is RETAINED (durable
 * intent) but contributes no copyId, so a later re-import restores it instead
 * of losing it forever.
 */

export { printingFinishKey };

/**
 * Natural keys for a list of copyIds. Looks the card up in the supplied
 * collection index; falls back to the binder's previously-stored keys by
 * positional alignment for ids that no longer resolve (e.g. an orphaned pin to
 * a card the user doesn't currently own). Ids that resolve to neither are
 * dropped — their intent is genuinely unknowable.
 */
export function keysForIds(
  ids: readonly string[],
  byId: Map<string, EnrichedCard>,
  prevIds: readonly string[] = [],
  prevKeys: readonly string[] = []
): string[] {
  const aligned = prevIds.length === prevKeys.length ? prevKeys : [];
  const out: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const card = byId.get(id);
    if (card) {
      out.push(printingFinishKey(card));
      continue;
    }
    const j = prevIds.indexOf(id);
    if (j !== -1 && aligned[j]) out.push(aligned[j]);
  }
  return out;
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
 * Re-resolve every binder's pin/exclusion lists against `newCards`, using each
 * binder's durable key shadow (backfilled from current ids for binders created
 * before the shadow existed, while those ids still resolve in prev/new).
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
    if (!hasPins && !hasExcl) return b;

    // Durable keys: persisted shadow if present, else backfill from the current
    // ids (legacy binder) — immunizes the current good state for the next
    // round-trip. Fresh per-binder queues so multiplicity is consumed locally.
    const buildQueues = (): Map<string, string[]> => {
      const m = new Map<string, string[]>();
      for (const c of newCards) {
        const k = printingFinishKey(c);
        const arr = m.get(k);
        if (arr) arr.push(c.copyId);
        else m.set(k, [c.copyId]);
      }
      return m;
    };

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

    const nextPinIds = resolveRefs(pinKeys, b.pinnedCopyIds ?? [], buildQueues(), keyOf);
    const nextExclIds = resolveRefs(exclKeys, b.excludedCopyIds ?? [], buildQueues(), keyOf);

    const pinIdsChanged = hasPins && !arraysEqual(b.pinnedCopyIds, nextPinIds);
    const pinKeysChanged = hasPins && !arraysEqual(b.pinnedKeys, pinKeys);
    const exclIdsChanged = hasExcl && !arraysEqual(b.excludedCopyIds, nextExclIds);
    const exclKeysChanged = hasExcl && !arraysEqual(b.excludedKeys, exclKeys);

    if (!pinIdsChanged && !pinKeysChanged && !exclIdsChanged && !exclKeysChanged) {
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
    return next;
  });

  return { binders: changed ? out : binders, changed };
}
