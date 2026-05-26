import { describe, expect, it } from 'vitest';
import { parseBottomStrip } from './scanner-bottom-strip';

describe('parseBottomStrip', () => {
  it('parses the canonical modern format', () => {
    expect(parseBottomStrip('266/277 R MID • EN  Adam Paquette')).toEqual({
      set: 'mid',
      number: '266',
    });
  });

  it('strips leading zeros from the collector number', () => {
    expect(parseBottomStrip('0052/196 C RIX')).toEqual({
      set: 'rix',
      number: '52',
    });
  });

  it('handles the no-denominator legacy form', () => {
    expect(parseBottomStrip('123 • TPR')).toEqual({
      set: 'tpr',
      number: '123',
    });
  });

  it('ignores the language code when picking the set code', () => {
    expect(parseBottomStrip('001/100 M EN NEO • Yuko Shimizu')).toEqual({
      set: 'neo',
      number: '1',
    });
  });

  it('ignores standalone rarity markers', () => {
    expect(parseBottomStrip('045 R BRO')).toEqual({
      set: 'bro',
      number: '45',
    });
  });

  it('skips the copyright year token', () => {
    expect(parseBottomStrip('290 R 2023 CMM • EN')).toEqual({
      set: 'cmm',
      number: '290',
    });
  });

  it('returns null when no plausible number is present', () => {
    expect(parseBottomStrip('R MID • EN Adam Paquette')).toBeNull();
  });

  it('returns null when no plausible set code is present', () => {
    expect(parseBottomStrip('266 R • EN')).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(parseBottomStrip('')).toBeNull();
  });

  it('returns null on whitespace-only input', () => {
    expect(parseBottomStrip('   ')).toBeNull();
  });

  it('handles set codes containing digits (e.g. 30A)', () => {
    expect(parseBottomStrip('012/067 R 30A')).toEqual({
      set: '30a',
      number: '12',
    });
  });

  it('does not pick a pure-digit token as the set code', () => {
    // The 2023 here is a year, not a set — caller should get null since
    // there is no real set code present.
    expect(parseBottomStrip('123 R 2023')).toBeNull();
  });

  it('accepts collector numbers with a trailing star (showcase printings)', () => {
    expect(parseBottomStrip('266★ M NEO • EN')).toEqual({
      set: 'neo',
      number: '266',
    });
  });

  it('lowercases the set code regardless of OCR casing', () => {
    expect(parseBottomStrip('001/100 M neo • EN')).toEqual({
      set: 'neo',
      number: '1',
    });
  });
});
