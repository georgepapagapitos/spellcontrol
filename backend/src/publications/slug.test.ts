import { describe, it, expect } from 'vitest';
import { generateDeckSlug } from './slug';

describe('generateDeckSlug', () => {
  it('slugifies punctuation, emoji, diacritics, and mixed case', () => {
    const slug = generateDeckSlug("Éclair Zöe's Deck!! 🔥🐉");
    expect(slug).toMatch(/^eclair-zoes-deck-[0-9a-f]{8}$/);
  });

  it('falls back to "deck" for an all-symbol name', () => {
    const slug = generateDeckSlug('🔥🔥🔥 !!! ---');
    expect(slug).toMatch(/^deck-[0-9a-f]{8}$/);
  });

  it('always appends exactly 8 lowercase hex characters', () => {
    const slug = generateDeckSlug('Simple Name');
    const suffix = slug.slice(slug.lastIndexOf('-') + 1);
    expect(suffix).toMatch(/^[0-9a-f]{8}$/);
  });

  it('produces different slugs for the identical name (random suffix, not deterministic)', () => {
    const a = generateDeckSlug('Same Name');
    const b = generateDeckSlug('Same Name');
    expect(a).not.toBe(b);
  });

  it('caps the slugified base at 60 characters before the suffix', () => {
    const slug = generateDeckSlug('A'.repeat(100));
    const base = slug.slice(0, slug.lastIndexOf('-'));
    expect(base.length).toBeLessThanOrEqual(60);
    expect(base).toBe('a'.repeat(60));
  });
});
