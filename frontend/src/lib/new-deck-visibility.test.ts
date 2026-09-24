import { describe, expect, it } from 'vitest';
import { useAuth } from '../store/auth';
import { defaultNewDeckVisibility } from './new-deck-visibility';

describe('defaultNewDeckVisibility', () => {
  it('is public for a signed-in account', () => {
    useAuth.setState({ status: 'authed' });
    expect(defaultNewDeckVisibility()).toBe('public');
  });

  it('is nothing for a guest or while auth is still loading, so signing in never publishes', () => {
    for (const status of ['guest', 'unknown', 'loading'] as const) {
      useAuth.setState({ status });
      expect(defaultNewDeckVisibility()).toBeUndefined();
    }
  });
});
