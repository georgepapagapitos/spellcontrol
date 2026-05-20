import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { users } from './db/schema';

const COOKIE_NAME = 'spellcontrol_session';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type UserRole = 'user' | 'admin';

export interface AuthedUser {
  id: string;
  username: string;
  role: UserRole;
}

function asRole(raw: string | null | undefined): UserRole {
  return raw === 'admin' ? 'admin' : 'user';
}

/**
 * Parse the `ADMIN_USERNAMES` env var into a normalized set. Comma-separated,
 * case-insensitive, whitespace-tolerant. Empty/unset → empty set. Read fresh
 * each call so operators can change the env without rebuilding the image and
 * tests can flip the gate per-case.
 */
export function getAdminUsernames(): Set<string> {
  const raw = process.env.ADMIN_USERNAMES;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET is not set or is too short (minimum 16 chars).');
  }
  return secret;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSession(user: AuthedUser): string {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, getJwtSecret(), {
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

export function verifySession(token: string): AuthedUser | null {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string' || typeof payload.username !== 'string') return null;
    return { id: payload.sub, username: payload.username, role: asRole(payload.role as string) };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function readSessionCookie(req: Request): string | null {
  const raw = (req as Request & { cookies?: Record<string, string> }).cookies?.[COOKIE_NAME];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * Middleware that requires a valid session. Populates req.user, otherwise
 * responds with 401.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = readSessionCookie(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const user = verifySession(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session.' });
    return;
  }
  req.user = user;
  next();
}

/**
 * Loads the current user fresh from the DB to confirm they still exist. Use
 * for /auth/me — cheap and avoids "ghost" sessions for deleted accounts.
 * Returns the *current* role from the DB, not whatever was in the cookie, so
 * a freshly-promoted admin sees the admin UI on next /auth/me without having
 * to re-login. (The cookie itself can still be stale for up to TOKEN_TTL —
 * admin route checks rely on requireAdmin, which also hits the DB.)
 */
export async function loadAuthedUser(token: string): Promise<AuthedUser | null> {
  const claims = verifySession(token);
  if (!claims) return null;
  const db = getDb();
  const rows = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(users)
    .where(eq(users.id, claims.id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, username: row.username, role: asRole(row.role) };
}

/**
 * Middleware that requires the caller be authenticated *and* hold the admin
 * role. Loads the role fresh from the DB so a demote takes effect immediately
 * without waiting for the JWT to expire. 401 for no session, 403 for not-admin.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = readSessionCookie(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const user = await loadAuthedUser(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session.' });
    return;
  }
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Admin required.' });
    return;
  }
  req.user = user;
  next();
}

export const USERNAME_REGEX = /^[a-z0-9_-]{3,32}$/;
export const MIN_PASSWORD_LENGTH = 10;

export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  return USERNAME_REGEX.test(trimmed) ? trimmed : null;
}

export function validatePassword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length < MIN_PASSWORD_LENGTH || raw.length > 200) return null;
  return raw;
}
