import { logger } from '../logger';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getAdminEmails } from '../auth';
import { getDb } from '../db';
import { users } from '../db/schema';

/**
 * Promote any user whose VERIFIED email appears in `ADMIN_EMAILS` to
 * role='admin'. Additive — never demotes. Runs at server boot after
 * `ensureSchema()` so the column exists. Safe to call when the env var is
 * unset (no-op) or when the named users haven't registered yet (no rows
 * match, no-op).
 *
 * Why verified-only: an unverified address is just a string somebody typed
 * into a form, so matching it would let anyone who guesses a seeded address
 * mint themselves an admin seat by signing up with it. `email_verified` means
 * the account actually received mail there (or Google asserted it).
 *
 * Why additive: if you remove a friend's email from ADMIN_EMAILS, they keep
 * admin until you explicitly revoke it from the admin panel. This avoids
 * silent demotion from a stray .env edit. If you want strict env-as-source-
 * of-truth, revoke in the panel.
 *
 * This seed is only how the FIRST admin comes to exist on a fresh database.
 * Ongoing changes go through `PATCH /api/admin/users/:id/role`, which is
 * keyed on the immutable `users.id`.
 */
export async function promoteAdminsAtBoot(): Promise<void> {
  const emails = getAdminEmails();
  if (emails.size === 0) return;
  const db = getDb();
  const result = await db
    .update(users)
    .set({ role: 'admin' })
    .where(and(isSeededAdminEmail([...emails]), eq(users.emailVerified, true)))
    .returning({ username: users.username });
  if (result.length > 0) {
    logger.info(
      `[admin] promoted ${result.length} user(s) to admin: ${result.map((r) => r.username).join(', ')}`
    );
  }
}

/**
 * Case-insensitive membership test for the seed list. Addresses are stored as
 * the user typed them, so the comparison lowercases the column rather than
 * trusting the stored casing (`getAdminEmails` already lowercases the var).
 */
function isSeededAdminEmail(emails: string[]) {
  return inArray(sql`lower(${users.email})`, emails);
}

/**
 * The same seed check for one account, at the moment its email becomes
 * verified — so a seeded operator who verifies after boot doesn't have to
 * wait for a restart to get their seat. Additive, like the boot pass.
 */
export async function promoteIfSeededAdmin(userId: string, email: string): Promise<boolean> {
  if (!getAdminEmails().has(email.trim().toLowerCase())) return false;
  const promoted = await getDb()
    .update(users)
    .set({ role: 'admin' })
    .where(and(eq(users.id, userId), eq(users.emailVerified, true)))
    .returning({ username: users.username });
  if (promoted.length > 0) {
    logger.info(`[admin] promoted "${promoted[0]!.username}" (${userId}) on email verification`);
  }
  return promoted.length > 0;
}
