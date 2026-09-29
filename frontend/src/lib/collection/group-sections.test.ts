import { describe, it, expect } from 'vitest';
import type { SectionMeta } from '@spellcontrol/binder-routing';
import {
  buildGridLayout,
  buildListLayout,
  groupRowsIntoSections,
  type SectionHeader,
} from './group-sections';

interface TestRow {
  id: string;
  bucket: string;
  order: number;
}

const meta = (row: TestRow): SectionMeta => ({
  key: row.bucket,
  label: row.bucket,
  order: row.order,
});

describe('groupRowsIntoSections', () => {
  it('makes each section contiguous and ordered by meta.order', () => {
    const rows: TestRow[] = [
      { id: 'a', bucket: 'B', order: 1 },
      { id: 'b', bucket: 'A', order: 0 },
      { id: 'c', bucket: 'B', order: 1 },
      { id: 'd', bucket: 'A', order: 0 },
    ];
    const { rows: grouped, headers } = groupRowsIntoSections(rows, meta);
    expect(grouped.map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
    // Headers open at the first index of each section.
    expect([...headers.keys()].sort((x, y) => x - y)).toEqual([0, 2]);
    expect(headers.get(0)).toEqual({ meta: meta(rows[1]), count: 2 });
    expect(headers.get(2)).toEqual({ meta: meta(rows[0]), count: 2 });
  });

  it('preserves the incoming (caller-sort) order within each section', () => {
    // Same section for all → output order must equal input order (stable).
    const rows: TestRow[] = [
      { id: '3', bucket: 'X', order: 0 },
      { id: '1', bucket: 'X', order: 0 },
      { id: '2', bucket: 'X', order: 0 },
    ];
    const { rows: grouped, headers } = groupRowsIntoSections(rows, meta);
    expect(grouped.map((r) => r.id)).toEqual(['3', '1', '2']);
    expect(headers.get(0)).toEqual({ meta: meta(rows[0]), count: 3 });
    expect(headers.size).toBe(1);
  });

  it('clusters distinct sections that share an order (e.g. setName order:0) by key', () => {
    // Mirrors getSectionMeta('setName') which returns order:0 for every set;
    // without the key tiebreak these would interleave and split into many headers.
    const rows: TestRow[] = [
      { id: 'znr1', bucket: 'ZNR', order: 0 },
      { id: 'dom1', bucket: 'DOM', order: 0 },
      { id: 'znr2', bucket: 'ZNR', order: 0 },
      { id: 'dom2', bucket: 'DOM', order: 0 },
    ];
    const { rows: grouped, headers } = groupRowsIntoSections(rows, meta);
    expect(grouped.map((r) => r.id)).toEqual(['dom1', 'dom2', 'znr1', 'znr2']);
    expect(headers.size).toBe(2);
    expect(headers.get(0)?.meta.key).toBe('DOM');
    expect(headers.get(2)?.meta.key).toBe('ZNR');
  });

  it('carries pip styling through the header meta', () => {
    const withPip = (row: TestRow): SectionMeta => ({
      key: row.bucket,
      label: row.bucket,
      order: row.order,
      pip: { background: '#fff', border: '#000' },
    });
    const { headers } = groupRowsIntoSections([{ id: 'a', bucket: 'W', order: 0 }], withPip);
    expect(headers.get(0)?.meta.pip).toEqual({ background: '#fff', border: '#000' });
  });

  it('handles an empty list', () => {
    const { rows, headers } = groupRowsIntoSections<TestRow>([], meta);
    expect(rows).toEqual([]);
    expect(headers.size).toBe(0);
  });

  it('does not mutate the input array', () => {
    const rows: TestRow[] = [
      { id: 'a', bucket: 'B', order: 1 },
      { id: 'b', bucket: 'A', order: 0 },
    ];
    const snapshot = rows.map((r) => r.id);
    groupRowsIntoSections(rows, meta);
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });
});

const hdr = (key: string, count: number): SectionHeader => ({
  meta: { key, label: key, order: 0 },
  count,
});

describe('buildGridLayout', () => {
  it('chunks ungrouped cards into rows of gridCols', () => {
    const layout = buildGridLayout(5, 2, null);
    expect(layout).toEqual([
      { kind: 'cards', start: 0, end: 2 },
      { kind: 'cards', start: 2, end: 4 },
      { kind: 'cards', start: 4, end: 5 },
    ]);
  });

  it('opens each section with a header, then chunks that section into gridCols rows', () => {
    // 5 rows: section A = indices 0..2, section B = indices 3..4; gridCols 2.
    const headers = new Map<number, SectionHeader>([
      [0, hdr('A', 3)],
      [3, hdr('B', 2)],
    ]);
    const layout = buildGridLayout(5, 2, headers);
    expect(layout).toEqual([
      { kind: 'header', meta: { key: 'A', label: 'A', order: 0 }, count: 3 },
      { kind: 'cards', start: 0, end: 2 },
      { kind: 'cards', start: 2, end: 3 },
      { kind: 'header', meta: { key: 'B', label: 'B', order: 0 }, count: 2 },
      { kind: 'cards', start: 3, end: 5 },
    ]);
  });

  it('fills the last partial row with the trailing item when ungrouped', () => {
    // 3 cards + 1 trailing (Scryfall trigger), gridCols 2 → trigger fills row 2.
    const layout = buildGridLayout(3, 2, null, 1);
    expect(layout).toEqual([
      { kind: 'cards', start: 0, end: 2 },
      { kind: 'cards', start: 2, end: 4 }, // index 3 == the trigger
    ]);
  });

  it('puts the trailing item on its own row after all sections when grouped', () => {
    const headers = new Map<number, SectionHeader>([[0, hdr('A', 2)]]);
    const layout = buildGridLayout(2, 3, headers, 1);
    expect(layout).toEqual([
      { kind: 'header', meta: { key: 'A', label: 'A', order: 0 }, count: 2 },
      { kind: 'cards', start: 0, end: 2 },
      { kind: 'cards', start: 2, end: 3 }, // trailing trigger
    ]);
  });

  it('treats gridCols < 1 as a single column', () => {
    const layout = buildGridLayout(2, 0, null);
    expect(layout).toEqual([
      { kind: 'cards', start: 0, end: 1 },
      { kind: 'cards', start: 1, end: 2 },
    ]);
  });

  it('returns an empty layout for zero rows and no trailing item', () => {
    expect(buildGridLayout(0, 4, null)).toEqual([]);
    expect(buildGridLayout(0, 4, new Map())).toEqual([]);
  });

  it('folds a collapsed section to its header alone, keeping later sections intact', () => {
    const headers = new Map<number, SectionHeader>([
      [0, hdr('A', 3)],
      [3, hdr('B', 2)],
    ]);
    const layout = buildGridLayout(5, 2, headers, 0, new Set(['A']));
    expect(layout).toEqual([
      { kind: 'header', meta: { key: 'A', label: 'A', order: 0 }, count: 3 },
      { kind: 'header', meta: { key: 'B', label: 'B', order: 0 }, count: 2 },
      { kind: 'cards', start: 3, end: 5 },
    ]);
  });
});

describe('buildListLayout', () => {
  it('emits one card row per index when ungrouped', () => {
    expect(buildListLayout(3, null)).toEqual([
      { kind: 'card', index: 0 },
      { kind: 'card', index: 1 },
      { kind: 'card', index: 2 },
    ]);
  });

  it('opens each section with a header, then one row per card', () => {
    const headers = new Map<number, SectionHeader>([
      [0, hdr('A', 2)],
      [2, hdr('B', 1)],
    ]);
    expect(buildListLayout(3, headers)).toEqual([
      { kind: 'header', meta: { key: 'A', label: 'A', order: 0 }, count: 2 },
      { kind: 'card', index: 0 },
      { kind: 'card', index: 1 },
      { kind: 'header', meta: { key: 'B', label: 'B', order: 0 }, count: 1 },
      { kind: 'card', index: 2 },
    ]);
  });

  it('drops a collapsed section’s card rows but keeps its header', () => {
    const headers = new Map<number, SectionHeader>([
      [0, hdr('A', 2)],
      [2, hdr('B', 1)],
    ]);
    expect(buildListLayout(3, headers, new Set(['A']))).toEqual([
      { kind: 'header', meta: { key: 'A', label: 'A', order: 0 }, count: 2 },
      { kind: 'header', meta: { key: 'B', label: 'B', order: 0 }, count: 1 },
      { kind: 'card', index: 2 },
    ]);
  });
});
