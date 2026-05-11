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
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue({ id: 'u1', username: 'alice' });
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
    vi.spyOn(authApi, 'login').mockResolvedValue({ id: 'u2', username: 'bob' });
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
    vi.spyOn(authApi, 'register').mockResolvedValue({ id: 'u3', username: 'cory' });
    const ok = await useAuth.getState().register('cory', 'correct horse battery');
    expect(ok).toBe(true);
    expect(useAuth.getState().user?.id).toBe('u3');
  });
});

describe('logout', () => {
  it('clears user and triggers sync teardown even if API fails', async () => {
    useAuth.setState({ user: { id: 'u', username: 'eve' }, status: 'authed' });
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
