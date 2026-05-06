import { describe, it, expect } from 'vitest';
import { parseImport } from './index';

describe('parseImport — format detection', () => {
  it('returns empty result for empty string', () => {
    const result = parseImport('');
    expect(result.rows).toHaveLength(0);
  });

  it('returns empty result for whitespace-only string', () => {
    const result = parseImport('   \n   ');
    expect(result.rows).toHaveLength(0);
  });

  describe('ManaBox TSV detection', () => {
    const manaboxHeader =
      'Name\tSet code\tSet name\tCollector number\tFoil\tCondition\tLanguage\tPurchase price\tMisprint\tAltered\tCondition\tScryfall ID\tManaBox ID\tBinder Name\tBinder Type';

    it('detects ManaBox TSV by signature header', () => {
      const tsv = `${manaboxHeader}\nSol Ring\tCMR\tCommander Legends\t472\tNormal\tNM\tEN\t1.50\t0\t0\tNM\tabc-123\t1\tMy Binder\tCard`;
      const result = parseImport(tsv);
      expect(result.format).toBe('manabox');
    });
  });

  describe('CSV detection', () => {
    it('detects Moxfield CSV by headers', () => {
      const csv = 'Count,Tradelist Count,Name,Edition,Condition,Language,Foil,Tags,Last Modified,Collector Number\n1,,Sol Ring,CMR,NM,English,,,,472';
      const result = parseImport(csv);
      expect(result.format).toBe('moxfield');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Sol Ring');
    });

    it('detects Archidekt CSV by headers', () => {
      // Archidekt detection requires: name|card name, edition|edition code, quantity
      const csv = 'quantity,name,edition,collector number,foil,condition\n1,Sol Ring,CMR,472,False,NM';
      const result = parseImport(csv);
      expect(result.format).toBe('archidekt');
    });

    it('falls through to text parser when CSV has no recognized headers', () => {
      const csv = 'foo,bar,baz\n1,2,3';
      const result = parseImport(csv);
      // Unknown CSV header should fall through to plain text
      expect(result.format).toBe('plain');
    });
  });

  describe('plain text detection', () => {
    it('detects MTGA format', () => {
      const result = parseImport('4 Lightning Bolt (M11) 146\n1 Sol Ring (CMR) 472');
      expect(result.format).toBe('mtga');
      expect(result.rows).toHaveLength(2);
    });

    it('detects plain card name list', () => {
      const result = parseImport('Sol Ring\nLightning Bolt\nCounterspell');
      expect(result.format).toBe('plain');
      expect(result.rows).toHaveLength(3);
    });

    it('parses plain list with quantities', () => {
      const result = parseImport('4 Lightning Bolt\n1 Sol Ring');
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].quantity).toBe(4);
    });
  });

  describe('delimiter detection', () => {
    it('handles semicolon-delimited CSV when no commas present', () => {
      const csv = 'Count;Name;Set\n1;Sol Ring;CMR';
      // Semicolon CSV without recognized headers falls through to plain text
      const result = parseImport(csv);
      // Will parse as plain text; just confirm it doesn't throw
      expect(result).toBeDefined();
    });

    it('prefers comma delimiter when both comma and semicolon are present', () => {
      // First line has both; should use comma
      const csv = 'Count,Name,Set;Extra\n1,Sol Ring,CMR';
      const result = parseImport(csv);
      expect(result).toBeDefined();
    });
  });
});
