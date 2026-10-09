import { describe, it, expect } from 'vitest';
import { isNewerRelease, releaseStamp } from './rules-release.mjs';

// URLs copied from the live rules page and the committed bundle's meta.source.
const COMMITTED = 'https://media.wizards.com/2026/downloads/MagicCompRules%2020260819.txt';
const PUBLISHED = 'https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt';

describe('rules release awareness', () => {
  it('reads the stamp with the space encoded or literal', () => {
    expect(releaseStamp(COMMITTED)).toBe('20260819');
    expect(
      releaseStamp('https://media.wizards.com/2026/downloads/MagicCompRules 20260925.txt')
    ).toBe('20260925');
  });

  it('a newer published release refetches even inside the age gate', () => {
    expect(isNewerRelease(PUBLISHED, COMMITTED)).toBe(true);
  });

  it('the same or an older release does not', () => {
    expect(isNewerRelease(COMMITTED, COMMITTED)).toBe(false);
    expect(isNewerRelease(COMMITTED, PUBLISHED)).toBe(false);
  });

  it('an unreadable stamp never forces a refetch', () => {
    expect(isNewerRelease(null, COMMITTED)).toBe(false);
    expect(isNewerRelease(PUBLISHED, undefined)).toBe(false);
    expect(isNewerRelease('https://example.com/rules.txt', COMMITTED)).toBe(false);
  });
});
