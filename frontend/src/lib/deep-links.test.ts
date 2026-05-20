import { describe, expect, it } from 'vitest';
import { parseDeepLink } from './deep-links';

describe('parseDeepLink', () => {
  it('routes spellcontrol://share/<token> to /s/<token>', () => {
    expect(parseDeepLink('spellcontrol://share/abc123')).toBe('/s/abc123');
  });

  it('accepts the ?token=<…> query-string variant', () => {
    expect(parseDeepLink('spellcontrol://share?token=def456')).toBe('/s/def456');
  });

  it('percent-encodes tokens with reserved characters', () => {
    expect(parseDeepLink('spellcontrol://share/abc 123')).toBe('/s/abc%20123');
  });

  it('rejects an unknown host on the custom scheme', () => {
    expect(parseDeepLink('spellcontrol://decks/abc')).toBeNull();
  });

  it('rejects bare spellcontrol://share with no token', () => {
    expect(parseDeepLink('spellcontrol://share')).toBeNull();
  });

  it('routes https://<domain>/s/<token> to /s/<token>', () => {
    expect(parseDeepLink('https://spellcontrol.app/s/xyz')).toBe('/s/xyz');
  });

  it('handles trailing slashes', () => {
    expect(parseDeepLink('https://spellcontrol.app/s/xyz/')).toBe('/s/xyz');
  });

  it('ignores https URLs without an /s/ segment', () => {
    expect(parseDeepLink('https://spellcontrol.app/decks')).toBeNull();
  });

  it('returns null on garbage input', () => {
    expect(parseDeepLink('not a url')).toBeNull();
    expect(parseDeepLink('')).toBeNull();
  });
});
