import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { users } from './db/schema';

const COOKIE_NAME = 'binder_session';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface AuthedUser {
  id: string;
  username: string;
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
  return jwt.sign({ sub: user.id, username: user.username }, getJwtSecret(), {
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

export function verifySession(token: string): AuthedUser | null {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string' || typeof payload.username !== 'string') return null;
    return { id: payload.sub, username: payload.username };
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
 */
export async function loadAuthedUser(token: string): Promise<AuthedUser | null> {
  const claims = verifySession(token);
  if (!claims) return null;
  const db = getDb();
  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, claims.id))
    .limit(1);
  return rows[0] ?? null;
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
