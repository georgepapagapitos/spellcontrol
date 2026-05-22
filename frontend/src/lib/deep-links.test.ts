import { describe, expect, it } from 'vitest';
import { parseDeepLink, parseOAuthCallback } from './deep-links';

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

  it('ignores OAuth callback URLs (handled separately)', () => {
    expect(parseDeepLink('spellcontrol://oauth/callback?code=abc')).toBeNull();
  });
});

describe('parseOAuthCallback', () => {
  it('extracts the handoff code on success', () => {
    expect(parseOAuthCallback('spellcontrol://oauth/callback?code=handoff-123')).toEqual({
      code: 'handoff-123',
    });
  });

  it('reports an error when the callback carries one', () => {
    expect(parseOAuthCallback('spellcontrol://oauth/callback?error=access_denied')).toEqual({
      error: 'access_denied',
    });
  });

  it('falls back to a generic error when neither code nor error is present', () => {
    expect(parseOAuthCallback('spellcontrol://oauth/callback')).toEqual({ error: 'google' });
  });

  it('returns null for share links and non-OAuth URLs', () => {
    expect(parseOAuthCallback('spellcontrol://share/abc123')).toBeNull();
    expect(parseOAuthCallback('https://spellcontrol.app/s/xyz')).toBeNull();
    expect(parseOAuthCallback('not a url')).toBeNull();
  });
});
