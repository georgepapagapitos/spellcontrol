import { materializeBinders } from '../materialize';
import type { CubePickSlot } from '../../store/cube';
import type { BinderDef, EnrichedCard } from '../../types';
import type { SetMap } from '../api';

/**
 * Pull-list-by-binder for a physical cube: where each reserved copy sits —
 * binder, page, slot — sorted so the cube is pulled shelf-order (binder in
 * the user's own order, then page, then slot).
 *
 * Placement is computed with `materializeBinders` (the memoized shim in
 * `lib/materialize.ts`), NOT re-derived, so a row can never disagree with
 * what the Binders page itself shows. The call this mirrors is
 * `BinderPage.tsx`'s live view:
 *   materializeBinders(cards, binders, { search: '', allocatedCopyIds, setMap, qtyByPrintingKey })
 * — this module skips `qtyByPrintingKey` (BinderPage only threads it through
 * for the "group printings" page-grid preference, which collapses identical
 * printings into one pocket; a pull list always wants ONE row per physical
 * copy, never collapsed) and otherwise takes the same options. In particular
 * `allocatedCopyIds` is expected to be the FULL allocation set (every deck's
 * bound copies + every physical cube's, this one included) — exactly what
 * `useAllocations()` feeds the real Binders page — not a set that carves this
 * cube's own claims out. See "hidden" below for why that matters.
 *
 * `cards` must already carry whatever per-card decoration the user's binders
 * need to route/sort correctly (oracle tags, Secret Lair drop, per-printing
 * release date) — the same `useCardsWithTags` / `useCardsWithSldDrops` /
 * `useCardsWithReleaseDates` pipeline `BinderPage.tsx` runs before it
 * materializes. This module stays pure (no store reads), so that decoration
 * is the caller's job.
 */

export type CubePullGroupKind = 'binder' | 'uncategorized' | 'hidden' | 'unreserved';

/** Why a pick has no locatable copy — distinguishes "never had one" from
 *  "had one, but that copy is gone now" for the UI's hint text. */
export type CubePullUnreservedReason = 'not-owned' | 'copy-missing';

export interface CubePullRow {
  /** The pick's slotId — stable across a rebuild that keeps this pick. */
  key: string;
  name: string;
  /** The resolved physical copy. Present only on 'binder'/'uncategorized'/'hidden' rows. */
  card?: EnrichedCard;
  /** 1-based page number within the binder (binder rows only). */
  pageNum?: number;
  /** 1-based slot number within the page (binder rows only). */
  slotNum?: number;
  /** 'unreserved' rows only. */
  reason?: CubePullUnreservedReason;
}

export interface CubePullGroup {
  /** Stable identity, usable as a React key. */
  key: string;
  kind: CubePullGroupKind;
  label: string;
  /** Binder accent color (binder groups only). */
  color?: string;
  rows: CubePullRow[];
}

export interface BuildCubePullListOptions {
  /** Every copyId currently bound to a deck or a physical cube (this cube
   *  included) — see the module doc for why this must NOT exclude the
   *  viewed cube's own claims. */
  allocatedCopyIds?: ReadonlySet<string>;
  setMap?: SetMap;
}

interface Placement {
  binderId: string;
  binderName: string;
  binderColor: string;
  binderPosition: number;
  pageNum: number;
  slotNum: number;
}

/**
 * Build the pull list for a physical cube's picks.
 *
 * `collection` must be the user's FULL card list (not just the cube's own
 * cards) — a copy's page/slot depends on every other card sharing its binder,
 * exactly as it does when the user opens that binder for real.
 */
