import { describe, expect, it } from 'vitest';
import { signInPath } from './sign-in-path';

describe('signInPath', () => {
  it('carries the current page as returnTo', () => {
    expect(signInPath('/friends')).toBe('/auth?returnTo=%2Ffriends');
    expect(signInPath('/play?tab=online')).toBe('/auth?returnTo=%2Fplay%3Ftab%3Donline');
  });

  it('sends the root and the auth pages to a bare /auth', () => {
    expect(signInPath('/')).toBe('/auth');
    expect(signInPath('')).toBe('/auth');
    expect(signInPath('/auth')).toBe('/auth');
    expect(signInPath('/auth/choose-username')).toBe('/auth');
  });
});
