import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuth } from './auth';
import * as authApi from '../lib/auth-api';
import * as sync from '../lib/sync';

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.setState({ user: null, status: 'unknown', error: null });
});

describe('bootstrap', () => {
  it('moves to authed when /me returns a user', async () => {
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue({ id: 'u1', username: 'alice', role: 'user' });
    await useAuth.getState().bootstrap();
    expect(useAuth.getState().status).toBe('authed');
    expect(useAuth.getState().user?.username).toBe('alice');
  });

  it('moves to guest when /me returns null', async () => {
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue(null);
    await useAuth.getState().bootstrap();
    expect(useAuth.getState().status).toBe('guest');
  });

  it('treats network failure as guest', async () => {
    vi.spyOn(authApi, 'fetchMe').mockRejectedValue(new Error('offline'));
    await useAuth.getState().bootstrap();
    expect(useAuth.getState().status).toBe('guest');
  });
});

describe('login / register', () => {
  it('login success sets the user and clears errors', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({ id: 'u2', username: 'bob', role: 'user' });
    const ok = await useAuth.getState().login('bob', 'correct horse battery');
    expect(ok).toBe(true);
    expect(useAuth.getState().status).toBe('authed');
    expect(useAuth.getState().error).toBeNull();
  });

  it('login failure surfaces the error and returns false', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(new Error('Invalid username or password.'));
    const ok = await useAuth.getState().login('bob', 'wrong');
    expect(ok).toBe(false);
    expect(useAuth.getState().error).toMatch(/invalid/i);
  });

  it('register success sets the user', async () => {
    vi.spyOn(authApi, 'register').mockResolvedValue({ id: 'u3', username: 'cory', role: 'user' });
    const ok = await useAuth.getState().register('cory', 'correct horse battery');
    expect(ok).toBe(true);
    expect(useAuth.getState().user?.id).toBe('u3');
  });
});

describe('completeGoogleOAuth', () => {
  it('exchanges the handoff code and authes the user', async () => {
    vi.spyOn(authApi, 'exchangeGoogleCode').mockResolvedValue({
      id: 'g1',
      username: 'googler',
      role: 'user',
    });
    const ok = await useAuth.getState().completeGoogleOAuth('handoff-code');
    expect(ok).toBe(true);
    expect(useAuth.getState().status).toBe('authed');
    expect(useAuth.getState().user?.username).toBe('googler');
  });

  it('surfaces an error and stays a guest when the exchange fails', async () => {
    vi.spyOn(authApi, 'exchangeGoogleCode').mockRejectedValue(new Error('expired'));
    const ok = await useAuth.getState().completeGoogleOAuth('stale-code');
    expect(ok).toBe(false);
    expect(useAuth.getState().status).toBe('guest');
    expect(useAuth.getState().error).toMatch(/expired/i);
  });
});

describe('completeGoogleSignup', () => {
  it('creates the account and authes on a chosen username', async () => {
    vi.spyOn(authApi, 'completeGoogleSignup').mockResolvedValue({
      id: 'g2',
      username: 'picked',
      role: 'user',
    });
    const ok = await useAuth.getState().completeGoogleSignup('signup-token', 'picked');
    expect(ok).toBe(true);
    expect(useAuth.getState().status).toBe('authed');
    expect(useAuth.getState().user?.username).toBe('picked');
  });

  it('surfaces an error when the username is taken', async () => {
    vi.spyOn(authApi, 'completeGoogleSignup').mockRejectedValue(
      new Error('That username is already taken.')
    );
    const ok = await useAuth.getState().completeGoogleSignup('signup-token', 'taken');
    expect(ok).toBe(false);
    expect(useAuth.getState().error).toMatch(/taken/i);
  });
});

describe('logout', () => {
  it('clears user and triggers sync teardown even if API fails', async () => {
    useAuth.setState({ user: { id: 'u', username: 'eve', role: 'user' }, status: 'authed' });
    vi.spyOn(authApi, 'logout').mockRejectedValue(new Error('offline'));
    const flushSpy = vi.spyOn(sync, 'flushSync').mockResolvedValue();
    const stopSpy = vi.spyOn(sync, 'stopSyncAndWipeLocal').mockResolvedValue();
    await useAuth.getState().logout();
    expect(useAuth.getState().status).toBe('guest');
    expect(useAuth.getState().user).toBeNull();
    expect(flushSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
  });
});

describe('deleteAccount', () => {
  it('signs out and wipes local state on success', async () => {
    useAuth.setState({ user: { id: 'u', username: 'eve', role: 'user' }, status: 'authed' });
    const delSpy = vi.spyOn(authApi, 'deleteAccount').mockResolvedValue();
    const flushSpy = vi.spyOn(sync, 'flushSync').mockResolvedValue();
    const stopSpy = vi.spyOn(sync, 'stopSyncAndWipeLocal').mockResolvedValue();
    const ok = await useAuth.getState().deleteAccount();
    expect(ok).toBe(true);
    expect(delSpy).toHaveBeenCalled();
    // Must NOT flush pending writes — that would re-push deleted data.
    expect(flushSpy).not.toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
    expect(useAuth.getState().status).toBe('guest');
    expect(useAuth.getState().user).toBeNull();
  });

  it('keeps the user signed in and surfaces the error when the API fails', async () => {
    useAuth.setState({ user: { id: 'u', username: 'eve', role: 'user' }, status: 'authed' });
    vi.spyOn(authApi, 'deleteAccount').mockRejectedValue(new Error('Not authenticated.'));
    const stopSpy = vi.spyOn(sync, 'stopSyncAndWipeLocal').mockResolvedValue();
    const ok = await useAuth.getState().deleteAccount();
    expect(ok).toBe(false);
    expect(stopSpy).not.toHaveBeenCalled();
    expect(useAuth.getState().status).toBe('authed');
    expect(useAuth.getState().error).toMatch(/not authenticated/i);
  });
});
