import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
import { promoteIfSeededAdmin } from '../admin/bootstrap';
import { refreshGameResultUsernames, renameUser } from '../username/rename';
import { invalidatePublicUserCache } from '../publications/cache';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  clearSessionCookie,
  generateUsername,
  hashPassword,
  isReservedUsername,
  isScryfallArtUrl,
  isScryfallUuid,
  loadAuthedUser,
  loadUserById,
  MIN_PASSWORD_LENGTH,
  consumeOAuthNonce,
  issueOAuthNonce,
  normalizeBio,
  normalizeDisplayName,
  normalizeUsername,
  readSessionCookie,
  requireAuth,
  setSessionCookie,
  signSession,
  signOAuthState,
  signSignupToken,
  userHasOtherSignInMethod,
  validatePassword,
  verifyOAuthState,
  verifyPassword,
  verifySignupToken,
  type UserRole,
} from '../auth';
import {
  adoptVerifiedGoogleEmail,
  autoLinkGoogleIdentity,
  buildGoogleAuthUrl,
  createGoogleUser,
  exchangeGoogleCode,
  findAutoLinkCandidateByEmail,
  findGoogleUser,
  getGoogleConfig,
  isGoogleOAuthConfigured,
  isUniqueViolation,
  type GoogleIdentity,
} from '../oauth/google';
import { logger } from '../logger';
import { getDb } from '../db';
import { authIdentities, authTokens, users } from '../db/schema';
import { purgeUserPublicCaches } from '../publications/purge';
import { sendMail } from '../mail';

/**
 * The web app's own origin — used to build links that land back in the app
 * (OAuth deep links, and now the account-recovery email links). Override via
 * `APP_HTTPS_DEEPLINK_BASE` (e.g. for a staging origin); default is prod.
 */
export function publicWebOrigin(): string {
  return (process.env.APP_HTTPS_DEEPLINK_BASE ?? 'https://spellcontrol.com').replace(/\/+$/, '');
}

// Disable rate limiting in tests to avoid state persisting across test cases
const registerLimiter = testAwareLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
const loginLimiter = testAwareLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const oauthLimiter = testAwareLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
// Session bootstrap reads (/providers, /me): hit on every app open and focus.
const sessionLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });
// Account recovery (T117).
const emailChangeLimiter = testAwareLimiter({ windowMs: 60 * 60 * 1000, max: 10 });
const emailResendLimiter = testAwareLimiter({ windowMs: 60 * 60 * 1000, max: 3 });
const verifyEmailLimiter = testAwareLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
const forgotPasswordLimiter = testAwareLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
const resetPasswordLimiter = testAwareLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const passwordChangeLimiter = testAwareLimiter({ windowMs: 60 * 60 * 1000, max: 10 });
// Renaming is cooldown-limited in the database; this only stops a client
// hammering the validation path.
const usernameChangeLimiter = testAwareLimiter({ windowMs: 60 * 60 * 1000, max: 10 });

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

type TokenPurpose = 'reset' | 'verify';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Mints a single-use recovery token, invalidating the user's older unused
 * tokens of the same purpose first (so a stale "reset your password" email
 * from an hour ago can't be replayed once a fresh one has been requested).
 * Returns the raw token — only its hash is ever persisted.
 */
async function issueAuthToken(
  userId: string,
  purpose: TokenPurpose,
  email?: string
): Promise<string> {
  const db = getDb();
  const now = Date.now();
  await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(
      and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt))
    );
  const token = crypto.randomBytes(32).toString('base64url');
  await db.insert(authTokens).values({
    id: crypto.randomUUID(),
    userId,
    purpose,
    tokenHash: hashToken(token),
    email: email ?? null,
    expiresAt: now + (purpose === 'reset' ? RESET_TOKEN_TTL_MS : VERIFY_TOKEN_TTL_MS),
    usedAt: null,
    createdAt: now,
  });
  return token;
}

/** Validates + consumes a token (marks it used). Null on unknown/expired/used. */
async function consumeAuthToken(
  token: string,
  purpose: TokenPurpose
): Promise<{ userId: string; email: string | null } | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: authTokens.id,
      userId: authTokens.userId,
      email: authTokens.email,
      expiresAt: authTokens.expiresAt,
      usedAt: authTokens.usedAt,
    })
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, hashToken(token)), eq(authTokens.purpose, purpose)))
    .limit(1);
  const row = rows[0];
  if (!row || row.usedAt !== null || row.expiresAt < Date.now()) return null;
  await db.update(authTokens).set({ usedAt: Date.now() }).where(eq(authTokens.id, row.id));
  return { userId: row.userId, email: row.email };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 && trimmed.length <= 254 && EMAIL_REGEX.test(trimmed) ? trimmed : null;
}

