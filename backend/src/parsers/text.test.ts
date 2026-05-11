import { describe, it, expect } from 'vitest';
import { parseTextList } from './text';

describe('parseTextList', () => {
  describe('MTGA full format (qty name (set) collector)', () => {
    it('parses a standard MTGA line', () => {
      const { rows, format } = parseTextList('1 Sol Ring (CMR) 472');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        name: 'Sol Ring',
        quantity: 1,
        setCode: 'CMR',
        collectorNumber: '472',
        sourceFormat: 'mtga',
      });
      expect(format).toBe('mtga');
    });

    it('parses quantity > 1', () => {
      const { rows } = parseTextList('4 Lightning Bolt (M11) 146');
      expect(rows[0].quantity).toBe(4);
    });

    it('accepts "x" after quantity', () => {
      const { rows } = parseTextList('4x Lightning Bolt (M11) 146');
      expect(rows[0].quantity).toBe(4);
      expect(rows[0].name).toBe('Lightning Bolt');
    });

    it('parses set codes with numbers and mixed case', () => {
      const { rows } = parseTextList('1 Forest (2XM) 400');
      expect(rows[0].setCode).toBe('2XM');
    });

    it('handles special collector numbers (★ and letters)', () => {
      const { rows } = parseTextList('1 Black Lotus (LEA) ★');
      expect(rows[0].collectorNumber).toBe('★');
    });
  });

  describe('MTGA no-collector format (qty name (set))', () => {
    it('parses MTGA line without collector number', () => {
      const { rows, format } = parseTextList('1 Llanowar Elves (M10)');
      expect(rows[0]).toMatchObject({
        name: 'Llanowar Elves',
        quantity: 1,
        setCode: 'M10',
        sourceFormat: 'mtga',
      });
      expect(rows[0].collectorNumber).toBeUndefined();
      expect(format).toBe('mtga');
    });
  });

  describe('qty+name format', () => {
    it('parses "4 Lightning Bolt" without set', () => {
      const { rows, format } = parseTextList('4 Lightning Bolt');
      expect(rows[0]).toMatchObject({ name: 'Lightning Bolt', quantity: 4, sourceFormat: 'plain' });
      expect(format).toBe('plain');
    });

    it('parses "4x Lightning Bolt" with x separator', () => {
      const { rows } = parseTextList('4x Lightning Bolt');
      expect(rows[0]).toMatchObject({ name: 'Lightning Bolt', quantity: 4 });
    });
  });

  describe('plain name only', () => {
    it('parses a bare card name with quantity 1', () => {
      const { rows, format } = parseTextList('Sol Ring');
      expect(rows[0]).toMatchObject({ name: 'Sol Ring', quantity: 1, sourceFormat: 'plain' });
      expect(format).toBe('plain');
    });
  });

  describe('finish marker extraction', () => {
    it('strips *FOIL* suffix and sets finish to foil', () => {
      const { rows } = parseTextList('1 Lightning Bolt *FOIL*');
      expect(rows[0].name).toBe('Lightning Bolt');
      expect(rows[0].finish).toBe('foil');
    });

    it('strips *F* suffix and sets finish to foil', () => {
      const { rows } = parseTextList('1 Lightning Bolt *F*');
      expect(rows[0].name).toBe('Lightning Bolt');
      expect(rows[0].finish).toBe('foil');
    });

    it('strips [FOIL] suffix and sets finish to foil', () => {
      const { rows } = parseTextList('1 Lightning Bolt [FOIL]');
      expect(rows[0].name).toBe('Lightning Bolt');
      expect(rows[0].finish).toBe('foil');
    });

    it('is case-insensitive for foil stripping', () => {
      const { rows } = parseTextList('1 Lightning Bolt *foil*');
      expect(rows[0].name).toBe('Lightning Bolt');
      expect(rows[0].finish).toBe('foil');
    });

    it('strips *ETCHED* suffix and sets finish to etched', () => {
      const { rows } = parseTextList('1 Sol Ring *ETCHED*');
      expect(rows[0].name).toBe('Sol Ring');
      expect(rows[0].finish).toBe('etched');
    });

    it('strips [ETCHED] suffix and sets finish to etched', () => {
      const { rows } = parseTextList('1 Sol Ring [ETCHED]');
      expect(rows[0].name).toBe('Sol Ring');
      expect(rows[0].finish).toBe('etched');
    });

    it('leaves finish undefined for cards without markers', () => {
      const { rows } = parseTextList('1 Sol Ring');
      expect(rows[0].finish).toBeUndefined();
    });
  });

  describe('comments and empty lines', () => {
    it('skips empty lines', () => {
      const { rows } = parseTextList('\n\n1 Sol Ring\n\n');
      expect(rows).toHaveLength(1);
    });

    it('skips lines starting with //', () => {
      const { rows } = parseTextList('// This is a comment\n1 Sol Ring');
      expect(rows).toHaveLength(1);
    });

    it('skips lines starting with #', () => {
      const { rows } = parseTextList('# Comment\n1 Sol Ring');
      expect(rows).toHaveLength(1);
    });
  });

  describe('section headers', () => {
    it('skips "Deck" section header', () => {
      const { rows } = parseTextList('Deck\n1 Sol Ring');
      expect(rows).toHaveLength(1);
    });

    it('skips "Sideboard" section header', () => {
      const { rows } = parseTextList('1 Sol Ring\nSideboard\n1 Lightning Bolt');
      expect(rows).toHaveLength(2);
    });

    it('skips "Commander" section header (case-insensitive)', () => {
      const { rows } = parseTextList('COMMANDER\n1 Sol Ring');
      expect(rows).toHaveLength(1);
    });

    it('skips "Maybeboard" and "Companion" headers', () => {
      const { rows } = parseTextList('Maybeboard\n1 Sol Ring\nCompanion\n1 Lightning Bolt');
      expect(rows).toHaveLength(2);
    });
  });

  describe('multi-line lists', () => {
    it('parses a mixed MTGA list', () => {
      const input = [
        'Deck',
        '4 Lightning Bolt (M11) 146',
        '1 Sol Ring (CMR) 472',
        '',
        'Sideboard',
        "1 Tormod's Crypt (M21) 240",
      ].join('\n');
      const { rows, format } = parseTextList(input);
      expect(rows).toHaveLength(3);
      expect(format).toBe('mtga');
    });

    it('parses a plain name list', () => {
      const input = 'Sol Ring\nLightning Bolt\nCounterspell';
      const { rows, format } = parseTextList(input);
      expect(rows).toHaveLength(3);
      expect(format).toBe('plain');
    });

    it('detects mtga format when at least one line is MTGA', () => {
      const input = '1 Sol Ring (CMR) 472\nLightning Bolt';
      const { format } = parseTextList(input);
      expect(format).toBe('mtga');
    });
  });

  describe('double-faced cards', () => {
    it('preserves DFC names with // separator', () => {
      const { rows } = parseTextList('1 Fire // Ice (APC) 128');
      expect(rows[0].name).toBe('Fire // Ice');
    });
  });

  describe('BOM handling', () => {
    it('strips leading BOM character', () => {
      const { rows } = parseTextList('﻿1 Sol Ring');
      expect(rows[0].name).toBe('Sol Ring');
    });
  });

  describe('empty input', () => {
    it('returns empty rows for empty string', () => {
      const { rows } = parseTextList('');
      expect(rows).toHaveLength(0);
    });

    it('returns empty rows for whitespace-only input', () => {
      const { rows } = parseTextList('   \n  \n  ');
      expect(rows).toHaveLength(0);
    });
  });
});
