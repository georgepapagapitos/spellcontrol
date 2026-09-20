import { and, eq, gt, ne } from 'drizzle-orm';
import { getDb, getPool } from '../db';
import { usernameHistory, users } from '../db/schema';
import { isReservedUsername, normalizeUsername } from '../auth';
import { isUniqueViolation } from '../oauth/google';

/**
 * How long an account must wait between username changes. Renaming is cheap
 * for the person doing it and expensive for everyone pointing at them, so the
 * cooldown exists to keep a handle meaningful for at least a month at a time
 * (and to make handle-cycling a poor impersonation tool).
 */
export const USERNAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a released handle stays off the market for everyone except the
 * account that released it. Long enough that "I renamed and someone
 * immediately took my old name to trade off my reputation" is not a thing
 * that can happen quietly, short enough that the namespace recovers.
 */
export const USERNAME_RESERVE_MS = 90 * 24 * 60 * 60 * 1000;

export type RenameFailure =
  /** Fails the charset/length rules. */
  | { ok: false; reason: 'invalid' }
  /** A route word or other identifier the app reserves for itself. */
  | { ok: false; reason: 'reserved-word' }
  /** Already the caller's own username. */
  | { ok: false; reason: 'unchanged' }
  /** Somebody else holds it right now. */
  | { ok: false; reason: 'taken' }
  /** Somebody else released it recently and still has first claim. */
  | { ok: false; reason: 'held'; heldUntil: number }
  /** The caller renamed too recently. */
  | { ok: false; reason: 'cooldown'; nextChangeAt: number };

export type RenameResult = { ok: true; previous: string } | RenameFailure;

/**
 * Move an account to a new username, releasing the old one.
 *
 * Everything that makes this safe happens in one transaction: the old handle
 * lands in `username_history` (so `/u/<old>` keeps resolving and nobody else
 * may take it for `USERNAME_RESERVE_MS`), any history row for the NEW handle
 * is deleted (so a redirect never survives the handle being re-claimed, which
 * would send visitors to the wrong person), and the cooldown stamp moves.
 *
 * The caller is responsible for what lives outside the database: purging the
 * public caches keyed by the old handle and re-issuing the session cookie,
 * whose JWT carries a username claim.
 */
export async function renameUser(userId: string, raw: unknown): Promise<RenameResult> {
  const next = normalizeUsername(raw);
  if (!next) return { ok: false, reason: 'invalid' };
  if (isReservedUsername(next)) return { ok: false, reason: 'reserved-word' };

  const now = Date.now();
  const db = getDb();

  return db.transaction(async (tx): Promise<RenameResult> => {
    const rows = await tx
      .select({ username: users.username, changedAt: users.usernameChangedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const current = rows[0];
    // requireAuth already resolved this id against the row, so a miss here
    // means the account was deleted mid-request.
    if (!current) return { ok: false, reason: 'invalid' };
    if (current.username === next) return { ok: false, reason: 'unchanged' };

    if (current.changedAt != null) {
      const nextChangeAt = current.changedAt + USERNAME_CHANGE_COOLDOWN_MS;
      if (now < nextChangeAt) return { ok: false, reason: 'cooldown', nextChangeAt };
    }

    // Held by a live account?
    const live = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, next))
      .limit(1);
    if (live.length > 0) return { ok: false, reason: 'taken' };

    // Reserved by someone else's release? Your own former handle is always
    // yours to take back, reserve window or not.
    const reserved = await tx
      .select({ userId: usernameHistory.userId, reservedUntil: usernameHistory.reservedUntil })
      .from(usernameHistory)
      .where(
        and(
          eq(usernameHistory.username, next),
          ne(usernameHistory.userId, userId),
          gt(usernameHistory.reservedUntil, now)
        )
      )
      .limit(1);
    if (reserved.length > 0) {
      return { ok: false, reason: 'held', heldUntil: reserved[0]!.reservedUntil };
    }

    // Claiming the handle retires its redirect: from here on `/u/<next>` is
    // this account, and must not bounce to whoever held it before.
    await tx.delete(usernameHistory).where(eq(usernameHistory.username, next));

    await tx
      .insert(usernameHistory)
      .values({
        username: current.username,
        userId,
        releasedAt: now,
        reservedUntil: now + USERNAME_RESERVE_MS,
      })
      .onConflictDoUpdate({
        target: usernameHistory.username,
        set: { userId, releasedAt: now, reservedUntil: now + USERNAME_RESERVE_MS },
      });

    try {
      await tx
        .update(users)
        .set({ username: next, usernameChangedAt: now })
        .where(eq(users.id, userId));
    } catch (err) {
      // Two renames racing for the same free handle: the loser sees the
      // unique index, not a corrupt half-rename (the transaction rolls back).
      if (isUniqueViolation(err)) return { ok: false, reason: 'taken' };
      throw err;
    }

    return { ok: true, previous: current.username };
  });
}

/**
 * Rewrite this account's username inside every game result that carries a
 * snapshot of it.
 *
 * `game_results.participants` denormalizes the username at write time, on
 * purpose, so reading a results list needs no join — the field's own comment
 * used to justify it with "(no rename feature)". There is one now, so the
 * snapshots have to be maintained instead: without this, every game an
 * account ever played keeps showing the handle they had that day.
 *
 * The `@>` containment predicate rides the existing GIN index on
 * `participants`, which keys on `userId` rather than on the username, so a
 * rename never has to scan the table.
 */
export async function refreshGameResultUsernames(
  userId: string,
  username: string
): Promise<number> {
  const { rowCount } = await getPool().query(
    `UPDATE game_results
        SET participants = (
          SELECT jsonb_agg(
            CASE WHEN p->>'userId' = $1 THEN jsonb_set(p, '{username}', to_jsonb($2::text)) ELSE p END
            ORDER BY ord
          )
          FROM jsonb_array_elements(participants) WITH ORDINALITY AS t(p, ord)
        )
      WHERE participants @> $3::jsonb`,
    [userId, username, JSON.stringify([{ userId }])]
  );
  return rowCount ?? 0;
}

/**
 * The account that used to hold `username`, for a handle nobody holds now.
 * Null when the handle was never released, or when it has since been claimed
 * by someone else (claiming deletes the history row, so this can never point
 * at the wrong account).
 *
 * Deliberately NOT limited to the reserve window: the reserve governs who may
 * TAKE a handle, while the redirect lasts as long as the handle is unclaimed.
 * A link posted years ago keeps working until the name genuinely belongs to
 * somebody else.
 */
export async function findRenamedOwner(username: string): Promise<string | null> {
  const rows = await getDb()
    .select({ username: users.username })
    .from(usernameHistory)
    .innerJoin(users, eq(users.id, usernameHistory.userId))
    .where(eq(usernameHistory.username, username))
    .limit(1);
  return rows[0]?.username ?? null;
}
