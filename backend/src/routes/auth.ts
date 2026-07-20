import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
import { and, eq } from 'drizzle-orm';
import {
  clearSessionCookie,
  generateUsername,
  getAdminUsernames,
  hashPassword,
  isReservedUsername,
  isScryfallArtUrl,
  isScryfallUuid,
  loadAuthedUser,
  loadUserById,
  MIN_PASSWORD_LENGTH,
  normalizeBio,
  normalizeDisplayName,
  normalizeUsername,
  readSessionCookie,
  requireAuth,
  setSessionCookie,
  signSession,
  signLinkIntent,
  signOAuthState,
  signSignupToken,
  userHasOtherSignInMethod,
  validatePassword,
  verifyLinkIntent,
  verifyOAuthState,
  verifyPassword,
  verifySignupToken,
  type OAuthPlatform,
  type UserRole,
} from '../auth';
import {
  autoLinkGoogleIdentity,
  buildGoogleAuthUrl,
  consumeHandoffCode,
  createGoogleUser,
  exchangeGoogleCode,
  findAutoLinkCandidateByEmail,
  findGoogleUser,
  getGoogleConfig,
  isGoogleOAuthConfigured,
  mintHandoffCode,
} from '../oauth/google';
import { logger } from '../logger';
import { getDb } from '../db';
import { authIdentities, users } from '../db/schema';

/**
 * HTTPS deep link the native OAuth flow returns into the app. An Android
 * App Link intent filter (manifest + /.well-known/assetlinks.json) hands
 * this URL straight to the installed APK, sidestepping the browser
 * compatibility issues that the previous `spellcontrol://oauth/callback`
 * custom scheme had (Firefox and Samsung Internet refused to follow the
 * HTTPS → custom-scheme hop, dead-ending the flow). Override the host via
 * `APP_HTTPS_DEEPLINK_BASE` (e.g. for a staging origin); default is prod.
 */
function nativeCallbackUrl(): string {
  const base = (process.env.APP_HTTPS_DEEPLINK_BASE ?? 'https://spellcontrol.com').replace(
    /\/+$/,
    ''
  );
  return `${base}/oauth/callback`;
}

// Disable rate limiting in tests to avoid state persisting across test cases
const registerLimiter = testAwareLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
const loginLimiter = testAwareLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const oauthLimiter = testAwareLimiter({ windowMs: 15 * 60 * 1000, max: 30 });

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
  if (isReservedUsername(username)) {
    return res.status(400).json({ error: 'That username is reserved.' });
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
  // Password signup is anonymous (no email) and open to the public internet, so
  // log the source IP + UA to tell real users from endpoint-probing bots.
  // `trust proxy` (server.ts) makes req.ip the real client, not the Fly edge.
  logger.info(
    `[auth] register "${username}" (${id}) ip=${req.ip} ua=${req.get('user-agent') ?? '?'}`
  );
  // No initial user-data row to create: per-entity tables are empty by default
  // and become populated by the first POST /api/sync from the client.

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

function qs(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Apply a verified Google identity to the user the link-mode state names.
 *
 * Three outcomes, each with a redirect the frontend Settings page can render:
 *   - linked=google         → success (or idempotent re-link to the same user)
 *   - linkError=already_linked → this Google account already belongs to a
 *                                different SpellControl account
 *   - linkError=has_google  → this user already has a (different) Google
 *                             account linked; unlink it first
 */
async function handleLinkCallback(
  res: Response,
  platform: OAuthPlatform,
  userId: string,
  providerSubject: string
): Promise<void> {
  const callback = nativeCallbackUrl();
  const ok =
    platform === 'native' ? `${callback}?${qs({ linked: 'google' })}` : '/settings?linked=google';
  const err = (reason: string): string =>
    platform === 'native'
      ? `${callback}?${qs({ linkError: reason })}`
      : `/settings?linkError=${encodeURIComponent(reason)}`;

  const existing = await findGoogleUser(providerSubject);
  if (existing) {
    res.redirect(existing.id === userId ? ok : err('already_linked'));
    return;
  }
  const db = getDb();
  const userGoogle = await db
    .select({ providerSubject: authIdentities.providerSubject })
    .from(authIdentities)
    .where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, 'google')))
    .limit(1);
  if (userGoogle.length > 0) {
    res.redirect(err('has_google'));
    return;
  }
  await db.insert(authIdentities).values({
    provider: 'google',
    providerSubject,
    userId,
    createdAt: Date.now(),
  });
  res.redirect(ok);
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
  const state = signOAuthState({ platform });
  res.redirect(buildGoogleAuthUrl(cfg, platform, state));
});

