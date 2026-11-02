import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseImport } from './index';

/**
 * Round-trip guard for the frontend's MTGO `.dek` exporter
 * (`buildExport(..., 'mtgo')` in `frontend/src/lib/import-export/deck-export.ts`).
 * The fixture is that exporter's own output; `deck-export.test.ts` pins it.
 */
describe('MTGO .dek import', () => {
  it('reads the exported fixture back, sideboard and entities intact', () => {
    const text = readFileSync(join(__dirname, 'fixtures/mtgo-deck-export-sample.dek'), 'utf-8');
    const result = parseImport(text);
    expect(result.format).toBe('mtgo');
    expect(result.unparsedLines).toEqual([]);
    expect(result.rows.map((r) => [r.name, r.quantity, r.section])).toEqual([
      ['Kaalia of the Vast', 1, undefined],
      ["Atraxa's Fall & Rise", 1, undefined],
      ['Sol Ring', 2, undefined],
      ["Gaea's Cradle", 1, 'sideboard'],
    ]);
  });

  it('tolerates attribute order, single quotes, and every entity form', () => {
    const xml = `<Deck><Cards Name='Jace &amp; Chandra &apos;s &quot;X&quot; &lt;&gt; &#233;&#xE9;' Sideboard='TRUE' Quantity='3' CatID='9'/></Deck>`;
    const { rows } = parseImport(xml);
    expect(rows).toEqual([
      {
        name: `Jace & Chandra 's "X" <> éé`,
        quantity: 3,
        section: 'sideboard',
        sourceFormat: 'mtgo',
      },
    ]);
  });

  it('never expands a DOCTYPE entity', () => {
    const xml = `<!DOCTYPE d [<!ENTITY x "Black Lotus">]><Deck><Cards Quantity="1" Name="&x;"/></Deck>`;
    expect(parseImport(xml).rows[0].name).toBe('&x;');
  });

  it('reports a card tag with no name as unparsed', () => {
    const result = parseImport('<Deck><Cards Quantity="1"/></Deck>');
    expect(result.rows).toEqual([]);
    expect(result.unparsedLines).toHaveLength(1);
  });
});
