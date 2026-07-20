import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { authIdentities, users } from './db/schema';

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
 * Non-blocking auth: populates req.user when a valid session cookie is present,
 * otherwise continues as anonymous (never 401s). For routes that are public for
 * some inputs but gated for others — e.g. a share link that's open to anyone
 * when audience='link' but friends-only when audience='friends'. The handler
 * decides what an absent req.user means.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readSessionCookie(req);
  if (token) {
    const user = verifySession(token);
    if (user) req.user = user;
  }
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
  return loadUserById(claims.id);
}

/**
 * "If we remove this method, does the account still have any way to sign
 * in?" Source-of-truth check that every "remove a sign-in method" endpoint
 * MUST consult before deleting — leaving a user with zero sign-in methods
 * locks them out permanently (there is no password reset). Pass the
 * candidate-for-removal so we can prove there's at least one OTHER method.
 *
 * Today the only removable methods are the password column and rows in
 * `auth_identities`. Adding a new provider? Extend this function — don't
 * add another ad-hoc check at the call site.
 */
export async function userHasOtherSignInMethod(
  userId: string,
  except: { kind: 'password' } | { kind: 'identity'; provider: string }
): Promise<boolean> {
  const db = getDb();
  // Password counts unless it's the one being removed.
  if (except.kind !== 'password') {
    const rows = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (rows[0]?.passwordHash) return true;
  }
  // Any external identity that's NOT the one being removed counts.
  const identityRows = await db
    .select({ provider: authIdentities.provider })
    .from(authIdentities)
    .where(eq(authIdentities.userId, userId));
  for (const row of identityRows) {
    if (except.kind === 'identity' && row.provider === except.provider) continue;
    return true;
  }
  return false;
}

/**
 * Loads an AuthedUser straight from the DB by id (current username + role).
 * Used by the OAuth handoff exchange, where there is no session token yet —
 * the user has just been resolved/created and we need to mint their session.
 */