/**
 * Start a link-mode Google flow: this attaches the Google identity to the
 * authed user instead of creating or signing in to an account. Web uses the
 * session cookie; native passes a short-lived `?intent` token (because the
 * system browser has no app cookies). Failures redirect the user to /auth
 * (web) or return JSON (native).
 */
authRouter.get('/google/link', oauthLimiter, async (req: Request, res: Response) => {
  const cfg = getGoogleConfig();
  if (!cfg) return res.status(503).json({ error: 'Google sign-in is not enabled.' });
  const platform = oauthPlatform(req.query.platform);

  let userId: string | null = null;
  const intent = typeof req.query.intent === 'string' ? req.query.intent : '';
  if (intent) {
    const verified = verifyLinkIntent(intent);
    if (verified) userId = verified.userId;
  } else {
    const token = readSessionCookie(req);
    const user = token ? await loadAuthedUser(token) : null;
    if (user) userId = user.id;
  }
  if (!userId) {
    if (platform === 'native') {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    return res.redirect('/auth');
  }

  const state = signOAuthState({ platform, mode: 'link', userId });
  res.redirect(buildGoogleAuthUrl(cfg, platform, state));
});

/**
 * Native-only helper: mint a short-lived intent token the app passes to
 * /google/link?intent=…. The system browser has no cookies, so this is how
 * the link route knows which authed user to attach Google to.
 */
authRouter.post('/google/link-intent', oauthLimiter, requireAuth, (req: Request, res: Response) => {
  res.json({ intent: signLinkIntent(req.user!.id) });
});

/**
 * Google redirects here with `?code&state`. Verifies the state and exchanges
 * the code, then branches on whether the account exists:
 *
 *   Returning user — web: set the session cookie, 302 to the app; native:
 *     mint a single-use handoff code and deep-link it back (the system
 *     browser cannot set the WebView's cookie).
 *   First-time user — no account is created yet. The verified identity is
 *     put in a short-lived signup token and the user is sent to the
 *     "choose a username" screen; the account is created at /complete-signup.
 */
authRouter.get('/google/callback', oauthLimiter, async (req: Request, res: Response) => {
  const cfg = getGoogleConfig();
  if (!cfg) return res.status(503).json({ error: 'Google sign-in is not enabled.' });

  // Decode the platform up-front (default web) so every error path can route
  // the browser back to the right place even when the rest of the flow fails.
  const stateToken = typeof req.query.state === 'string' ? req.query.state : '';
  const state = verifyOAuthState(stateToken);
  const platform: OAuthPlatform = state?.platform ?? 'web';
  const errorRedirect =
    platform === 'native' ? `${nativeCallbackUrl()}?error=google` : '/auth?error=google';

  try {
    if (!state) throw new Error('Invalid or expired OAuth state.');
    if (typeof req.query.error === 'string') throw new Error(`Google returned: ${req.query.error}`);
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) throw new Error('Missing authorization code.');

    const identity = await exchangeGoogleCode(cfg, platform, code);

    // Link-mode branch: attach this Google identity to the user named in the
    // state (which only a signed-in /google/link request could have produced).
    if (state.mode === 'link' && state.userId) {
      return handleLinkCallback(res, platform, state.userId, identity.sub);
    }

    const existing = await findGoogleUser(identity.sub);

    if (existing) {
      if (platform === 'native') {
        const handoff = await mintHandoffCode(existing.id);
        return res.redirect(`${nativeCallbackUrl()}?${qs({ code: handoff })}`);
      }
      setSessionCookie(res, signSession(existing));
      return res.redirect('/');
    }

    // Same-email auto-link: Google's `email_verified` proves the user
    // controls this address. If an existing account also has that email
    // and no Google identity attached yet, merge by attaching this
    // identity to it — eliminates the silent-duplicate-account bug. The
    // user sees a "we linked X — was this you?" banner on next /me.
    if (identity.emailVerified && identity.email) {
      const candidate = await findAutoLinkCandidateByEmail(identity.email);
      if (candidate) {
        await autoLinkGoogleIdentity(candidate.id, identity);
        if (platform === 'native') {
          const handoff = await mintHandoffCode(candidate.id);
          return res.redirect(`${nativeCallbackUrl()}?${qs({ code: handoff })}`);
        }
        setSessionCookie(res, signSession(candidate));
        return res.redirect('/');
      }
    }

    // First-time sign-in — defer account creation to the username screen.
    const signupToken = signSignupToken({
      provider: 'google',
      sub: identity.sub,
      email: identity.email,
      emailVerified: identity.emailVerified,
    });
    const suggested = await generateUsername(identity.email ?? 'player');
    if (platform === 'native') {
      return res.redirect(`${nativeCallbackUrl()}?${qs({ signup: signupToken, suggested })}`);
    }
    return res.redirect(`/auth/choose-username#${qs({ token: signupToken, suggested })}`);
  } catch (err) {
    logger.error('[auth] google callback failed:', err);
    return res.redirect(errorRedirect);
  }
});

