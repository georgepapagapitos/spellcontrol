import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../types';
import type { SetMap } from './api';
import {
  SLD_CODE,
  SLD_UNASSIGNED,
  baseCollectorNumber,
  dropsForNumber,
  type SldDropsIndex,
} from './sld-drops';

/**
 * Set-completion math (E131). Ownership is printing-keyed: you "have" a
 * checklist slot when you own any finish of that set + collector number.
 */

export interface SetProgress {
  code: string;
  name: string;
  iconSvgUri: string;
  releasedAt: string;
  /** Distinct collector numbers owned in this set. */
  owned: number;
  /** Cards in the set per Scryfall; 0 = unknown (no % can be shown). */
  total: number;
  /** 0–100. Only ever 100 when owned covers the whole set. */
  pct: number;
  /**
   * Set only on Secret Lair drop rows (see {@link computeSldDropProgress}): the drop
   * name, or {@link SLD_UNASSIGNED} for owned SLD cards not in the drop map.
   */
  drop?: string;
}

/** Display percent that never rounds up to a false 100%. */
export function completionPct(owned: number, total: number): number {
  if (total <= 0) return 0;
  if (owned >= total) return 100;
  return Math.min(99, Math.round((owned / total) * 100));
}

/**
 * Per-set progress over every set the collection touches, newest release
 * first. Sets missing from the set map still appear (name falls back to the
 * code, total 0) so no owned card is silently unrepresented.
 */
export function computeSetProgress(
  cards: EnrichedCard[],
  setMap: SetMap | undefined
): SetProgress[] {
  const ownedBySet = new Map<string, Set<string>>();
  for (const c of cards) {
    const code = c.setCode?.toUpperCase();
    if (!code) continue;
    let slots = ownedBySet.get(code);
    if (!slots) {
      slots = new Set();
      ownedBySet.set(code, slots);
    }
    // Collector number identifies the checklist slot; fall back to the
    // Scryfall id so numberless rows still count as one distinct card.
    slots.add(c.collectorNumber || `sf:${c.scryfallId}`);
  }

  const rows: SetProgress[] = [];
  for (const [code, slots] of ownedBySet) {
    const meta = setMap?.[code];
    const total = meta?.cardCount ?? 0;
    rows.push({
      code,
      name: meta?.name || code,
      iconSvgUri: meta?.iconSvgUri ?? '',
      releasedAt: meta?.releasedAt ?? '',
      owned: Math.min(slots.size, total > 0 ? total : slots.size),
      total,
      pct: completionPct(slots.size, total),
    });
  }

  rows.sort(
    (a, b) => (b.releasedAt || '').localeCompare(a.releasedAt || '') || a.name.localeCompare(b.name)
  );
  return rows;
}

/**
 * Per-drop completion over the Secret Lair cards the collection touches —
 * the "Your drops" list inside the SLD set page (the hub keeps its single
 * flat SLD row; drops are set-internal detail, not top-level sets). Rows come
 * back newest drop first. Owned numbers not in the drop map collapse into one
 * trailing "unassigned" row (total unknown → no %), so no owned card is
 * silently unrepresented. A number sold in more than one drop counts toward
 * each — we can't know which product it came from.
 */
export function computeSldDropProgress(
  cards: EnrichedCard[],
  index: SldDropsIndex,
  iconSvgUri = ''
): SetProgress[] {
  const ownedNumbers = new Set<string>();
  for (const c of cards) {
    if (c.setCode?.toUpperCase() === SLD_CODE && c.collectorNumber) {
      ownedNumbers.add(c.collectorNumber);
    }
  }

  // Owned checklist slots per drop. A slot is a MAP number, not a raw owned
  // number: suffixed variant printings ("1627★" rainbow foil) resolve to their
  // base slot, so owning both the base and the variant of one card counts the
  // slot once instead of inflating progress.
  const slotsByDrop = new Map<string, Set<string>>();
  let unassigned = 0;
  for (const number of ownedNumbers) {
    const drops = dropsForNumber(index, number);
    if (drops.length === 0) {
      unassigned++;
      continue;
    }
    const slot = index.byNumber.has(number) ? number : baseCollectorNumber(number);
    for (const drop of drops) {
      let slots = slotsByDrop.get(drop.name);
      if (!slots) {
        slots = new Set();
        slotsByDrop.set(drop.name, slots);
      }
      slots.add(slot);
    }
  }

  const dropRows: SetProgress[] = index.drops
    .filter((d) => (slotsByDrop.get(d.name)?.size ?? 0) > 0)
    .map((d) => {
      const owned = Math.min(slotsByDrop.get(d.name)?.size ?? 0, d.numbers.length);
      return {
        code: SLD_CODE,
        name: d.name,
        iconSvgUri,
        releasedAt: d.releasedAt,
        owned,
        total: d.numbers.length,
        pct: completionPct(owned, d.numbers.length),
        drop: d.name,
      };
    });
  if (unassigned > 0) {
    dropRows.push({
      code: SLD_CODE,
      name: 'Secret Lair · unassigned',
      iconSvgUri,
      releasedAt: '',
      owned: unassigned,
      total: 0,
      pct: 0,
      drop: SLD_UNASSIGNED,
    });
  }

  return dropRows;
}

export type SetSortKey = 'release' | 'pct' | 'name' | 'total' | 'owned';

export const SET_SORT_LABEL: Record<SetSortKey, string> = {
  release: 'Newest',
  pct: 'Completion',
  name: 'Name',
  total: 'Total cards',
  owned: 'Owned cards',
};

/** Sort a copy of the hub rows. Every key tie-breaks by name for stability. */
export function sortSetRows(rows: SetProgress[], sort: SetSortKey): SetProgress[] {
  const byName = (a: SetProgress, b: SetProgress) => a.name.localeCompare(b.name);
  const cmp: Record<SetSortKey, (a: SetProgress, b: SetProgress) => number> = {
    release: (a, b) => (b.releasedAt || '').localeCompare(a.releasedAt || '') || byName(a, b),
    // Unknown totals (pct 0, total 0) sink below real percentages.
    pct: (a, b) => b.pct - a.pct || b.total - a.total || byName(a, b),
    name: byName,
    total: (a, b) => b.total - a.total || byName(a, b),
    owned: (a, b) => b.owned - a.owned || byName(a, b),
  };
  return [...rows].sort(cmp[sort]);
}

export interface SetGridRow {
  card: ScryfallCard;
  /** Copies owned of this exact printing (any finish). 0 = missing. */
  qty: number;
}

/**
 * Numeric-aware collector-number compare: "2" < "10", suffixed variants
 * ("10a", "10★") sort after their base number.
 */
export function compareCollectorNumbers(a: string, b: string): number {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

/** Overlay collection ownership onto a set's full card list, checklist order. */
export function overlaySetOwnership(
  setCards: ScryfallCard[],
  collection: EnrichedCard[],
  code: string
): SetGridRow[] {
  const upper = code.toUpperCase();
  const qtyByNumber = new Map<string, number>();
  for (const c of collection) {
    if (c.setCode?.toUpperCase() !== upper || !c.collectorNumber) continue;
    qtyByNumber.set(c.collectorNumber, (qtyByNumber.get(c.collectorNumber) ?? 0) + 1);
  }
  return setCards
    .map((card) => ({ card, qty: qtyByNumber.get(card.collector_number ?? '') ?? 0 }))
    .sort((a, b) =>
      compareCollectorNumbers(a.card.collector_number ?? '', b.card.collector_number ?? '')
    );
}
