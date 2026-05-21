import { describe, it, expect } from 'vitest';
import {
  getQueryForTheme,
  getKeywordsForTheme,
  buildQueriesFromThemes,
  getAllThemeNames,
} from './themeMapper';

describe('getQueryForTheme', () => {
  it('returns the mapped query for a known theme', () => {
    const q = getQueryForTheme('tokens');
    expect(q).not.toBeNull();
    expect(q?.primary).toContain('token');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(getQueryForTheme('  ToKeNs  ')).toEqual(getQueryForTheme('tokens'));
  });

  it('returns null for an unknown theme', () => {
    expect(getQueryForTheme('definitely-not-a-theme')).toBeNull();
  });
});

describe('getKeywordsForTheme', () => {
  it('returns the keyword list for a known theme', () => {
    expect(Array.isArray(getKeywordsForTheme('tokens'))).toBe(true);
  });

  it('returns an empty list for an unknown theme', () => {
    expect(getKeywordsForTheme('nope')).toEqual([]);
  });
});

describe('buildQueriesFromThemes', () => {
  it('returns the plain-creature fallback when no theme resolves', () => {
    expect(buildQueriesFromThemes(['nope', 'also-nope'])).toEqual({
      creatureQuery: 't:creature',
      synergyQuery: '',
      keywords: [],
    });
  });

  it('ORs primaries into the synergy query and dedupes keywords', () => {
    const result = buildQueriesFromThemes(['tokens', 'tokens']);
    expect(result.synergyQuery).toContain(' OR ');
    // Same theme twice → keywords are de-duplicated.
    expect(result.keywords).toEqual([...new Set(result.keywords)]);
  });

  it('skips themes that do not resolve', () => {
    const known = buildQueriesFromThemes(['tokens']);
    const mixed = buildQueriesFromThemes(['tokens', 'unknown-theme']);
    expect(mixed.synergyQuery).toBe(known.synergyQuery);
  });
});

describe('getAllThemeNames', () => {
  it('lists every mapped theme name', () => {
    const names = getAllThemeNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('tokens');
  });
});