/**
 * Finish a first-time Google sign-in: the user picked a username on the
 * choose-username screen. Validates it, creates the account from the signup
 * token's verified identity, and sets the session cookie.
 */
authRouter.post('/google/complete-signup', oauthLimiter, async (req: Request, res: Response) => {
  const signupToken = typeof req.body?.signupToken === 'string' ? req.body.signupToken : '';
  const identity = verifySignupToken(signupToken);
  if (!identity) {
    return res
      .status(401)
      .json({ error: 'Your sign-up link expired. Please sign in with Google again.' });
  }

  // Idempotency: if a previous submit already created the account (double
  // click, retry), just sign the user in rather than erroring.
  const existing = await findGoogleUser(identity.sub);
  if (existing) {
    setSessionCookie(res, signSession(existing));
    return res.json({ user: existing });
  }

  const username = normalizeUsername(req.body?.username);
  if (!username) {
    return res.status(400).json({
      error: 'Username must be 3–32 characters and use only lowercase letters, digits, _ and -.',
    });
  }
  if (isReservedUsername(username)) {
    return res.status(400).json({ error: 'That username is reserved.' });
  }
  const db = getDb();
  const taken = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (taken.length > 0) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const user = await createGoogleUser(
    { sub: identity.sub, email: identity.email, emailVerified: identity.emailVerified, name: null },
    username
  );
  setSessionCookie(res, signSession(user));
  res.status(201).json({ user });
});

/**
 * Account linking, password-confirmed: when the username chosen on the
 * sign-up screen is already taken, the user can prove they own that account
 * by providing its password — this attaches the Google identity to it and
 * signs them in (instead of creating a new account). The password is the
 * ownership proof; we never link on email alone.
 */
