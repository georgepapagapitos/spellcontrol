import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { eq } from 'drizzle-orm';
import {
  clearSessionCookie,
  hashPassword,
  loadAuthedUser,
  MIN_PASSWORD_LENGTH,
  normalizeUsername,
  readSessionCookie,
  requireAuth,
  setSessionCookie,
  signSession,
  validatePassword,
  verifyPassword,
} from '../auth';
import { getDb } from '../db';
import { users, userData } from '../db/schema';

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

export const authRouter: Router = Router();

// Custom registration handler to check for duplicate usernames before rate limiting
authRouter.post('/register', async (req: Request, res: Response) => {
  const username = normalizeUsername(req.body?.username);
  const password = validatePassword(req.body?.password);
  if (!username) {
    return res.status(400).json({
      error: 'Username must be 3\u00132 characters and use only lowercase letters, digits, _ and -.',
    });
  }
  if (!password) {
    return res
      .status(400)
      .json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }

  const db = getDb();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (existing.length > 0) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  await new Promise<void>((resolve, reject) => {
    (registerLimiter as unknown as (req: Request, res: Response, next: (err?: unknown) => void) => void)(
      req,
      res,
      (err?: unknown) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      }
    );
  });

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const now = Date.now();
  await db.insert(users).values({ id, username, passwordHash, createdAt: now });
  await db.insert(userData).values({
    userId: id,
    collection: null,
    binders: [],
    decks: [],
    version: 0,
    updatedAt: now,
  });

  const token = signSession({ id, username });
  setSessionCookie(res, token);
  res.status(201).json({ user: { id, username } });
});

authRouter.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const username = normalizeUsername(req.body?.username);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  // Generic error message on every failure path so we never leak whether the
  // account exists.
  const failure = () => res.status(401).json({ error: 'Invalid username or password.' });

  if (!username || !password) return failure();

  const db = getDb();
  const rows = await db
    .select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  const user = rows[0];
  if (!user) {
    // Run a dummy hash compare to keep timing roughly constant whether or not
    // the username exists.
    await verifyPassword(password, '$2a$12$abcdefghijklmnopqrstuvCwVlH7bC/uHKRkEy0eOxn3oS2WfXm6Vu');
    return failure();
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return failure();

  const token = signSession({ id: user.id, username: user.username });
  setSessionCookie(res, token);
  res.json({ user: { id: user.id, username: user.username } });
});

authRouter.post('/logout', (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', async (req: Request, res: Response) => {
  const token = readSessionCookie(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  const user = await loadAuthedUser(token);
  if (!user) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  res.json({ user });
});

authRouter.delete('/me', requireAuth, async (req: Request, res: Response) => {
  const db = getDb();
  await db.delete(users).where(eq(users.id, req.user!.id));
  clearSessionCookie(res);
  res.json({ ok: true });
});
