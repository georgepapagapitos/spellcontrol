import { describe, it, expect, vi, beforeEach } from 'vitest';
import { register, login, logout, deleteAccount, fetchMe, pullSync, pushSync } from './auth-api';

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
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ user: { id: 'u1', username: 'alice' } }, { status: 201 }));
    const u = await register('alice', 'correct horse battery');
    expect(u).toEqual({ id: 'u1', username: 'alice' });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' })
    );
  });

  it('throws with the server-provided error message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'taken' }, { status: 409 })
    );
    await expect(register('alice', 'pw1234567890')).rejects.toThrow(/taken/);
  });
});

describe('login', () => {
  it('returns the user on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ user: { id: 'u2', username: 'bob' } })
    );
    const u = await login('bob', 'correct horse battery');
    expect(u.username).toBe('bob');
  });
});

describe('logout', () => {
  it('POSTs to /api/auth/logout', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    await logout();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('deleteAccount', () => {
  it('DELETEs /api/auth/me', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    await deleteAccount();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({ method: 'DELETE', credentials: 'same-origin' })
    );
  });

  it('throws with the server error message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Not authenticated.' }, { status: 401 })
    );
    await expect(deleteAccount()).rejects.toThrow(/not authenticated/i);
  });
});

describe('fetchMe', () => {
  it('returns null on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 401, headers: { 'Content-Type': 'application/json' } })
    );
    expect(await fetchMe()).toBeNull();
  });

  it('returns the user + autoLinkedAt on 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ user: { id: 'u3', username: 'cory' }, autoLinkedAt: null })
    );
    expect(await fetchMe()).toEqual({
      user: { id: 'u3', username: 'cory' },
      autoLinkedAt: null,
    });
  });

  it('surfaces a non-null autoLinkedAt for the banner', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ user: { id: 'u3', username: 'cory' }, autoLinkedAt: 1700000000000 })
    );
    expect(await fetchMe()).toEqual({
      user: { id: 'u3', username: 'cory' },
      autoLinkedAt: 1700000000000,
    });
  });

  it('tolerates older /me responses without autoLinkedAt by defaulting it to null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ user: { id: 'u3', username: 'cory' } })
    );
    expect(await fetchMe()).toEqual({
      user: { id: 'u3', username: 'cory' },
      autoLinkedAt: null,
    });
  });
});

describe('pullSync', () => {
  it('GETs /api/sync?since=<cursor> and returns the delta page', async () => {
    const page = {
      rows: [{ kind: 'binder', id: 'b-1', data: { id: 'b-1' }, rev: 3, deletedAt: null }],
      cursor: 3,
      hasMore: false,
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(page));
    const r = await pullSync(0);
    expect(r.cursor).toBe(3);
    expect(r.rows[0].id).toBe('b-1');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/sync?since=0',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' })
    );
  });

  it('forwards the optional limit param', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ rows: [], cursor: 0, hasMore: false }));
    await pullSync(42, 100);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/sync?since=42&limit=100',
      expect.objectContaining({ method: 'GET' })
    );
  });
});

describe('pushSync', () => {
  it('POSTs the delta batch and returns applied revs + cursor', async () => {
    const applied = [{ kind: 'binder', id: 'b-1', rev: 5, deletedAt: null }];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ applied, cursor: 5 }));
    const r = await pushSync({
      upserts: [{ kind: 'binder', id: 'b-1', data: { id: 'b-1' } }],
      deletions: [],
    });
    expect(r.cursor).toBe(5);
    expect(r.applied).toEqual(applied);
    expect(fetchSpy).toHaveBeenCalledWith('/api/sync', expect.objectContaining({ method: 'POST' }));
  });
});