authRouter.post('/google/link-with-password', oauthLimiter, async (req: Request, res: Response) => {
  const signupToken = typeof req.body?.signupToken === 'string' ? req.body.signupToken : '';
  const identity = verifySignupToken(signupToken);
  if (!identity) {
    return res
      .status(401)
      .json({ error: 'Your sign-up link expired. Please sign in with Google again.' });
  }

  // Race: if the Google identity got linked between this screen rendering
  // and the user submitting (another tab, a retry), just sign them in.
  const alreadyLinked = await findGoogleUser(identity.sub);
  if (alreadyLinked) {
    setSessionCookie(res, signSession(alreadyLinked));
    return res.json({ user: alreadyLinked });
  }

  const username = normalizeUsername(req.body?.username);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  // Generic error on every credential-related failure so we never leak
  // whether the username exists or how it authenticates.
  const failure = () => res.status(401).json({ error: 'Invalid username or password.' });
  if (!username || !password) return failure();
  if (isReservedUsername(username)) {
    return res.status(400).json({ error: 'That username is reserved.' });
  }

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
    // Dummy compare keeps timing roughly constant for unknown users and
    // SSO-only accounts (no password).
    await verifyPassword(password, '$2a$12$abcdefghijklmnopqrstuvCwVlH7bC/uHKRkEy0eOxn3oS2WfXm6Vu');
    return failure();
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return failure();

  // Refuse a second Google link on the same account — the user should sign
  // in with the one already attached.
  const existing = await db
    .select({ providerSubject: authIdentities.providerSubject })
    .from(authIdentities)
    .where(and(eq(authIdentities.userId, user.id), eq(authIdentities.provider, 'google')))
    .limit(1);
  if (existing.length > 0) {
    return res.status(409).json({
      error: 'This account already has a Google account linked. Sign in with that one.',
    });
  }

  await db.insert(authIdentities).values({
    provider: 'google',
    providerSubject: identity.sub,
    userId: user.id,
    createdAt: Date.now(),
  });

  const role: UserRole = user.role === 'admin' ? 'admin' : 'user';
  const authed = { id: user.id, username: user.username, role };
  setSessionCookie(res, signSession(authed));
  res.json({ user: authed });
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
  // Surface the pending auto-link timestamp so the frontend can render the
  // "we linked your Google account — was this you?" banner. Cleared by
  // POST /me/acknowledge-auto-link or implicitly when the user unlinks.
  // Profile fields ride along on this same query (never the JWT — they're
  // user-editable, so every /me reads them fresh from the DB).
  const db = getDb();
  const row = await db
    .select({
      autoLinkedAt: users.autoLinkedAt,
      displayName: users.displayName,
      bio: users.bio,
      avatarCardId: users.avatarCardId,
      avatarCardName: users.avatarCardName,
      avatarImageUrl: users.avatarImageUrl,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  res.json({
    user,
    autoLinkedAt: row[0]?.autoLinkedAt ?? null,
    profile: {
      displayName: row[0]?.displayName ?? null,
      bio: row[0]?.bio ?? null,
      avatarCardId: row[0]?.avatarCardId ?? null,
      avatarCardName: row[0]?.avatarCardName ?? null,
      avatarImageUrl: row[0]?.avatarImageUrl ?? null,
    },
  });
});

interface AvatarInput {
  cardId: string;
  cardName: string;
  imageUrl: string;
}

function isAvatarInput(x: unknown): x is AvatarInput {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.cardId === 'string' && typeof v.cardName === 'string' && typeof v.imageUrl === 'string'
  );
}

const profileLimiter = testAwareLimiter({ windowMs: 60_000, max: 20 });

/**
 * Update the authed user's public-profile fields. Per-field PATCH semantics:
 * a key absent from the body leaves that field unchanged, `null` clears it,
 * any other value is validated then set. Never touches the JWT — profile
 * fields are always read fresh from the DB (see GET /me).
 */
authRouter.patch('/profile', profileLimiter, requireAuth, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const updates: Partial<{
    displayName: string | null;
    bio: string | null;
    avatarCardId: string | null;
    avatarCardName: string | null;
    avatarImageUrl: string | null;
  }> = {};

  if ('displayName' in body) {
    if (body.displayName === null) {
      updates.displayName = null;
    } else {
      const normalized = normalizeDisplayName(body.displayName);
      if (normalized === undefined) {
        return res.status(400).json({ error: 'Display name must be 40 characters or fewer.' });
      }
      if (normalized !== null && isReservedUsername(normalized)) {
        return res.status(400).json({ error: "That name isn't available." });
      }
      updates.displayName = normalized;
    }
  }

  if ('bio' in body) {
    if (body.bio === null) {
      updates.bio = null;
    } else {
      const normalized = normalizeBio(body.bio);
      if (normalized === undefined) {
        return res.status(400).json({ error: 'Bio must be 280 characters or fewer.' });
      }
      updates.bio = normalized;
    }
  }

  if ('avatar' in body) {
    if (body.avatar === null) {
      updates.avatarCardId = null;
      updates.avatarCardName = null;
      updates.avatarImageUrl = null;
    } else if (isAvatarInput(body.avatar)) {
      const { cardId, cardName, imageUrl } = body.avatar;
      if (!isScryfallUuid(cardId)) {
        return res.status(400).json({ error: 'Invalid card id.' });
      }
      if (!isScryfallArtUrl(imageUrl)) {
        return res.status(400).json({ error: 'Invalid avatar image.' });
      }
      updates.avatarCardId = cardId;
      updates.avatarCardName = cardName.trim().slice(0, 200);
      updates.avatarImageUrl = imageUrl;
    } else {
      return res.status(400).json({ error: 'Invalid avatar image.' });
    }
  }

  const db = getDb();
  if (Object.keys(updates).length > 0) {
    await db.update(users).set(updates).where(eq(users.id, req.user!.id));
  }

  const rows = await db
    .select({
      displayName: users.displayName,
      bio: users.bio,
      avatarCardId: users.avatarCardId,
      avatarCardName: users.avatarCardName,
      avatarImageUrl: users.avatarImageUrl,
    })
    .from(users)
    .where(eq(users.id, req.user!.id))
    .limit(1);
  res.json({
    profile: {
      displayName: rows[0]?.displayName ?? null,
      bio: rows[0]?.bio ?? null,
      avatarCardId: rows[0]?.avatarCardId ?? null,
      avatarCardName: rows[0]?.avatarCardName ?? null,
      avatarImageUrl: rows[0]?.avatarImageUrl ?? null,
    },
  });
});

