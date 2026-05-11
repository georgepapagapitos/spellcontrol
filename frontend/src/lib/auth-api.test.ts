import { describe, it, expect, vi, beforeEach } from 'vitest';
import { register, login, logout, fetchMe, fetchSync, putSync } from './auth-api';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('register', () => {
  it('posts username + password and returns the user', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({ user: { id: 'u1', username: 'alice' } }, { status: 201 }));
    const u = await register('alice', 'correct horse battery');
    expect(u).toEqual({ id: 'u1', username: 'alice' });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' })
    );
  });

  it('throws with the server-provided error message on failure', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ error: 'taken' }, { status: 409 }));
    await expect(register('alice', 'pw1234567890')).rejects.toThrow(/taken/);
  });
});

describe('login', () => {
  it('returns the user on success', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ user: { id: 'u2', username: 'bob' } })
    );
    const u = await login('bob', 'correct horse battery');
    expect(u.username).toBe('bob');
  });
});

describe('logout', () => {
  it('POSTs to /api/auth/logout', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    await logout();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('fetchMe', () => {
  it('returns null on 401', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 401, headers: { 'Content-Type': 'application/json' } })
    );
    expect(await fetchMe()).toBeNull();
  });

  it('returns the user on 200', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ user: { id: 'u3', username: 'cory' } })
    );
    expect(await fetchMe()).toEqual({ id: 'u3', username: 'cory' });
  });
});

describe('fetchSync', () => {
  it('returns the snapshot', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ collection: null, binders: [], decks: [], version: 0, updatedAt: 1 })
    );
    const snap = await fetchSync();
    expect(snap.version).toBe(0);
  });
});

describe('putSync', () => {
  it('returns version + updatedAt on 200', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ version: 5, updatedAt: 100 }));
    const r = await putSync({ collection: null, binders: [], decks: [], baseVersion: 4 });
    expect(r).toEqual({ version: 5, updatedAt: 100 });
  });

  it('throws with status 409 and current snapshot on conflict', async () => {
    const current = { collection: null, binders: [], decks: [], version: 7, updatedAt: 200 };
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'conflict', current }, { status: 409 })
    );
    let caught: unknown;
    try {
      await putSync({ collection: null, binders: [], decks: [], baseVersion: 0 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error & { status?: number }).status).toBe(409);
    expect((caught as Error & { current?: { version: number } }).current?.version).toBe(7);
  });
});
