// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuth } from './auth';
import * as authApi from '../lib/auth-api';
import type { Profile } from '../lib/auth-api';
import * as sync from '../lib/sync';
import { hasEverVisited } from '../lib/first-run';

const EMPTY_PROFILE: Profile = {
  displayName: null,
  bio: null,
  avatarCardId: null,
  avatarCardName: null,
  avatarImageUrl: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  useAuth.setState({
    user: null,
    status: 'unknown',
    error: null,
    autoLinkedAt: null,
    profile: null,
  });
  localStorage.clear();
  // signInAs() fires a background fetchMe() after login/register/OAuth to
  // hydrate `profile` (bootstrap() alone only covers the page-reload path —
  // see store/auth.ts). Default to a no-op here so tests that don't care
  // about profile don't make a real network call; tests that do override
  // this per-test.
  vi.spyOn(authApi, 'fetchMe').mockResolvedValue(null);
});

describe('bootstrap', () => {
  it('moves to authed when /me returns a user', async () => {
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue({
      user: { id: 'u1', username: 'alice', role: 'user' },
      autoLinkedAt: null,
      profile: EMPTY_PROFILE,
    });
    await useAuth.getState().bootstrap();
    expect(useAuth.getState().status).toBe('authed');
    expect(useAuth.getState().user?.username).toBe('alice');
    expect(useAuth.getState().autoLinkedAt).toBeNull();
  });

  it('threads profile from /me into the store', async () => {
    const profile: Profile = { ...EMPTY_PROFILE, displayName: 'Alice', bio: 'Cube nut.' };
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue({
      user: { id: 'u1', username: 'alice', role: 'user' },
      autoLinkedAt: null,
      profile,
    });
    await useAuth.getState().bootstrap();
    expect(useAuth.getState().profile).toEqual(profile);
  });

  it('leaves profile null offline even with a remembered identity (never cached)', async () => {
    localStorage.setItem(
      'spellcontrol:auth-user',
      JSON.stringify({ id: 'u1', username: 'alice', role: 'user' })
    );
    vi.spyOn(authApi, 'fetchMe').mockRejectedValue(new Error('offline'));
    await useAuth.getState().bootstrap();
    expect(useAuth.getState().status).toBe('authed');
    expect(useAuth.getState().profile).toBeNull();
  });

  it('moves to guest when /me returns null', async () => {
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue(null);
    await useAuth.getState().bootstrap();
    expect(useAuth.getState().status).toBe('guest');
  });

  it('treats network failure as guest when no identity is remembered', async () => {
    vi.spyOn(authApi, 'fetchMe').mockRejectedValue(new Error('offline'));
    await useAuth.getState().bootstrap();
    expect(useAuth.getState().status).toBe('guest');
  });

  it('stays authed offline when a signed-in identity is remembered', async () => {
    // Simulate a prior online sign-in having persisted the identity.
    localStorage.setItem(
      'spellcontrol:auth-user',
      JSON.stringify({ id: 'u1', username: 'alice', role: 'user' })
    );
    vi.spyOn(authApi, 'fetchMe').mockRejectedValue(new Error('offline'));
    await useAuth.getState().bootstrap();
    expect(useAuth.getState().status).toBe('authed');
    expect(useAuth.getState().user?.username).toBe('alice');
  });

  it('forgets the remembered identity on a real 401 (signed out elsewhere)', async () => {
    localStorage.setItem(
      'spellcontrol:auth-user',
      JSON.stringify({ id: 'u1', username: 'alice', role: 'user' })
    );
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue(null);
    await useAuth.getState().bootstrap();
    expect(useAuth.getState().status).toBe('guest');
    expect(localStorage.getItem('spellcontrol:auth-user')).toBeNull();
  });

  it('threads autoLinkedAt from /me into the store', async () => {
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue({
      user: { id: 'u1', username: 'alice', role: 'user' },
      autoLinkedAt: 1700000000000,
      profile: EMPTY_PROFILE,
    });
    await useAuth.getState().bootstrap();
    expect(useAuth.getState().autoLinkedAt).toBe(1700000000000);
  });
});