authRouter.delete('/me', requireAuth, async (req: Request, res: Response) => {
  const db = getDb();
  await db.delete(users).where(eq(users.id, req.user!.id));
  clearSessionCookie(res);
  res.json({ ok: true });
});

/**
 * Dismiss the auto-link banner. The user has acknowledged that the Google
 * identity linked via verified-email matches their account; the banner
 * stops appearing on subsequent /me responses.
 */
authRouter.post('/me/acknowledge-auto-link', requireAuth, async (req: Request, res: Response) => {
  const db = getDb();
  await db.update(users).set({ autoLinkedAt: null }).where(eq(users.id, req.user!.id));
  res.json({ ok: true });
});

/**
 * Which external sign-in methods the authed user has linked. Used by the
 * Sign-in methods section in Settings. The Google email isn't returned
 * because we don't persist it on the identity row — Settings shows
 * "Linked / Not linked" only.
 */
authRouter.get('/me/identities', requireAuth, async (req: Request, res: Response) => {
  const db = getDb();
  const userRows = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, req.user!.id))
    .limit(1);
  const googleRows = await db
    .select({ createdAt: authIdentities.createdAt })
    .from(authIdentities)
    .where(and(eq(authIdentities.userId, req.user!.id), eq(authIdentities.provider, 'google')))
    .limit(1);
  res.json({
    password: Boolean(userRows[0]?.passwordHash),
    google: googleRows[0] ? { linkedAt: googleRows[0].createdAt } : null,
  });
});

/**
 * Unlink the user's Google account. Refuses if removing the Google identity
 * would leave the account with no way to sign in (no password and no other
 * external identities). There is no password reset, so once locked out the
 * account is unrecoverable — the check is non-negotiable for any future
 * "remove sign-in method" endpoint too; consult userHasOtherSignInMethod().
 */
authRouter.delete('/me/identities/google', requireAuth, async (req: Request, res: Response) => {
  const db = getDb();
  const exists = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, req.user!.id))
    .limit(1);
  if (!exists[0]) return res.status(404).json({ error: 'Account not found.' });
  const hasOther = await userHasOtherSignInMethod(req.user!.id, {
    kind: 'identity',
    provider: 'google',
  });
  if (!hasOther) {
    return res.status(409).json({
      error: 'Set a password before unlinking Google — it would lock you out of this account.',
    });
  }
  await db
    .delete(authIdentities)
    .where(and(eq(authIdentities.userId, req.user!.id), eq(authIdentities.provider, 'google')));
  // Unlinking implicitly resolves the auto-link banner — no need to make
  // the user click "Got it" first.
  await db.update(users).set({ autoLinkedAt: null }).where(eq(users.id, req.user!.id));
  res.json({ ok: true });
});
