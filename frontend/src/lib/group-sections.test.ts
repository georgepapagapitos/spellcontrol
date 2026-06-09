import { describe, it, expect } from 'vitest';
import type { SectionMeta } from '@spellcontrol/binder-routing';
import { groupRowsIntoSections } from './group-sections';

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
