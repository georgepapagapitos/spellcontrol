import { describe, it, expect } from 'vitest';
import { symbolToClass, colorGlyph } from './mana-symbols';

describe('symbolToClass', () => {
  it('maps a plain mana symbol to its cost glyph class', () => {
    expect(symbolToClass('W')).toBe('ms ms-w ms-cost');
    expect(symbolToClass('2')).toBe('ms ms-2 ms-cost');
    expect(symbolToClass('X')).toBe('ms ms-x ms-cost');
  });

  it('lowercases and strips slashes, flagging hybrids as split', () => {
    expect(symbolToClass('2/W')).toBe('ms ms-2w ms-cost ms-split');
    expect(symbolToClass('B/G')).toBe('ms ms-bg ms-cost ms-split');
  });

  it('handles tap and other named symbols', () => {
    expect(symbolToClass('T')).toBe('ms ms-t ms-cost');
  });
});

describe('colorGlyph', () => {
  it('maps the five WUBRG colors to their lowercase glyph token', () => {
    expect(colorGlyph('W')).toBe('w');
    expect(colorGlyph('U')).toBe('u');
    expect(colorGlyph('B')).toBe('b');
    expect(colorGlyph('R')).toBe('r');
    expect(colorGlyph('G')).toBe('g');
  });

  it('is case-insensitive', () => {
    expect(colorGlyph('w')).toBe('w');
    expect(colorGlyph('g')).toBe('g');
  });

  it('maps multicolor and the colorless aliases', () => {
    expect(colorGlyph('M')).toBe('multicolor');
    expect(colorGlyph('C')).toBe('c');
    expect(colorGlyph('L')).toBe('c');
  });

  it('falls back to colorless for unknown keys', () => {
    expect(colorGlyph('?')).toBe('c');
    expect(colorGlyph('')).toBe('c');
  });
});
