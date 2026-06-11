import { describe, it, expect } from 'vitest';
import { rarityTint, setSymbolTitle } from './set-symbols';

describe('rarityTint', () => {
  it('maps the tinted tiers case-insensitively', () => {
    expect(rarityTint('uncommon')).toBe('uncommon');
    expect(rarityTint('rare')).toBe('rare');
    expect(rarityTint('Mythic')).toBe('mythic');
  });

  it('falls back to common for missing or unknown rarities', () => {
    expect(rarityTint('common')).toBe('common');
    expect(rarityTint(undefined)).toBe('common');
    expect(rarityTint('special')).toBe('common');
    expect(rarityTint('bonus')).toBe('common');
  });
});

describe('setSymbolTitle', () => {
  it('joins set name, collector number, and rarity', () => {
    expect(
      setSymbolTitle({
        setCode: 'mh2',
        setName: 'Modern Horizons 2',
        collectorNumber: '225',
        rarity: 'rare',
      })
    ).toBe('Modern Horizons 2 · #225 · rare');
  });

  it('falls back to the uppercase set code when the name is unresolved', () => {
    expect(setSymbolTitle({ setCode: 'mh2', collectorNumber: '225', rarity: 'rare' })).toBe(
      'MH2 · #225 · rare'
    );
    expect(setSymbolTitle({ setCode: 'mh2', setName: '', rarity: 'common' })).toBe('MH2 · common');
  });

  it('skips missing parts', () => {
    expect(setSymbolTitle({ setCode: 'mh2' })).toBe('MH2');
  });
});