describe('acknowledgeAutoLink', () => {
  it('optimistically clears autoLinkedAt and POSTs the acknowledgement', async () => {
    useAuth.setState({
      user: { id: 'u1', username: 'alice', role: 'user' },
      status: 'authed',
      autoLinkedAt: 1700000000000,
    });
    const spy = vi.spyOn(authApi, 'acknowledgeAutoLink').mockResolvedValue();
    await useAuth.getState().acknowledgeAutoLink();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(useAuth.getState().autoLinkedAt).toBeNull();
  });

  it('swallows server failures (next /me will resurface if still pending)', async () => {
    useAuth.setState({ autoLinkedAt: 1700000000000 });
    vi.spyOn(authApi, 'acknowledgeAutoLink').mockRejectedValue(new Error('offline'));
    await expect(useAuth.getState().acknowledgeAutoLink()).resolves.toBeUndefined();
    expect(useAuth.getState().autoLinkedAt).toBeNull();
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

  it('login success hydrates profile from a background /me fetch', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({ id: 'u2', username: 'bob', role: 'user' });
    const profile: Profile = { ...EMPTY_PROFILE, displayName: 'Bob' };
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue({
      user: { id: 'u2', username: 'bob', role: 'user' },
      autoLinkedAt: null,
      profile,
    });
    await useAuth.getState().login('bob', 'correct horse battery');
    // The background fetchMe() is fire-and-forget; flush its microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(useAuth.getState().profile).toEqual(profile);
  });

  it('login success swallows a failed background profile fetch', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({ id: 'u2', username: 'bob', role: 'user' });
    vi.spyOn(authApi, 'fetchMe').mockRejectedValue(new Error('offline'));
    await expect(useAuth.getState().login('bob', 'correct horse battery')).resolves.toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    // Sign-in itself still succeeded; profile just stays null (Settings will
    // show its loading state) rather than the background fetch's rejection
    // surfacing anywhere.
    expect(useAuth.getState().status).toBe('authed');
    expect(useAuth.getState().profile).toBeNull();
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
    const result = await useAuth.getState().completeGoogleSignup('signup-token', 'picked');
    expect(result.ok).toBe(true);
    expect(useAuth.getState().status).toBe('authed');
    expect(useAuth.getState().user?.username).toBe('picked');
  });

  it('surfaces the 409 status so the page can offer the link flow', async () => {
    const err = Object.assign(new Error('That username is already taken.'), { status: 409 });
    vi.spyOn(authApi, 'completeGoogleSignup').mockRejectedValue(err);
    const result = await useAuth.getState().completeGoogleSignup('signup-token', 'taken');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(useAuth.getState().error).toMatch(/taken/i);
  });
});

describe('first-run flag side effect', () => {
  it('login success marks the device as ever-visited', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({ id: 'u', username: 'a', role: 'user' });
    expect(hasEverVisited()).toBe(false);
    await useAuth.getState().login('a', 'pw');
    expect(hasEverVisited()).toBe(true);
  });

  it('login failure does not mark the device', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue(new Error('nope'));
    await useAuth.getState().login('a', 'pw');
    expect(hasEverVisited()).toBe(false);
  });

  it('register success marks the device', async () => {
    vi.spyOn(authApi, 'register').mockResolvedValue({ id: 'u', username: 'a', role: 'user' });
    await useAuth.getState().register('a', 'pw');
    expect(hasEverVisited()).toBe(true);
  });

  it('completeGoogleOAuth success marks the device', async () => {
    vi.spyOn(authApi, 'exchangeGoogleCode').mockResolvedValue({
      id: 'g',
      username: 'g',
      role: 'user',
    });
    await useAuth.getState().completeGoogleOAuth('code');
    expect(hasEverVisited()).toBe(true);
  });

  it('completeGoogleSignup success marks the device', async () => {
    vi.spyOn(authApi, 'completeGoogleSignup').mockResolvedValue({
      id: 'g',
      username: 'g',
      role: 'user',
    });
    await useAuth.getState().completeGoogleSignup('tok', 'g');
    expect(hasEverVisited()).toBe(true);
  });

  it('linkGoogleWithPassword success marks the device', async () => {
    vi.spyOn(authApi, 'linkGoogleWithPassword').mockResolvedValue({
      id: 'u',
      username: 'u',
      role: 'user',
    });
    await useAuth.getState().linkGoogleWithPassword('tok', 'u', 'pw');
    expect(hasEverVisited()).toBe(true);
  });
});

describe('linkGoogleWithPassword', () => {
  it('attaches Google to a verified existing account', async () => {
    vi.spyOn(authApi, 'linkGoogleWithPassword').mockResolvedValue({
      id: 'u1',
      username: 'george',
      role: 'user',
    });
    const ok = await useAuth
      .getState()
      .linkGoogleWithPassword('signup-token', 'george', 'correct horse battery');
    expect(ok).toBe(true);
    expect(useAuth.getState().status).toBe('authed');
    expect(useAuth.getState().user?.username).toBe('george');
  });

  it('surfaces an error on a bad password', async () => {
    vi.spyOn(authApi, 'linkGoogleWithPassword').mockRejectedValue(
      new Error('Invalid username or password.')
    );
    const ok = await useAuth.getState().linkGoogleWithPassword('signup-token', 'george', 'wrong');
    expect(ok).toBe(false);
    expect(useAuth.getState().error).toMatch(/invalid/i);
  });
});

describe('logout', () => {
  it('clears user and triggers sync teardown even if API fails', async () => {
    useAuth.setState({
      user: { id: 'u', username: 'eve', role: 'user' },
      status: 'authed',
      profile: { ...EMPTY_PROFILE, displayName: 'Eve' },
    });
    vi.spyOn(authApi, 'logout').mockRejectedValue(new Error('offline'));
    const flushSpy = vi.spyOn(sync, 'flushSync').mockResolvedValue();
    const stopSpy = vi.spyOn(sync, 'stopSyncAndWipeLocal').mockResolvedValue();
    await useAuth.getState().logout();
    expect(useAuth.getState().status).toBe('guest');
    expect(useAuth.getState().user).toBeNull();
    // A stale profile must not linger for the next account signed into this
    // session (a mid-session account switch, no page reload).
    expect(useAuth.getState().profile).toBeNull();
    expect(flushSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
  });
});

describe('deleteAccount', () => {
  it('signs out and wipes local state on success', async () => {
    useAuth.setState({
      user: { id: 'u', username: 'eve', role: 'user' },
      status: 'authed',
      profile: { ...EMPTY_PROFILE, displayName: 'Eve' },
    });
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
    expect(useAuth.getState().profile).toBeNull();
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
