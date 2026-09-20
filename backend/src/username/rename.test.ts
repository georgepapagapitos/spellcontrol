import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestEnv } from '../test-helpers';
import {
  findRenamedOwner,
  renameUser,
  USERNAME_CHANGE_COOLDOWN_MS,
  USERNAME_RESERVE_MS,
  refreshGameResultUsernames,
} from './rename';

let pool: Pool;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const env = await createTestEnv();
  pool = env.pool;
  cleanup = env.cleanup;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

afterEach(async () => {
  await pool.query('DELETE FROM users');
});

let seq = 0;

async function makeUser(username: string, changedAt: number | null = null): Promise<string> {
  const id = `rename-user-${++seq}`;
  await pool.query(
    `INSERT INTO users (id, username, password_hash, created_at, username_changed_at)
     VALUES ($1, $2, 'x', $3, $4)`,
    [id, username, Date.now(), changedAt]
  );
  return id;
}

async function usernameOf(id: string): Promise<string> {
  const { rows } = await pool.query<{ username: string }>(
    'SELECT username FROM users WHERE id = $1',
    [id]
  );
  return rows[0]!.username;
}

async function historyFor(username: string) {
  const { rows } = await pool.query<{ user_id: string; reserved_until: string }>(
    'SELECT user_id, reserved_until FROM username_history WHERE username = $1',
    [username]
  );
  return rows[0] ?? null;
}

describe('renameUser', () => {
  it('moves the account and records the old handle as reserved', async () => {
    const id = await makeUser('oldname');

    const result = await renameUser(id, 'newname');

    expect(result).toEqual({ ok: true, previous: 'oldname' });
    expect(await usernameOf(id)).toBe('newname');
    const history = await historyFor('oldname');
    expect(history?.user_id).toBe(id);
    expect(Number(history?.reserved_until)).toBeGreaterThan(
      Date.now() + USERNAME_RESERVE_MS - 5000
    );
  });

  it('normalizes the input the same way registration does', async () => {
    const id = await makeUser('oldname');
    expect(await renameUser(id, '  NewName  ')).toEqual({ ok: true, previous: 'oldname' });
    expect(await usernameOf(id)).toBe('newname');
  });

  it('rejects a malformed handle, a reserved word, and a no-op', async () => {
    const id = await makeUser('oldname');
    expect(await renameUser(id, 'no')).toEqual({ ok: false, reason: 'invalid' });
    expect(await renameUser(id, 'has spaces')).toEqual({ ok: false, reason: 'invalid' });
    expect(await renameUser(id, 'admin')).toEqual({ ok: false, reason: 'reserved-word' });
    expect(await renameUser(id, 'oldname')).toEqual({ ok: false, reason: 'unchanged' });
    // None of those touched the row.
    expect(await usernameOf(id)).toBe('oldname');
    expect(await historyFor('oldname')).toBeNull();
  });

  it('refuses a handle somebody holds right now', async () => {
    const id = await makeUser('oldname');
    await makeUser('taken');
    expect(await renameUser(id, 'taken')).toEqual({ ok: false, reason: 'taken' });
    expect(await usernameOf(id)).toBe('oldname');
  });

  it("refuses a handle inside somebody else's reserve window", async () => {
    const other = await makeUser('theirs');
    await renameUser(other, 'theirsnew');
    const me = await makeUser('mine');

    const result = await renameUser(me, 'theirs');

    expect(result).toMatchObject({ ok: false, reason: 'held' });
    expect(await usernameOf(me)).toBe('mine');
  });

  it('releases a handle to everyone once the reserve has expired', async () => {
    const other = await makeUser('theirs');
    await renameUser(other, 'theirsnew');
    // Age the reservation past its window.
    await pool.query('UPDATE username_history SET reserved_until = $1 WHERE username = $2', [
      Date.now() - 1000,
      'theirs',
    ]);
    const me = await makeUser('mine');

    expect(await renameUser(me, 'theirs')).toEqual({ ok: true, previous: 'mine' });
    expect(await usernameOf(me)).toBe('theirs');
  });

  it('lets the original owner reclaim their own handle inside the reserve', async () => {
    const id = await makeUser('oldname');
    await renameUser(id, 'newname');
    // The cooldown is the only thing in the way, so clear it: this is about
    // the reserve not applying to yourself.
    await pool.query('UPDATE users SET username_changed_at = NULL WHERE id = $1', [id]);

    expect(await renameUser(id, 'oldname')).toEqual({ ok: true, previous: 'newname' });
    expect(await usernameOf(id)).toBe('oldname');
  });

  it('stops redirecting a handle the moment somebody else claims it', async () => {
    const other = await makeUser('theirs');
    await renameUser(other, 'theirsnew');
    expect(await findRenamedOwner('theirs')).toBe('theirsnew');

    await pool.query('UPDATE username_history SET reserved_until = $1 WHERE username = $2', [
      Date.now() - 1000,
      'theirs',
    ]);
    const me = await makeUser('mine');
    await renameUser(me, 'theirs');

    // The redirect is gone, rather than pointing visitors at the wrong person.
    expect(await findRenamedOwner('theirs')).toBeNull();
  });

  it('enforces the cooldown, reporting when the next change is allowed', async () => {
    const changedAt = Date.now() - 1000;
    const id = await makeUser('oldname', changedAt);

    const result = await renameUser(id, 'newname');

    expect(result).toEqual({
      ok: false,
      reason: 'cooldown',
      nextChangeAt: changedAt + USERNAME_CHANGE_COOLDOWN_MS,
    });
    expect(await usernameOf(id)).toBe('oldname');
  });

  it('allows the next change once the cooldown has elapsed', async () => {
    const id = await makeUser('oldname', Date.now() - USERNAME_CHANGE_COOLDOWN_MS - 1000);
    expect(await renameUser(id, 'newname')).toEqual({ ok: true, previous: 'oldname' });
  });
});

