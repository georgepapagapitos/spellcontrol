import { describe, it, expect } from 'vitest';
import { buildSynergyFingerprint, synergyScore, topMatchedTags } from './synergyFingerprint';

// Fake tag map so these exercise the math without loading tagger data.
const TAGS: Record<string, string[]> = {
  'Sol Ring': ['ramp', 'mana-rock'],
  'Arcane Signet': ['ramp', 'mana-rock'],
  Cultivate: ['ramp'],
  Counterspell: ['removal', 'counterspell'],
  Forest: [], // untagged card contributes nothing
};
const tagsOf = (name: string) => TAGS[name] ?? [];

describe('buildSynergyFingerprint', () => {
  it('is empty for an empty deck', () => {
    expect(buildSynergyFingerprint([], tagsOf).size).toBe(0);
  });

  it('counts tags as a fraction of all deck cards (untagged cards included in the denominator)', () => {
    const fp = buildSynergyFingerprint(['Sol Ring', 'Cultivate', 'Forest'], tagsOf);
    expect(fp.get('ramp')).toBeCloseTo(2 / 3); // 2 of 3 cards
    expect(fp.get('mana-rock')).toBeCloseTo(1 / 3); // 1 of 3 cards
    expect(fp.has('removal')).toBe(false);
  });
});

describe('synergyScore', () => {
  const fp = buildSynergyFingerprint(['Sol Ring', 'Cultivate', 'Forest'], tagsOf);

  it('rewards candidates sharing the deck’s dominant tags', () => {
    // Arcane Signet (ramp+mana-rock) matches the ramp-heavy deck better than
    // Counterspell (no shared tags → 0).
    expect(synergyScore('Arcane Signet', fp, tagsOf)).toBeGreaterThan(
      synergyScore('Counterspell', fp, tagsOf)
    );
    expect(synergyScore('Counterspell', fp, tagsOf)).toBe(0);
  });

  it('sums the matched tags’ frequencies', () => {
    expect(synergyScore('Arcane Signet', fp, tagsOf)).toBeCloseTo(2 / 3 + 1 / 3);
  });
});

describe('topMatchedTags', () => {
  const fp = buildSynergyFingerprint(['Sol Ring', 'Cultivate', 'Forest'], tagsOf);

  it('returns the shared tags most-represented in the deck first', () => {
    // ramp (2/3) is more represented than mana-rock (1/3), so it leads.
    expect(topMatchedTags('Arcane Signet', fp, 3, tagsOf)).toEqual(['ramp', 'mana-rock']);
  });

  it('drops tags the deck fingerprint doesn’t have', () => {
    // Counterspell's tags (removal, counterspell) aren't in this ramp deck.
    expect(topMatchedTags('Counterspell', fp, 3, tagsOf)).toEqual([]);
  });

  it('caps to the limit', () => {
    expect(topMatchedTags('Arcane Signet', fp, 1, tagsOf)).toEqual(['ramp']);
  });
});
