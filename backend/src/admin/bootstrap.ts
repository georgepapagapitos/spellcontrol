import { inArray } from 'drizzle-orm';
import { getAdminUsernames } from '../auth';
import { getDb } from '../db';
import { users } from '../db/schema';

/**
 * Promote any user whose username appears in `ADMIN_USERNAMES` to role='admin'.
 * Additive — never demotes. Runs at server boot after `ensureSchema()` so the
 * column exists. Safe to call when the env var is unset (no-op) or when the
 * named users haven't registered yet (no rows match, no-op).
 *
 * Why additive: if you remove a friend's username from ADMIN_USERNAMES, they
 * keep admin until you explicitly demote via the admin UI / SQL. This avoids
 * silent demotion from a stray .env edit. If you want strict env-as-source-of-
 * truth, demote manually.
 */
export async function promoteAdminsAtBoot(): Promise<void> {
  const names = getAdminUsernames();
  if (names.size === 0) return;
  const db = getDb();
  const result = await db
    .update(users)
    .set({ role: 'admin' })
    .where(inArray(users.username, [...names]))
    .returning({ username: users.username });
  if (result.length > 0) {
    console.log(
      `[admin] promoted ${result.length} user(s) to admin: ${result.map((r) => r.username).join(', ')}`
    );
  }
}
