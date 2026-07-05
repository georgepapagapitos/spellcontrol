import { materializeBinders } from './materialize';
import { printingFinishKey } from './collection-mutations';
import { pickCollectionCopy, type AllocationInfo } from './allocations';
import type { Deck } from '../store/decks';
import type { ScryfallCard } from '@/deck-builder/types';
import type { SetMap } from './api';
import type { BinderDef, EnrichedCard } from '../types';

/** One pull-list row — a pile of identical (same printing+finish) copies. */
export interface PullListRow {
  /** Stable within its group across rebuilds (printing+finish, or name for shortfall rows). */
  key: string;
  name: string;
  /** Representative owned copy — absent on 'elsewhere'/'unowned' rows. */
  card?: EnrichedCard;
  qty: number;
  /** Physical copies this row pulls (empty for 'elsewhere'/'unowned'). */
  copyIds: string[];
  /** 1-based physical page range in the binder (binder groups only). */
  pageStart?: number;
  pageEnd?: number;
  /** For 'elsewhere' rows: names of the decks/cubes holding every free copy. */
  owners?: string[];
}

export type PullGroupKind = 'binder' | 'uncategorized' | 'elsewhere' | 'unowned';

export interface PullListGroup {
  /** Stable identity, used as the React key and as the check-state key prefix. */
  key: string;
  kind: PullGroupKind;
  label: string;
  /** Binder accent color (binder groups only). */
  color?: string;
  rows: PullListRow[];
}

/** Rows the user can physically pull (and check off) vs. informational rows. */
export function isPullableKind(kind: PullGroupKind): boolean {
  return kind === 'binder' || kind === 'uncategorized';
}

interface Placement {
  binderId: string | null;
  order: number;
  page?: number;
}

/**
 * Builds the physical pull list for a deck: every card the deck needs, grouped
 * by where it lives — binders in priority (position) order with rows in each
 * binder's own page order, then Uncategorized, then copies allocated to other
 * decks/cubes, then cards with no free copy at all. Pure — no store reads.
 *
 * Slot resolution: a slot's bound copy (`allocatedCopyId`) is used when it
 * still exists; unbound/orphaned slots borrow a free copy via
 * `pickCollectionCopy` (display-only — nothing is written back to the deck),
 * so a card you own but never bound still shows up where it's filed instead
 * of falsely reading as "not owned".
 *
 * Placement intentionally ignores `hideDeckAllocated` (no `allocatedCopyIds`
 * passed): the deck is being assembled *now*, so its copies are still filed
 * wherever the rules put them — same derivation the deck grid's binder badge
 * uses.
 */
