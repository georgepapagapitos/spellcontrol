import { describe, it, expect } from 'vitest';
import { formatIdentity, standaloneIdentity } from './display-name';

describe('formatIdentity', () => {
  it('prefers the display name as primary, with @username as secondary', () => {
    expect(formatIdentity({ username: 'alice', displayName: 'Alice A.' })).toEqual({
      primary: 'Alice A.',
      secondary: '@alice',
    });
  });

  it('falls back to username with no secondary when displayName is unset', () => {
    expect(formatIdentity({ username: 'alice', displayName: null })).toEqual({
      primary: 'alice',
      secondary: null,
    });
    expect(formatIdentity({ username: 'alice' })).toEqual({
      primary: 'alice',
      secondary: null,
    });
  });

  it('treats a whitespace-only display name as unset', () => {
    expect(formatIdentity({ username: 'alice', displayName: '   ' })).toEqual({
      primary: 'alice',
      secondary: null,
    });
  });

  it('trims a display name with surrounding whitespace', () => {
    expect(formatIdentity({ username: 'alice', displayName: '  Alice A.  ' })).toEqual({
      primary: 'Alice A.',
      secondary: '@alice',
    });
  });
});

describe('standaloneIdentity', () => {
  it('uses the display name when one is set', () => {
    expect(standaloneIdentity({ username: 'alice', displayName: 'Alice A.' })).toBe('Alice A.');
  });

  it('keeps the @ on the username when no display name is set, so it reads as a handle', () => {
    expect(standaloneIdentity({ username: 'alice', displayName: null })).toBe('@alice');
    expect(standaloneIdentity({ username: 'alice' })).toBe('@alice');
    expect(standaloneIdentity({ username: 'alice', displayName: '  ' })).toBe('@alice');
  });
});