function verifyEmailContent(link: string): { subject: string; text: string; html: string } {
  return {
    subject: 'Verify your SpellControl email',
    text: `Confirm this email address for your SpellControl account.\n\n${link}\n\nThis link expires in 24 hours. If you did not request this, ignore this email.`,
    html: `<p>Confirm this email address for your SpellControl account.</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours. If you did not request this, ignore this email.</p>`,
  };
}

function resetPasswordContent(link: string): { subject: string; text: string; html: string } {
  return {
    subject: 'Reset your SpellControl password',
    text: `Reset your SpellControl password.\n\n${link}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.`,
    html: `<p>Reset your SpellControl password.</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour. If you did not request this, ignore this email.</p>`,
  };
}

export const authRouter: Router = Router();

/**
 * Create a password account.
 *
 * An email is REQUIRED. Password reset is the only way back into an account
 * whose password is forgotten, and it sends to `users.email` — so an account
 * created without one had no recovery path at all, and the collection,
 * binders, decks and game history behind it were one forgotten password from
 * being unreachable. Google signups already arrive with a verified address.
 *
 * The address is NOT written to `users.email` here. It rides a verify token
 * and only lands on the row once the link is clicked, exactly as
 * `POST /me/email` does — writing it unverified would let anyone occupy the
 * unique index with somebody else's address and block the real owner from
 * ever adding it. Until then the account has an email on the way and no
 * recovery yet, which is what the unverified-email banner is for.
 */