export function buildPullList(
  deck: Deck,
  collection: EnrichedCard[],
  binderDefs: BinderDef[],
  allocations: Map<string, AllocationInfo>,
  setMap?: SetMap
): PullListGroup[] {
  const slots: { card: ScryfallCard; allocatedCopyId: string | null }[] = [];
  if (deck.commander) {
    slots.push({ card: deck.commander, allocatedCopyId: deck.commanderAllocatedCopyId });
  }
  if (deck.partnerCommander) {
    slots.push({
      card: deck.partnerCommander,
      allocatedCopyId: deck.partnerCommanderAllocatedCopyId,
    });
  }
  for (const s of [...deck.cards, ...(deck.sideboard ?? [])]) {
    slots.push({ card: s.card, allocatedCopyId: s.allocatedCopyId });
  }
  if (slots.length === 0) return [];

  const byCopyId = new Map(collection.map((c) => [c.copyId, c]));

  // Resolve every slot to a physical copy where one exists.
  const pulledCopies: EnrichedCard[] = [];
  const unbound: ScryfallCard[] = [];
  for (const s of slots) {
    const copy = s.allocatedCopyId ? byCopyId.get(s.allocatedCopyId) : undefined;
    if (copy) pulledCopies.push(copy);
    else unbound.push(s.card); // never bound, or orphaned (copy left the collection)
  }

  // Borrow free copies for unbound slots, one physical copy per slot, with the
  // same printing/finish/price preference the deck editor's binding uses.
  const taken = new Map(allocations);
  const claimEntry = (name: string): AllocationInfo => ({
    ownerKind: 'deck',
    ownerId: deck.id,
    ownerName: deck.name,
    ownerColor: '',
    deckId: deck.id,
    deckName: deck.name,
    deckColor: '',
    cardName: name,
  });
  for (const c of pulledCopies) {
    if (!taken.has(c.copyId)) taken.set(c.copyId, claimEntry(c.name));
  }
  const shortfall = new Map<string, { card: ScryfallCard; qty: number }>();
  for (const card of unbound) {
    const free = pickCollectionCopy(card.name, collection, taken, card.id);
    if (free) {
      pulledCopies.push(free);
      taken.set(free.copyId, claimEntry(free.name));
    } else {
      const k = card.name.toLowerCase();
      const entry = shortfall.get(k);
      if (entry) entry.qty += 1;
      else shortfall.set(k, { card, qty: 1 });
    }
  }

  // Physical placement: where the binder rules file each copy, in the exact
  // order (and page) the binder view renders.
  const placement = new Map<string, Placement>();
  let order = 0;
  const { binders: materialized, uncategorized } = materializeBinders(collection, binderDefs, {
    search: '',
    setMap,
  });
  for (const b of materialized) {
    for (const section of b.sections) {
      for (const page of section.pages) {
        for (const slot of page.slots) {
          if (slot)
            placement.set(slot.copyId, { binderId: b.def.id, order: order++, page: page.pageNum });
        }
      }
    }
  }
  for (const section of uncategorized.sections) {
    for (const c of section.cards) {
      if (!placement.has(c.copyId)) placement.set(c.copyId, { binderId: null, order: order++ });
    }
  }

  // Group pulled copies by binder, rolling up identical printings into one row.
  interface RowAcc extends PullListRow {
    order: number;
  }
  const rowsByGroup = new Map<string, Map<string, RowAcc>>();
  for (const copy of pulledCopies) {
    const p = placement.get(copy.copyId) ?? { binderId: null, order: Number.MAX_SAFE_INTEGER };
    const groupKey = p.binderId ? `binder:${p.binderId}` : 'uncategorized';
    let rows = rowsByGroup.get(groupKey);
    if (!rows) {
      rows = new Map();
      rowsByGroup.set(groupKey, rows);
    }
    const rowKey = printingFinishKey(copy);
    const row = rows.get(rowKey);
    if (row) {
      row.qty += 1;
      row.copyIds.push(copy.copyId);
      row.order = Math.min(row.order, p.order);
      if (p.page !== undefined) {
        row.pageStart = row.pageStart === undefined ? p.page : Math.min(row.pageStart, p.page);
        row.pageEnd = row.pageEnd === undefined ? p.page : Math.max(row.pageEnd, p.page);
      }
    } else {
      rows.set(rowKey, {
        key: rowKey,
        name: copy.name,
        card: copy,
        qty: 1,
        copyIds: [copy.copyId],
        pageStart: p.page,
        pageEnd: p.page,
        order: p.order,
      });
    }
  }

  const groups: PullListGroup[] = [];
  const finishRows = (rows: Map<string, RowAcc>): PullListRow[] =>
    [...rows.values()].sort((a, b) => a.order - b.order).map(({ order: _order, ...row }) => row);

  for (const def of [...binderDefs].sort((a, b) => a.position - b.position)) {
    const rows = rowsByGroup.get(`binder:${def.id}`);
    if (!rows) continue;
    groups.push({
      key: `binder:${def.id}`,
      kind: 'binder',
      label: def.name,
      color: def.color,
      rows: finishRows(rows),
    });
  }
  const uncat = rowsByGroup.get('uncategorized');
  if (uncat) {
    groups.push({
      key: 'uncategorized',
      kind: 'uncategorized',
      label: 'Uncategorized',
      rows: finishRows(uncat),
    });
  }

  // Shortfall: the deck needs more copies than are free. Copies held by other
  // decks/cubes are listed with their holders; otherwise the card is unowned.
  const elsewhereRows: PullListRow[] = [];
  const unownedRows: PullListRow[] = [];
  for (const [k, { card, qty }] of shortfall) {
    const owners = new Set<string>();
    for (const c of collection) {
      if (c.name.toLowerCase() !== k) continue;
      const holder = allocations.get(c.copyId);
      if (holder && holder.ownerId !== deck.id) owners.add(holder.ownerName);
    }
    if (owners.size > 0) {
      elsewhereRows.push({ key: k, name: card.name, qty, copyIds: [], owners: [...owners] });
    } else {
      unownedRows.push({ key: k, name: card.name, qty, copyIds: [] });
    }
  }
  const byName = (a: PullListRow, b: PullListRow) => a.name.localeCompare(b.name);
  if (elsewhereRows.length > 0) {
    groups.push({
      key: 'elsewhere',
      kind: 'elsewhere',
      label: 'Allocated elsewhere',
      rows: elsewhereRows.sort(byName),
    });
  }
  if (unownedRows.length > 0) {
    groups.push({
      key: 'unowned',
      kind: 'unowned',
      label: 'Not owned',
      rows: unownedRows.sort(byName),
    });
  }
  return groups;
}