export async function loadUserById(id: string): Promise<AuthedUser | null> {
  const db = getDb();
  const rows = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(users)
    .where(eq(users.id, id))
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

/**
 * Exact-match (never substring — "root" must not flag "Uprooted"), case-
 * insensitive blocklist checked at every username-creation choke point and
 * on display-name save, so a future `/u/<username>` public profile route can
 * never collide with an app route or an obviously-impersonating handle.
 */
export const RESERVED_IDENTIFIERS: Set<string> = new Set([
  // App route segments (current + program-committed future ones).
  'collection',
  'decks',
  'play',
  'friends',
  'settings',
  'search',
  'admin',
  'auth',
  'welcome',
  'oauth',
  'u',
  'd',
  's',
  'gn',
  'api',
  'health',
  'guides',
  'home',
  'you',
  'discover',
  'saved',
  'pods',
  // Trust/safety & impersonation-risk handles.
  'administrator',
  'root',
  'system',
  'support',
  'help',
  'about',
  'contact',
  'spellcontrol',
  'official',
  'staff',
  'moderator',
  'mod',
  'security',
  'abuse',
  'legal',
  'privacy',
  'terms',
  'null',
  'undefined',
  'public',
  'private',
  'static',
  'assets',
  'www',
  'mail',
  'email',
  // Forward-looking route words a later program wave is already committed to.
  'browse',
  'trending',
  'feed',
  'profile',
]);

export function isReservedUsername(name: string): boolean {
  return RESERVED_IDENTIFIERS.has(name.toLowerCase());
}

/**
 * Derive a unique, valid username for an SSO account from its email. The
 * email local-part is lowercased and stripped to the USERNAME_REGEX charset,
 * padded if too short, then collision-suffixed with a counter until free. The
 * suffix is trimmed into the base so the result always stays within 32 chars.
 */
export async function generateUsername(email: string): Promise<string> {
  const local = (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  let base = local.length >= 3 ? local : `${local}player`;
  base = base.slice(0, 32);
  const db = getDb();
  for (let i = 0; i < 10_000; i++) {
    const suffix = i === 0 ? '' : String(i);
    const candidate = suffix ? base.slice(0, 32 - suffix.length) + suffix : base;
    // A reserved local-part (e.g. admin@example.com) must never surface as
    // the bare word — skip straight to the next numbered candidate.
    if (RESERVED_IDENTIFIERS.has(candidate)) continue;
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
  }
  // Pathological fallback — effectively unreachable with a 10k collision span.
  return `player-${crypto.randomUUID().slice(0, 8)}`;
}

const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 minutes — covers a slow consent
const OAUTH_STATE_AUDIENCE = 'oauth-state';

export type OAuthPlatform = 'web' | 'native';
/** 'signin' = a regular sign-in flow; 'link' = attach Google to the authed user. */
export type OAuthMode = 'signin' | 'link';

export interface OAuthState {
  platform: OAuthPlatform;
  nonce: string;
  mode: OAuthMode;
  /** Set only when mode === 'link': the user the callback should link to. */
  userId?: string;
}

export interface OAuthStateInput {
  platform: OAuthPlatform;
  mode?: OAuthMode;
  /** Required when mode === 'link'. */
  userId?: string;
}

/**
 * Sign the CSRF `state` carried through the Google consent round-trip. It is
 * a short-lived JWT (distinct `aud` so it can never be mistaken for a session
 * token) recording which platform started the flow and, for link-mode, which
 * SpellControl user the callback should attach the Google identity to.
 */
export function signOAuthState(input: OAuthStateInput): string {
  const payload: Record<string, unknown> = {
    platform: input.platform,
    nonce: crypto.randomUUID(),
    mode: input.mode ?? 'signin',
  };
  if (input.userId) payload.userId = input.userId;
  return jwt.sign(payload, getJwtSecret(), {
    audience: OAUTH_STATE_AUDIENCE,
    expiresIn: OAUTH_STATE_TTL_SECONDS,
  });
}

/** Verify a `state` token from the Google callback; null if invalid/expired. */
export function verifyOAuthState(token: string): OAuthState | null {
  try {
    const payload = jwt.verify(token, getJwtSecret(), {
      audience: OAUTH_STATE_AUDIENCE,
    }) as jwt.JwtPayload;
    return {
      platform: payload.platform === 'native' ? 'native' : 'web',
      nonce: typeof payload.nonce === 'string' ? payload.nonce : '',
      mode: payload.mode === 'link' ? 'link' : 'signin',
      userId: typeof payload.userId === 'string' ? payload.userId : undefined,
    };
  } catch {
    return null;
  }
}

const LINK_INTENT_TTL_SECONDS = 5 * 60; // 5 min — covers the trip through Browser.open
const LINK_INTENT_AUDIENCE = 'oauth-link-intent';

/**
 * Native-only: a short-lived signed token that proves "the authed user
 * approved a link-Google flow." The native app gets this via an authed
 * fetch (cookie travels through CapacitorHttp), then opens the system browser
 * pointed at /google/link?intent=<token>. The system browser has no app
 * cookies, so this token is how the link route knows which user to link to.
 * Web doesn't need this — its top-level navigation to /google/link sends the
 * session cookie naturally.
 */
export function signLinkIntent(userId: string): string {
  return jwt.sign({ userId }, getJwtSecret(), {
    audience: LINK_INTENT_AUDIENCE,
    expiresIn: LINK_INTENT_TTL_SECONDS,
  });
}

export function verifyLinkIntent(token: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, getJwtSecret(), {
      audience: LINK_INTENT_AUDIENCE,
    }) as jwt.JwtPayload;
    if (typeof payload.userId !== 'string') return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

const SIGNUP_TOKEN_TTL_SECONDS = 15 * 60; // 15 min — time to pick a username
const SIGNUP_TOKEN_AUDIENCE = 'oauth-signup';

/**
 * The verified identity carried between a first-time OAuth callback and the
 * "choose a username" screen. No account exists yet — the account is created
 * only when the user submits a username to /google/complete-signup. Stateless
 * (a signed JWT, distinct `aud`); replay is bounded because creating the
 * account writes a unique `(provider, providerSubject)` row.
 */
export interface SignupToken {
  provider: 'google';
  sub: string;
  email: string | null;
  emailVerified: boolean;
}

export function signSignupToken(payload: SignupToken): string {
  return jwt.sign(payload, getJwtSecret(), {
    audience: SIGNUP_TOKEN_AUDIENCE,
    expiresIn: SIGNUP_TOKEN_TTL_SECONDS,
  });
}

export function verifySignupToken(token: string): SignupToken | null {
  try {
    const p = jwt.verify(token, getJwtSecret(), {
      audience: SIGNUP_TOKEN_AUDIENCE,
    }) as jwt.JwtPayload;
    if (p.provider !== 'google' || typeof p.sub !== 'string') return null;
    return {
      provider: 'google',
      sub: p.sub,
      email: typeof p.email === 'string' ? p.email : null,
      emailVerified: p.emailVerified === true,
    };
  } catch {
    return null;
  }
}

const DISPLAY_NAME_MAX = 40;
const BIO_MAX = 280;
const SCRYFALL_CDN_HOST = 'cards.scryfall.io';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Trim; empty-after-trim is a *valid* "clear" (→ null). Over `max` chars is
 * *invalid* (→ undefined) — the caller must reject with 400, never silently
 * truncate a name or bio the user typed, matching validatePassword's
 * existing hard-reject precedent.
 */
function normalizeTrimmedText(raw: unknown, max: number): string | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length > max) return undefined;
  return trimmed.length === 0 ? null : trimmed;
}

export function normalizeDisplayName(raw: unknown): string | null | undefined {
  return normalizeTrimmedText(raw, DISPLAY_NAME_MAX);
}

export function normalizeBio(raw: unknown): string | null | undefined {
  return normalizeTrimmedText(raw, BIO_MAX);
}

/** Shape-only check — a Scryfall print id is a UUID, never resolved/verified against the API. */
export function isScryfallUuid(raw: unknown): raw is string {
  return typeof raw === 'string' && UUID_SHAPE.test(raw);
}

/**
 * A pre-derived avatar image URL must be genuinely Scryfall-hosted: an exact
 * hostname match over `https://`. Exact equality also rejects a lookalike
 * suffix host (e.g. `cards.scryfall.io.evil.com`) for free.
 */
export function isScryfallArtUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === SCRYFALL_CDN_HOST;
  } catch {
    return false;
  }
}

/**
 * COALESCE(display_name, username) for one user id, a single indexed lookup.
 * Exported for the identity-propagation PR's seeded-name sites; the publish-
 * eligibility gate does its own direct `SELECT display_name` instead of
 * importing this, to keep that PR's coupling to this file at one line.
 */
export async function resolveDisplayLabel(userId: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ username: users.username, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  return row?.displayName ?? row?.username ?? '';
}
