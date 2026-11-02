import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseImport } from './index';

// The /guides/import-manabox.html and /guides/switch-from-manabox.html pages say
// a ManaBox CSV export imports with its printing, finish, condition, language,
// purchase price and binder name intact. This pins every one of those claims
// against a ManaBox-shaped comma-delimited export, so the guides can't outrun
// the parser. (The tab-delimited export is covered in manabox.test.ts.)
const csv = readFileSync(join(__dirname, 'fixtures/manabox-export-sample.csv'), 'utf8');

describe('ManaBox CSV export round trip', () => {
  const out = parseImport(csv);

  it('is detected as ManaBox and drops no rows', () => {
    expect(out.format).toBe('manabox');
    expect(out.rows).toHaveLength(3);
    expect(out.unparsedLines).toEqual([]);
  });

  it('keeps the exact printing, quantity and finish', () => {
    expect(out.rows[0]).toMatchObject({
      name: 'Sol Ring',
      quantity: 1,
      scryfallId: '11111111-1111-4111-8111-111111111111',
      finish: 'nonfoil',
    });
    expect(out.rows[1]).toMatchObject({ name: 'Fire // Ice', quantity: 2, finish: 'foil' });
    expect(out.rows[2].finish).toBe('etched');
  });

  it('keeps condition, language and purchase price', () => {
    expect(out.rows[0]).toMatchObject({ condition: 'nm', language: 'en', purchasePrice: 1.5 });
    expect(out.rows[1]).toMatchObject({ condition: 'lp', language: 'ja', purchasePrice: 3 });
    expect(out.rows[2].condition).toBe('mp');
  });

  it('keeps the ManaBox binder name as the source category', () => {
    expect(out.rows.map((r) => r.sourceCategory)).toEqual([
      'Commander Staples',
      'Commander Staples',
      'Trade Box',
    ]);
  });

  it('keeps the altered and misprint flags', () => {
    expect(out.rows[2].altered).toBe(true);
    expect(out.rows[1].misprint).toBe(true);
    expect(out.rows[0].misprint).toBe(false);
  });
});
