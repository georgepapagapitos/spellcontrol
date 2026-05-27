import { describe, expect, it } from 'vitest';
import { chunkImportText } from './import-chunker';

describe('chunkImportText', () => {
  it('returns the original text untouched when below the chunk size', () => {
    const text = 'Sol Ring\nLightning Bolt\nCounterspell';
    expect(chunkImportText(text, 500)).toEqual([text]);
  });

  it('returns the original text for empty input', () => {
    expect(chunkImportText('', 500)).toEqual(['']);
  });

  it('ignores trailing blank lines when deciding whether to chunk', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `Card ${i}`);
    const text = `${lines.join('\n')}\n\n\n`;
    expect(chunkImportText(text, 500)).toEqual([text]);
  });

  it('splits a plain-text list with no header into evenly sized chunks', () => {
    const lines = Array.from({ length: 1001 }, (_, i) => `Card ${i}`);
    const chunks = chunkImportText(lines.join('\n'), 500);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].split('\n')).toHaveLength(500);
    expect(chunks[1].split('\n')).toHaveLength(500);
    expect(chunks[2].split('\n')).toHaveLength(1);
    expect(chunks[2]).toBe('Card 1000');
  });

  it('preserves the CSV header in every chunk', () => {
    const header = 'Name,Set,Quantity';
    const body = Array.from({ length: 600 }, (_, i) => `Card ${i},NEO,1`);
    const chunks = chunkImportText([header, ...body].join('\n'), 250);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.startsWith(`${header}\n`)).toBe(true);
    }
    // Body lines should be partitioned, not duplicated.
    const bodyLines = chunks.flatMap((c) => c.split('\n').slice(1));
    expect(bodyLines).toHaveLength(body.length);
    expect(new Set(bodyLines).size).toBe(body.length);
  });

  it('preserves a ManaBox TSV header (tab delimiter + Scryfall ID column)', () => {
    const header =
      'Binder Name\tBinder Type\tName\tSet code\tSet name\tCollector number\tFoil\tRarity\tQuantity\tManaBox ID\tScryfall ID\tPurchase price';
    const body = Array.from({ length: 1200 }, (_, i) => `Main\tnormal\tCard ${i}\tNEO`);
    const chunks = chunkImportText([header, ...body].join('\n'), 500);
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.startsWith(`${header}\n`)).toBe(true);
    }
  });

  it('detects header for semicolon-delimited CSV', () => {
    const header = 'Name;Edition;Quantity';
    const body = Array.from({ length: 600 }, (_, i) => `Card ${i};NEO;1`);
    const chunks = chunkImportText([header, ...body].join('\n'), 250);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].startsWith(`${header}\n`)).toBe(true);
  });

  it('does not treat a delimited first line without keywords as a header', () => {
    // "Lightning Bolt, Counterspell" looks like a comma-delimited line but
    // contains no header keywords — treat as a data row.
    const lines = [
      'Lightning Bolt, Counterspell',
      ...Array.from({ length: 600 }, () => 'Sol Ring'),
    ];
    const chunks = chunkImportText(lines.join('\n'), 300);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].split('\n')).toHaveLength(300);
    expect(chunks[0].split('\n')[0]).toBe('Lightning Bolt, Counterspell');
  });

  it('rejects a non-positive chunk size', () => {
    expect(() => chunkImportText('a\nb', 0)).toThrow();
    expect(() => chunkImportText('a\nb', -1)).toThrow();
  });

  it('handles CRLF line endings', () => {
    const header = 'Name,Set';
    const body = Array.from({ length: 600 }, (_, i) => `Card ${i},NEO`);
    const chunks = chunkImportText([header, ...body].join('\r\n'), 250);
    expect(chunks).toHaveLength(3);
    // We re-emit chunks with LF only, which is fine — the backend parser
    // normalizes line endings.
    expect(chunks[0].startsWith(`${header}\n`)).toBe(true);
  });
});