export function buildCubePullList(
  picks: CubePickSlot[],
  collection: EnrichedCard[],
  binderDefs: BinderDef[],
  options: BuildCubePullListOptions = {}
): CubePullGroup[] {
  const byCopyId = new Map(collection.map((c) => [c.copyId, c]));

  const { binders, uncategorized } = materializeBinders(collection, binderDefs, {
    search: '',
    allocatedCopyIds: options.allocatedCopyIds,
    setMap: options.setMap,
  });

  const placement = new Map<string, Placement>();
  for (const b of binders) {
    for (const section of b.sections) {
      for (const page of section.pages) {
        page.slots.forEach((slot, i) => {
          if (!slot) return;
          placement.set(slot.copyId, {
            binderId: b.def.id,
            binderName: b.def.name,
            binderColor: b.def.color,
            binderPosition: b.def.position,
            pageNum: page.pageNum,
            slotNum: i + 1,
          });
        });
      }
    }
  }
  const uncategorizedIds = new Set<string>();
  for (const section of uncategorized.sections) {
    for (const c of section.cards) uncategorizedIds.add(c.copyId);
  }

  const byGroupKey = new Map<string, CubePullRow[]>();
  const pushRow = (groupKey: string, row: CubePullRow) => {
    let rows = byGroupKey.get(groupKey);
    if (!rows) {
      rows = [];
      byGroupKey.set(groupKey, rows);
    }
    rows.push(row);
  };

  for (const pick of picks) {
    const name = pick.card.name;
    if (!pick.allocatedCopyId) {
      pushRow('unreserved', { key: pick.slotId, name, reason: 'not-owned' });
      continue;
    }
    const copy = byCopyId.get(pick.allocatedCopyId);
    if (!copy) {
      // The reserved copy no longer exists (deleted, or a reimport that
      // hasn't remapped this binding yet) — nothing to pull for this pick.
      pushRow('unreserved', { key: pick.slotId, name, reason: 'copy-missing' });
      continue;
    }
    const at = placement.get(pick.allocatedCopyId);
    if (at) {
      pushRow(`binder:${at.binderId}`, {
        key: pick.slotId,
        name,
        card: copy,
        pageNum: at.pageNum,
        slotNum: at.slotNum,
      });
      continue;
    }
    if (uncategorizedIds.has(pick.allocatedCopyId)) {
      pushRow('uncategorized', { key: pick.slotId, name, card: copy });
      continue;
    }
    // Neither placed in a binder nor in Uncategorized: a binder's rules would
    // claim this copy, but that binder has `hideDeckAllocated: false` and the
    // FULL allocation set (this cube included) makes the copy read as
    // "checked out" to it, so the binder swallows it from its own view
    // entirely (see @spellcontrol/binder-routing's `isSwallowedByBinder`).
    // The card is still physically in that binder until the user pulls it,
    // but the app has no page/slot to point at — surface it distinctly
    // rather than mislabel it "Uncategorized" (it IS categorized, just hidden).
    pushRow('hidden', { key: pick.slotId, name, card: copy });
  }

  const groups: CubePullGroup[] = [];
  const byName = (a: CubePullRow, b: CubePullRow) => a.name.localeCompare(b.name);
  const byPlacement = (a: CubePullRow, b: CubePullRow) =>
    (a.pageNum ?? 0) - (b.pageNum ?? 0) || (a.slotNum ?? 0) - (b.slotNum ?? 0);

  for (const def of [...binderDefs].sort((a, b) => a.position - b.position)) {
    const rows = byGroupKey.get(`binder:${def.id}`);
    if (!rows) continue;
    groups.push({
      key: `binder:${def.id}`,
      kind: 'binder',
      label: def.name,
      color: def.color,
      rows: rows.sort(byPlacement),
    });
  }
  const uncat = byGroupKey.get('uncategorized');
  if (uncat) {
    groups.push({
      key: 'uncategorized',
      kind: 'uncategorized',
      label: 'Uncategorized',
      rows: uncat.sort(byName),
    });
  }
  const hidden = byGroupKey.get('hidden');
  if (hidden) {
    groups.push({
      key: 'hidden',
      kind: 'hidden',
      label: "Filed, but hidden from that binder's view",
      rows: hidden.sort(byName),
    });
  }
  const unreserved = byGroupKey.get('unreserved');
  if (unreserved) {
    groups.push({
      key: 'unreserved',
      kind: 'unreserved',
      label: 'Not reserved',
      rows: unreserved.sort(byName),
    });
  }
  return groups;
}