authRouter.post('/register', registerLimiter, async (req: Request, res: Response) => {
  const username = normalizeUsername(req.body?.username);
  const password = validatePassword(req.body?.password);
  const email = normalizeEmail(req.body?.email);
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
  if (!email) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
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
  // Same generic refusal `POST /me/email` gives, and for the same reason: a
  // message that distinguished "in use" from "not in use" would turn this
  // open endpoint into a way to ask whether an address has an account here.
  const emailOwners = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), eq(users.emailVerified, true)))
    .limit(1);
  if (emailOwners.length > 0) {
    return res.status(409).json({ error: 'That email is already in use.' });
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const now = Date.now();
  // Always 'user'. A password signup has no verified email yet, and admin is
  // seeded from VERIFIED addresses only (`ADMIN_EMAILS`), so there is nothing
  // to promote on at this point — `promoteIfSeededAdmin` fires later, when
  // the address is actually verified.
  const role: UserRole = 'user';
  await db.insert(users).values({ id, username, passwordHash, role, createdAt: now });
  // Password signup is anonymous (no email) and open to the public internet, so
  // log the source IP + UA to tell real users from endpoint-probing bots.
  // `trust proxy` (server.ts) makes req.ip the real client, not the Fly edge.
  logger.info(
    `[auth] register "${username}" (${id}) ip=${req.ip} ua=${req.get('user-agent') ?? '?'}`
  );
  // No initial user-data row to create: per-entity tables are empty by default
  // and become populated by the first POST /api/sync from the client.

  // Best-effort: `sendMail` never throws, and the token is already issued, so
  // a mail outage costs the user a Resend click rather than the account.
  const verifyToken = await issueAuthToken(id, 'verify', email);
  const verifyLink = `${publicWebOrigin()}/verify-email?token=${encodeURIComponent(verifyToken)}`;
  await sendMail({ to: email, ...verifyEmailContent(verifyLink) });

  const token = signSession({ id, username, role });
  setSessionCookie(res, token);
  res.status(201).json({ user: { id, username, role }, pendingEmail: email });
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
 * Request a password reset. ALWAYS 200 with the same body — never reveal
 * whether an account exists or uses that email (T117 enumeration
 * protection). Only accounts with a VERIFIED email get a token + email; the
 * unverified/non-existent branch runs a dummy password hash so the two
 * paths take roughly the same time, same trick `POST /login` already uses.
 */
authRouter.post('/forgot-password', forgotPasswordLimiter, async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email);
  const respond = (): void => {
    res.json({ ok: true, message: "If an account uses that email, we've sent a reset link." });
  };
  if (!email) return respond();

  const db = getDb();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), eq(users.emailVerified, true)))
    .limit(1);
  const user = rows[0];
  if (user) {
    const token = await issueAuthToken(user.id, 'reset');
    const link = `${publicWebOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
    const content = resetPasswordContent(link);
    await sendMail({ to: email, ...content });
  } else {
    await hashPassword('reset-timing-equalizer');
  }
  respond();
});

/**
 * Finish a password reset: validates the token, sets the new password, and
 * signs the user in (they land already authenticated — no second login step
 * after proving control of the token). Invalidates any other still-live
 * reset token for the account so an old, unused email link stops working
 * once one of them has succeeded.
 */
authRouter.post('/reset-password', resetPasswordLimiter, async (req: Request, res: Response) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const password = validatePassword(req.body?.password);
  const expired = (): Response =>
    res
      .status(400)
      .json({ error: 'That reset link has expired or was already used. Request a new one.' });
  if (!token) return expired();
  if (!password) {
    return res
      .status(400)
      .json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }

  const result = await consumeAuthToken(token, 'reset');
  if (!result) return expired();

  const db = getDb();
  const passwordHash = await hashPassword(password);
  await db.update(users).set({ passwordHash }).where(eq(users.id, result.userId));
  await db
    .update(authTokens)
    .set({ usedAt: Date.now() })
    .where(
      and(
        eq(authTokens.userId, result.userId),
        eq(authTokens.purpose, 'reset'),
        isNull(authTokens.usedAt)
      )
    );

  const user = await loadUserById(result.userId);
  if (!user) return expired();
  setSessionCookie(res, signSession(user));
  res.json({ user });
});

/**
 * Advertises which sign-in methods this deployment supports. The frontend
 * calls this to decide whether to render the "Continue with Google" button —
 * Google SSO is optional and only enabled when its env vars are configured.
 */
authRouter.get('/providers', sessionLimiter, (_req: Request, res: Response) => {
  res.json({ password: true, google: isGoogleOAuthConfigured() });
});

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
  userId: string,
  identity: GoogleIdentity
): Promise<void> {
  const providerSubject = identity.sub;
  const ok = '/settings?linked=google';
  const err = (reason: string): string => `/settings?linkError=${encodeURIComponent(reason)}`;

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
  await adoptVerifiedGoogleEmail(userId, identity);
  res.redirect(ok);
}

/**
 * Start the Google OAuth flow. Signs a `state` carrying the CSRF nonce, then
 * 302s the browser to Google's consent screen.
 */
authRouter.get('/google', oauthLimiter, (_req: Request, res: Response) => {
  const cfg = getGoogleConfig();
  if (!cfg) return res.status(503).json({ error: 'Google sign-in is not enabled.' });
  const state = signOAuthState({ nonce: issueOAuthNonce(res) });
  res.redirect(buildGoogleAuthUrl(cfg, state));
});

/**
 * Start a link-mode Google flow: this attaches the Google identity to the
 * authed user instead of creating or signing in to an account. The session
 * cookie names the user; failures redirect to /auth.
 */
authRouter.get('/google/link', oauthLimiter, async (req: Request, res: Response) => {
  const cfg = getGoogleConfig();
  if (!cfg) return res.status(503).json({ error: 'Google sign-in is not enabled.' });

  const token = readSessionCookie(req);
  const user = token ? await loadAuthedUser(token) : null;
  if (!user) return res.redirect('/auth');

  const state = signOAuthState({
    nonce: issueOAuthNonce(res),
    mode: 'link',
    userId: user.id,
  });
  res.redirect(buildGoogleAuthUrl(cfg, state));
});

/**
 * Google redirects here with `?code&state`. Verifies the state and exchanges
 * the code, then branches on whether the account exists:
 *
 *   Returning user — set the session cookie and 302 to the app.
 *   First-time user — no account is created yet. The verified identity is
 *     put in a short-lived signup token and the user is sent to the
 *     "choose a username" screen; the account is created at /complete-signup.
 */
authRouter.get('/google/callback', oauthLimiter, async (req: Request, res: Response) => {
  const cfg = getGoogleConfig();
  if (!cfg) return res.status(503).json({ error: 'Google sign-in is not enabled.' });

  const stateToken = typeof req.query.state === 'string' ? req.query.state : '';
  const state = verifyOAuthState(stateToken);
  const errorRedirect = '/auth?error=google';

  try {
    if (!state) throw new Error('Invalid or expired OAuth state.');
    // The signature only proves *this server* minted the state — anyone can
    // get one by hitting /google themselves. The cookie half proves it came
    // back to the browser that started the flow, which is what stops an
    // attacker from handing a victim a pre-baked callback URL and silently
    // signing them into the attacker's account. Single-use; fails closed.
    if (!consumeOAuthNonce(req, res, state.nonce)) {
      throw new Error('OAuth state did not originate in this browser.');
    }
    if (typeof req.query.error === 'string') throw new Error(`Google returned: ${req.query.error}`);
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) throw new Error('Missing authorization code.');

    const identity = await exchangeGoogleCode(cfg, code);

    // Link-mode branch: attach this Google identity to the user named in the
    // state (which only a signed-in /google/link request could have produced).
    if (state.mode === 'link' && state.userId) {
      return handleLinkCallback(res, state.userId, identity);
    }

    const existing = await findGoogleUser(identity.sub);

    if (existing) {
      // Accounts that linked Google before the link paths stored the address
      // backfill their verified email here, on their next Google sign-in.
      await adoptVerifiedGoogleEmail(existing.id, identity);
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
  await adoptVerifiedGoogleEmail(user.id, identity);

  const role: UserRole = user.role === 'admin' ? 'admin' : 'user';
  const authed = { id: user.id, username: user.username, role };
  setSessionCookie(res, signSession(authed));
  res.json({ user: authed });
});

// Limited like every other session route. Logout is cheap and unauthenticated,
// but 'cheap' is not 'unbounded' — and an unlimited route is the one this
// router would have shipped without rate-limit-coverage.test.ts noticing.
authRouter.post('/logout', sessionLimiter, (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', sessionLimiter, async (req: Request, res: Response) => {
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
      inboxSeenAt: users.inboxSeenAt,
      emailVerified: users.emailVerified,
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
    // Server truth for the inbox/friend-request unseen badges (T117) — see
    // POST /api/users/me/inbox-seen.
    inboxSeenAt: row[0]?.inboxSeenAt ?? null,
    // Drives the recovery banner. False covers both "never added an address"
    // and "added one, has not clicked the link yet" — neither can receive a
    // password reset, which is the only thing the banner cares about. Which
    // of the two it is lives on the Settings screen the banner links to.
    emailVerified: row[0]?.emailVerified ?? false,
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
    // displayName/bio/avatar are served straight off the public-read caches
    // (the profile page AND every deck page's byline) — without this, an edit
    // wouldn't show up on /u/:username or /d/:slug for up to the cache's TTL.
    await purgeUserPublicCaches(req.user!.id);
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

authRouter.delete('/me', requireAuth, profileLimiter, async (req: Request, res: Response) => {
  const db = getDb();
  const userId = req.user!.id;

  // Purge the public-read caches BEFORE the FK cascade removes the rows they
  // were read from — the cascade only deletes DB rows, it doesn't know about
  // the in-memory caches, and those are what first makes these deck/profile
  // pages indexable, raising the stakes on a stale-cache window post-deletion.
  await purgeUserPublicCaches(userId);
  await db.delete(users).where(eq(users.id, userId));

  clearSessionCookie(res);
  res.json({ ok: true });
});

/**
 * Dismiss the auto-link banner. The user has acknowledged that the Google
 * identity linked via verified-email matches their account; the banner
 * stops appearing on subsequent /me responses.
 */
authRouter.post(
  '/me/acknowledge-auto-link',
  requireAuth,
  profileLimiter,
  async (req: Request, res: Response) => {
    const db = getDb();
    await db.update(users).set({ autoLinkedAt: null }).where(eq(users.id, req.user!.id));
    res.json({ ok: true });
  }
);

/**
 * Newest still-live (unused, unexpired) verify-token row for a user, if any.
 * Shared by GET /me/identities (to report `pendingEmail`) and the resend
 * route (to know what to re-send).
 */
async function latestPendingVerify(userId: string): Promise<{ email: string } | null> {
  const db = getDb();
  const rows = await db
    .select({ email: authTokens.email, expiresAt: authTokens.expiresAt })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.userId, userId),
        eq(authTokens.purpose, 'verify'),
        isNull(authTokens.usedAt)
      )
    )
    .orderBy(desc(authTokens.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row || !row.email || row.expiresAt < Date.now()) return null;
  return { email: row.email };
}

/**
 * Change the authed user's username.
 *
 * The transactional part (releasing the old handle, reserving it, taking the
 * new one) lives in `username/rename.ts`. What this route owns is everything
 * that lives OUTSIDE the users table and would otherwise go stale:
 *
 * - the public caches keyed by the old handle, which would keep serving the
 *   old profile for the rest of their TTL,
 * - the game-result rows that denormalize the username at write time,
 * - the session cookie, whose JWT carries a username claim that every
 *   `req.user.username` reader sees.
 *
 * The caller's OTHER devices keep a stale claim until their token renews.
 * That is why nothing server-side stores or echoes `req.user.username` any
 * more — see `currentUsername` in auth.ts.
 */
authRouter.patch(
  '/me/username',
  usernameChangeLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const result = await renameUser(userId, req.body?.username);

    if (!result.ok) {
      switch (result.reason) {
        case 'invalid':
          return res.status(400).json({
            error:
              'Username must be 3–32 characters and use only lowercase letters, digits, _ and -.',
          });
        case 'reserved-word':
          return res.status(400).json({ error: 'That username is reserved.' });
        case 'unchanged':
          return res.status(400).json({ error: 'That is already your username.' });
        case 'taken':
          return res.status(409).json({ error: 'That username is already taken.' });
        case 'held':
          // Deliberately does not say who holds it, or that it was ever held
          // by anyone — that would leak one account's rename to a stranger.
          return res.status(409).json({
            error: 'That username is not available yet.',
            availableAt: result.heldUntil,
          });
        case 'cooldown':
          return res.status(429).json({
            error: 'You can change your username once every 30 days.',
            nextChangeAt: result.nextChangeAt,
          });
      }
    }

    const username = normalizeUsername(req.body?.username)!;
    // The new handle's entries are purged by id; the handle just released has
    // its own cache key, and nothing else will ever go looking for it.
    await purgeUserPublicCaches(userId);
    invalidatePublicUserCache(result.previous);
    await refreshGameResultUsernames(userId, username);

    // Re-mint the session so this device's own claim is correct immediately.
    setSessionCookie(res, signSession({ id: userId, username, role: req.user!.role }));
    logger.info(`[auth] "${result.previous}" (${userId}) is now "${username}"`);
    res.json({ user: { id: userId, username, role: req.user!.role } });
  }
);

/**
 * Start adding/changing the authed user's email. Doesn't write `users.email`
 * yet — that only happens once the link is clicked (POST /verify-email),
 * because the link may open in a different browser than the one that's
 * signed in here. Refuses (409, generic wording) if another VERIFIED
 * account already owns the address, so this can't be used to probe who has
 * an account.
 */
authRouter.post(
  '/me/email',
  emailChangeLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: 'Enter a valid email address.' });

    const db = getDb();
    const owners = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), eq(users.emailVerified, true)))
      .limit(1);
    if (owners[0] && owners[0].id !== req.user!.id) {
      return res.status(409).json({ error: 'That email is already in use.' });
    }

    const token = await issueAuthToken(req.user!.id, 'verify', email);
    const link = `${publicWebOrigin()}/verify-email?token=${encodeURIComponent(token)}`;
    await sendMail({ to: email, ...verifyEmailContent(link) });
    res.status(202).json({ pendingEmail: email });
  }
);

/**
 * Finish adding/changing an email: validates the token and writes
 * `users.email` + `email_verified`. Public (no auth) — the link may be
 * opened on a different device/browser than the one that's signed in. A
 * unique-index race (someone else verified the same address first between
 * this token being issued and now) surfaces as 409, not a 500.
 */
authRouter.post('/verify-email', verifyEmailLimiter, async (req: Request, res: Response) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const expired = (): Response =>
    res.status(400).json({
      error: 'That verification link has expired or was already used. Request a new one.',
    });
  if (!token) return expired();

  const result = await consumeAuthToken(token, 'verify');
  if (!result || !result.email) return expired();

  const db = getDb();
  try {
    await db
      .update(users)
      .set({ email: result.email, emailVerified: true })
      .where(eq(users.id, result.userId));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'That email is already verified on another account.' });
    }
    throw err;
  }
  // The address is verified as of this statement, so this is the first moment
  // a seeded operator can legitimately be promoted. No-op for everyone else.
  await promoteIfSeededAdmin(result.userId, result.email);
  res.json({ ok: true });
});

/**
 * Re-send the newest pending verify email. 3/hour — this is the one recovery
 * route a user can hit repeatedly by mistake (mistyped address, spam
 * filter), and it's authed, so the limiter exists to stop mail-bombing an
 * address, not to guard account enumeration.
 */
authRouter.post(
  '/me/email/resend',
  emailResendLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const pending = await latestPendingVerify(req.user!.id);
    if (!pending) {
      return res.status(400).json({ error: 'No pending email to verify. Add an email first.' });
    }
    const token = await issueAuthToken(req.user!.id, 'verify', pending.email);
    const link = `${publicWebOrigin()}/verify-email?token=${encodeURIComponent(token)}`;
    await sendMail({ to: pending.email, ...verifyEmailContent(link) });
    res.json({ ok: true });
  }
);

/**
 * Set (SSO-only account) or change (has a password already) the authed
 * user's password. `currentPassword` is required and verified whenever the
 * account already has one — this is also what makes the "set a password
 * before unlinking Google" instruction on DELETE /me/identities/google
 * satisfiable for a Google-only account (no `currentPassword` needed there).
 */
authRouter.post(
  '/me/password',
  passwordChangeLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const newPassword = validatePassword(req.body?.newPassword);
    if (!newPassword) {
      return res
        .status(400)
        .json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    const db = getDb();
    const rows = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);
    const existingHash = rows[0]?.passwordHash;
    if (existingHash) {
      const currentPassword =
        typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
      if (!currentPassword) {
        return res.status(400).json({ error: 'Enter your current password.' });
      }
      const ok = await verifyPassword(currentPassword, existingHash);
      if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const passwordHash = await hashPassword(newPassword);
    await db.update(users).set({ passwordHash }).where(eq(users.id, req.user!.id));
    res.json({ ok: true });
  }
);

/**
 * Which external sign-in methods the authed user has linked, plus email
 * state (T117: `email`/`emailVerified` off `users`, `pendingEmail` from the
 * newest unused verify token, if any). Used by the Sign-in methods section
 * in Settings. The Google email isn't returned because we don't persist it
 * on the identity row — Settings shows "Linked / Not linked" only.
 */
authRouter.get(
  '/me/identities',
  requireAuth,
  profileLimiter,
  async (req: Request, res: Response) => {
    const db = getDb();
    const userRows = await db
      .select({
        passwordHash: users.passwordHash,
        email: users.email,
        emailVerified: users.emailVerified,
        notifyEmail: users.notifyEmail,
      })
      .from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);
    const googleRows = await db
      .select({ createdAt: authIdentities.createdAt })
      .from(authIdentities)
      .where(and(eq(authIdentities.userId, req.user!.id), eq(authIdentities.provider, 'google')))
      .limit(1);
    const pending = await latestPendingVerify(req.user!.id);
    res.json({
      password: Boolean(userRows[0]?.passwordHash),
      google: googleRows[0] ? { linkedAt: googleRows[0].createdAt } : null,
      email: userRows[0]?.email ?? null,
      emailVerified: Boolean(userRows[0]?.emailVerified),
      pendingEmail: pending?.email ?? null,
      notifyEmail: userRows[0]?.notifyEmail ?? true,
    });
  }
);

/**
 * Toggle the T117 notification emails (friend request / trade offer /
 * game-night invite). Takes effect only once the account also has a
 * verified email — see `notify.ts:notifyUser`. No effect on the account
 * recovery emails (verify/reset), which are never opt-out.
 */
authRouter.patch(
  '/me/notify-email',
  requireAuth,
  profileLimiter,
  async (req: Request, res: Response) => {
    if (typeof req.body?.enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean.' });
    }
    const db = getDb();
    await db.update(users).set({ notifyEmail: req.body.enabled }).where(eq(users.id, req.user!.id));
    res.json({ ok: true });
  }
);

/**
 * Unlink the user's Google account. Refuses if removing the Google identity
 * would leave the account with no way to sign in (no password and no other
 * external identities) — set a password first (POST /me/password); consult
 * userHasOtherSignInMethod() for any future "remove sign-in method" endpoint
 * too.
 */
authRouter.delete(
  '/me/identities/google',
  requireAuth,
  profileLimiter,
  async (req: Request, res: Response) => {
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
  }
);
