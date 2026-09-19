import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { detectCsvFormat, detectDelimiter, parseCsvAuto } from './csv';

/**
 * Round-trip guard for the frontend's SpellControl (ManaBox-compatible)
 * collection CSV exporter (`frontend/src/lib/collection-export.ts`). This
 * fixture is that exporter's own output for a small fixed collection (see
 * `collection-export.test.ts`'s "backend round-trip fixture" case) — proving
 * a downloaded export parses straight back into the same cards: one row per
 * physical copy, with the per-copy flags (altered/proxy) intact.
 */
describe('collection CSV export round-trip', () => {
  it('parses the exported fixture back into the source cards', () => {
    const text = readFileSync(join(__dirname, 'fixtures/collection-export-sample.csv'), 'utf-8');
    const [headerLine] = text.split(/\r?\n/, 1);
    const headers = headerLine.split(detectDelimiter(headerLine));
    expect(detectCsvFormat(headers)).toBe('manabox');

    const { rows } = parseCsvAuto(text, 'manabox');
    expect(rows).toHaveLength(4);

    // Two copies of one printing are two rows, each quantity 1 — nothing merges.
    for (const row of rows.slice(0, 2)) {
      expect(row).toMatchObject({
        name: 'Sol Ring',
        setCode: 'CMR',
        collectorNumber: '1',
        finish: 'nonfoil',
        quantity: 1,
        condition: 'nm',
        language: 'en',
        sourceCategory: 'Commander',
        purchasePrice: 1.5,
        altered: false,
        proxy: false,
      });
    }
    expect(rows[2]).toMatchObject({
      name: 'Lightning Bolt',
      setCode: 'LEA',
      collectorNumber: '161',
      finish: 'foil',
      quantity: 1,
      condition: 'lp',
      language: 'en',
      sourceCategory: 'Modern',
      altered: true,
    });
    expect(rows[3]).toMatchObject({
      name: 'Atraxa, Grand Unifier',
      setCode: 'ONE',
      collectorNumber: '240',
      finish: 'etched',
      quantity: 1,
      condition: undefined,
      language: 'ja',
      proxy: true,
    });
  });
});