describe('findRenamedOwner', () => {
  it('resolves a released handle to its owner, outlasting the reserve window', async () => {
    const id = await makeUser('oldname');
    await renameUser(id, 'newname');
    await pool.query('UPDATE username_history SET reserved_until = $1 WHERE username = $2', [
      Date.now() - 1000,
      'oldname',
    ]);

    // The reserve governs who may TAKE it; the redirect lasts while unclaimed.
    expect(await findRenamedOwner('oldname')).toBe('newname');
  });

  it('is null for a handle that was never released', async () => {
    await makeUser('oldname');
    expect(await findRenamedOwner('oldname')).toBeNull();
    expect(await findRenamedOwner('never-existed')).toBeNull();
  });

  it('follows a chain of renames to the account as it is now', async () => {
    const id = await makeUser('first');
    await renameUser(id, 'second');
    await pool.query('UPDATE users SET username_changed_at = NULL WHERE id = $1', [id]);
    await renameUser(id, 'third');

    expect(await findRenamedOwner('first')).toBe('third');
    expect(await findRenamedOwner('second')).toBe('third');
  });

  it('frees every handle an account held when the account is deleted', async () => {
    const id = await makeUser('oldname');
    await renameUser(id, 'newname');
    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    expect(await historyFor('oldname')).toBeNull();
    expect(await findRenamedOwner('oldname')).toBeNull();
  });
});

describe('refreshGameResultUsernames', () => {
  async function makeResult(sessionId: string, participants: unknown[]): Promise<void> {
    await pool.query(
      `INSERT INTO game_results
         (session_id, code, format, starting_life, ended_at, duration_ms, participants, created_at)
       VALUES ($1, 'CODE', 'commander', 40, $2, 1000, $3::jsonb, $2)`,
      [sessionId, Date.now(), JSON.stringify(participants)]
    );
  }

  async function participantsOf(
    sessionId: string
  ): Promise<{ userId: string; username: string }[]> {
    const { rows } = await pool.query<{ participants: { userId: string; username: string }[] }>(
      'SELECT participants FROM game_results WHERE session_id = $1',
      [sessionId]
    );
    return rows[0]!.participants;
  }

  it('rewrites only this account inside the snapshot, keeping seat order', async () => {
    const id = await makeUser('player');
    await makeResult('sess-1', [
      { userId: 'other-1', username: 'alpha', seat: 1 },
      { userId: id, username: 'player', seat: 2 },
      { userId: 'other-2', username: 'omega', seat: 3 },
    ]);

    expect(await refreshGameResultUsernames(id, 'newplayer')).toBe(1);

    // Order matters: seats are read positionally elsewhere, so a jsonb_agg
    // without ORDER BY would silently reshuffle the table.
    expect(await participantsOf('sess-1')).toEqual([
      { userId: 'other-1', username: 'alpha', seat: 1 },
      { userId: id, username: 'newplayer', seat: 2 },
      { userId: 'other-2', username: 'omega', seat: 3 },
    ]);
  });

  it('leaves games this account did not play in untouched', async () => {
    const id = await makeUser('absent');
    await makeResult('sess-2', [{ userId: 'someone-else', username: 'stranger', seat: 1 }]);

    expect(await refreshGameResultUsernames(id, 'renamed')).toBe(0);
    expect(await participantsOf('sess-2')).toEqual([
      { userId: 'someone-else', username: 'stranger', seat: 1 },
    ]);
  });

  it('fills in a participant row that carried no username at all', async () => {
    // The user_games backfill wrote `username: null` for legacy rows.
    const id = await makeUser('legacy');
    await makeResult('sess-3', [{ userId: id, username: null, seat: 1 }]);

    expect(await refreshGameResultUsernames(id, 'legacyname')).toBe(1);
    expect(await participantsOf('sess-3')).toEqual([
      { userId: id, username: 'legacyname', seat: 1 },
    ]);
  });
});
