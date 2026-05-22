import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { eq } from 'drizzle-orm';
import {
  clearSessionCookie,
  getAdminUsernames,
  hashPassword,
  loadAuthedUser,
  loadUserById,
  MIN_PASSWORD_LENGTH,
  normalizeUsername,
  readSessionCookie,
  requireAuth,
  setSessionCookie,
  signSession,
  signOAuthState,
  validatePassword,
  verifyOAuthState,
  verifyPassword,
  type OAuthPlatform,
  type UserRole,
} from '../auth';
import {
  buildGoogleAuthUrl,
  consumeHandoffCode,
  exchangeGoogleCode,
  getGoogleConfig,
  isGoogleOAuthConfigured,
  mintHandoffCode,
  resolveGoogleUser,
} from '../oauth/google';
import { logger } from '../logger';
import { getDb } from '../db';
import { users, userData } from '../db/schema';

/** Custom-scheme deep link the native OAuth flow returns into the app. */
const NATIVE_CALLBACK_SCHEME = 'spellcontrol://oauth/callback';

// Disable rate limiting in tests to avoid state persisting across test cases
const isTest = process.env.NODE_ENV === 'test' || !!process.env.TEST_DATABASE_URL;
const registerLimiter = isTest
  ? (_req: Request, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
const loginLimiter = isTest
  ? (_req: Request, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const oauthLimiter = isTest
  ? (_req: Request, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

export const authRouter: Router = Router();

authRouter.post('/register', registerLimiter, async (req: Request, res: Response) => {
  const username = normalizeUsername(req.body?.username);
  const password = validatePassword(req.body?.password);
  if (!username) {
    return res.status(400).json({
      error: 'Username must be 3–32 characters and use only lowercase letters, digits, _ and -.',
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

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const now = Date.now();
  // If the new username is in ADMIN_USERNAMES, promote on insert so the first
  // login already carries admin privileges. The boot-time bootstrap covers the
  // case where the env var is added *after* the user already exists.
  const role: UserRole = getAdminUsernames().has(username) ? 'admin' : 'user';
  await db.insert(users).values({ id, username, passwordHash, role, createdAt: now });
  await db.insert(userData).values({
    userId: id,
    collection: null,
    binders: [],
    decks: [],
    version: 0,
    updatedAt: now,
  });

  const token = signSession({ id, username, role });
  setSessionCookie(res, token);
  res.status(201).json({ user: { id, username, role } });
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
    .select({
      id: users.id,
      username: users.username,
      passwordHash: users.passwordHash,
      role: users.role,
    })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  const user = rows[0];
  if (!user || !user.passwordHash) {
    // No such user, or an SSO-only account with no password. Run a dummy hash
    // compare to keep timing roughly constant, and return the same generic
    // error either way so we never leak that the account exists or how it
    // authenticates.
    await verifyPassword(password, '$2a$12$abcdefghijklmnopqrstuvCwVlH7bC/uHKRkEy0eOxn3oS2WfXm6Vu');
    return failure();
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return failure();

  const role: UserRole = user.role === 'admin' ? 'admin' : 'user';
  const token = signSession({ id: user.id, username: user.username, role });
  setSessionCookie(res, token);
  res.json({ user: { id: user.id, username: user.username, role } });
});

/**
 * Advertises which sign-in methods this deployment supports. The frontend
 * calls this to decide whether to render the "Continue with Google" button —
 * Google SSO is optional and only enabled when its env vars are configured.
 */
authRouter.get('/providers', (_req: Request, res: Response) => {
  res.json({ password: true, google: isGoogleOAuthConfigured() });
});

function oauthPlatform(raw: unknown): OAuthPlatform {
  return raw === 'native' ? 'native' : 'web';
}

/** Where the callback sends the browser when the flow ends (success or error). */
function oauthRedirect(
  platform: OAuthPlatform,
  outcome: 'ok-native' | 'error',
  code?: string
): string {
  if (platform === 'native') {
    return outcome === 'ok-native'
      ? `${NATIVE_CALLBACK_SCHEME}?code=${encodeURIComponent(code ?? '')}`
      : `${NATIVE_CALLBACK_SCHEME}?error=google`;
  }
  // Web is same-origin with the SPA (Vite proxy in dev, reverse proxy in prod).
  return outcome === 'error' ? '/auth?error=google' : '/';
}

/**
 * Start the Google OAuth flow. Signs a `state` recording the platform, then
 * 302s the browser to Google's consent screen. `?platform=native` is passed
 * by the Capacitor app (system browser); the default is web.
 */
authRouter.get('/google', oauthLimiter, (req: Request, res: Response) => {
  const cfg = getGoogleConfig();
  if (!cfg) return res.status(503).json({ error: 'Google sign-in is not enabled.' });
  const platform = oauthPlatform(req.query.platform);
  const state = signOAuthState(platform);
  res.redirect(buildGoogleAuthUrl(cfg, platform, state));
});

/**
 * Google redirects here with `?code&state`. Verifies the state, exchanges the
 * code, resolves/creates the user, then: web → sets the session cookie and
 * 302s to the app; native → mints a single-use handoff code and deep-links it
 * back into the app (the system browser cannot set the WebView's cookie).
 */
authRouter.get('/google/callback', oauthLimiter, async (req: Request, res: Response) => {
  const cfg = getGoogleConfig();
  if (!cfg) return res.status(503).json({ error: 'Google sign-in is not enabled.' });

  // Decode the platform up-front (default web) so every error path can route
  // the browser back to the right place even when the rest of the flow fails.
  const stateToken = typeof req.query.state === 'string' ? req.query.state : '';
  const state = verifyOAuthState(stateToken);
  const platform: OAuthPlatform = state?.platform ?? 'web';

  try {
    if (!state) throw new Error('Invalid or expired OAuth state.');
    if (typeof req.query.error === 'string') throw new Error(`Google returned: ${req.query.error}`);
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) throw new Error('Missing authorization code.');

    const identity = await exchangeGoogleCode(cfg, platform, code);
    const user = await resolveGoogleUser(identity);

    if (platform === 'native') {
      const handoff = await mintHandoffCode(user.id);
      return res.redirect(oauthRedirect('native', 'ok-native', handoff));
    }
    setSessionCookie(res, signSession(user));
    return res.redirect(oauthRedirect('web', 'ok-native'));
  } catch (err) {
    logger.error('[auth] google callback failed:', err);
    return res.redirect(oauthRedirect(platform, 'error'));
  }
});

/**
 * Native handoff exchange: the app posts the single-use code from the deep
 * link and gets a real session cookie back (this response goes through the
 * Capacitor HTTP bridge, so the cookie lands in the native cookie jar).
 */
authRouter.post('/google/exchange', oauthLimiter, async (req: Request, res: Response) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!code) return res.status(400).json({ error: 'Missing handoff code.' });

  const userId = await consumeHandoffCode(code);
  if (!userId) return res.status(401).json({ error: 'That sign-in link has expired. Try again.' });

  const user = await loadUserById(userId);
  if (!user) return res.status(401).json({ error: 'Account not found.' });

  setSessionCookie(res, signSession(user));
  res.json({ user });
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
