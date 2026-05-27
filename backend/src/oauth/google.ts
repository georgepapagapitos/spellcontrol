import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { and, eq, lt } from 'drizzle-orm';
import { getDb } from '../db';
import { users, authIdentities, oauthHandoffCodes } from '../db/schema';
import { getAdminUsernames, type AuthedUser, type OAuthPlatform } from '../auth';

/** Provider key stored in `auth_identities.provider`. */
const PROVIDER = 'google';

/** Native handoff codes live just long enough to deep-link back into the app. */
const HANDOFF_TTL_MS = 60_000;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** Backend callback URL the web flow registers with Google. */
  webRedirectUri: string;
  /** Backend callback URL the native flow registers with Google. */
  nativeRedirectUri: string;
}

/**
 * Read the Google OAuth config from the environment, or null if it is not
 * fully set. Google SSO is an optional feature — when this returns null the
 * `/api/auth/google*` routes report 503 and the frontend hides the button, so
 * a deployment without Google credentials still boots and runs normally.
 */
export function getGoogleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const webRedirectUri = process.env.OAUTH_WEB_REDIRECT_URI;
  const nativeRedirectUri = process.env.OAUTH_NATIVE_REDIRECT_URI;
  if (!clientId || !clientSecret || !webRedirectUri || !nativeRedirectUri) return null;
  return { clientId, clientSecret, webRedirectUri, nativeRedirectUri };
}

export function isGoogleOAuthConfigured(): boolean {
  return getGoogleConfig() !== null;
}

function redirectUriFor(cfg: GoogleConfig, platform: OAuthPlatform): string {
  return platform === 'native' ? cfg.nativeRedirectUri : cfg.webRedirectUri;
}

function clientFor(cfg: GoogleConfig): OAuth2Client {
  return new OAuth2Client({ clientId: cfg.clientId, clientSecret: cfg.clientSecret });
}

/** Build the Google consent-screen URL to redirect the user to. */
export function buildGoogleAuthUrl(
  cfg: GoogleConfig,
  platform: OAuthPlatform,
  state: string
): string {
  return clientFor(cfg).generateAuthUrl({
    redirect_uri: redirectUriFor(cfg, platform),
    scope: ['openid', 'email', 'profile'],
    state,
    // Always show the account chooser so a shared device can switch accounts.
    prompt: 'select_account',
  });
}

/** Verified identity claims pulled from a Google ID token. */
export interface GoogleIdentity {
  /** Google's stable per-account id (`sub`). */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/**
 * Exchange the authorization `code` for tokens and verify the returned ID
 * token. The `redirect_uri` must match the one used to start the flow, hence
 * the `platform` argument. Throws if Google returns no/invalid ID token.
 */
export async function exchangeGoogleCode(
  cfg: GoogleConfig,
  platform: OAuthPlatform,
  code: string
): Promise<GoogleIdentity> {
  const client = clientFor(cfg);
  const { tokens } = await client.getToken({
    code,
    redirect_uri: redirectUriFor(cfg, platform),
  });
  if (!tokens.id_token) throw new Error('Google did not return an ID token.');
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: cfg.clientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub) throw new Error('Google ID token has no subject.');
  return {
    sub: payload.sub,
    email: payload.email ?? null,
    emailVerified: payload.email_verified === true,
    name: payload.name ?? null,
  };
}

/**
 * Look up the SpellControl user linked to a Google identity, or null when
 * this is a first-time sign-in (no account yet — the caller then routes the
 * user through the "choose a username" screen).
 *
 * Lookup is by the Google identity, never by email. Email matching is a
 * separate path (`findAutoLinkCandidateByEmail`) that the OAuth callback
 * consults as a fallback to merge a new identity into an existing account
 * with a matching verified email, instead of silently creating a duplicate.
 */
export async function findGoogleUser(sub: string): Promise<AuthedUser | null> {
  const db = getDb();
  const linked = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(authIdentities)
    .innerJoin(users, eq(users.id, authIdentities.userId))
    .where(and(eq(authIdentities.provider, PROVIDER), eq(authIdentities.providerSubject, sub)))
    .limit(1);
  const row = linked[0];
  if (!row) return null;
  return { id: row.id, username: row.username, role: row.role === 'admin' ? 'admin' : 'user' };
}

/**
 * Same-email auto-link candidate: a user with the given verified email who
 * does NOT already have a Google identity attached. Returns null when no
 * such user exists OR when the candidate already has a (different) Google
 * identity — in that case the caller MUST NOT auto-link, because attaching
 * a second Google identity is ambiguous and would let an attacker who
 * controls a Google account with the same email replace the legitimate
 * Google sign-in. The user can still link via the manual password flow.
 */
export async function findAutoLinkCandidateByEmail(email: string): Promise<AuthedUser | null> {
  const db = getDb();
  const candidate = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const row = candidate[0];
  if (!row) return null;
  const existingGoogle = await db
    .select({ providerSubject: authIdentities.providerSubject })
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, PROVIDER), eq(authIdentities.userId, row.id)))
    .limit(1);
  if (existingGoogle.length > 0) return null;
  return { id: row.id, username: row.username, role: row.role === 'admin' ? 'admin' : 'user' };
}

/**
 * Attach a new Google identity to an existing user and stamp the audit
 * timestamp so /me can surface a "we linked X — was this you?" banner on
 * next sign-in. We also bump `email_verified` to true because the user
 * just proved control of the address via the Google flow; the email value
 * itself is unchanged (this user was found BY that email).
 */
export async function autoLinkGoogleIdentity(
  userId: string,
  identity: GoogleIdentity
): Promise<void> {
  const db = getDb();
  const now = Date.now();
  await db.insert(authIdentities).values({
    provider: PROVIDER,
    providerSubject: identity.sub,
    userId,
    createdAt: now,
  });
  await db
    .update(users)
    .set({
      autoLinkedAt: now,
      emailVerified: identity.emailVerified,
    })
    .where(eq(users.id, userId));
}

/**
 * Create the account for a verified Google identity using the username the
 * user chose on the first-run screen. Writes the user row, its data row, and
 * the `(google, sub)` identity link. The caller has already checked the
 * username is well-formed and free.
 */
export async function createGoogleUser(
  identity: GoogleIdentity,
  username: string
): Promise<AuthedUser> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  const role = getAdminUsernames().has(username) ? 'admin' : 'user';
  await db.insert(users).values({
    id,
    username,
    passwordHash: null,
    email: identity.email,
    emailVerified: identity.emailVerified,
    role,
    createdAt: now,
  });
  await db.insert(authIdentities).values({
    provider: PROVIDER,
    providerSubject: identity.sub,
    userId: id,
    createdAt: now,
  });
  return { id, username, role };
}

/**
 * Mint a single-use code that bridges the native flow: the system-browser
 * callback cannot set the WebView's session cookie, so it deep-links this code
 * back into the app, which trades it for a real session via `/google/exchange`.
 */
export async function mintHandoffCode(userId: string): Promise<string> {
  const db = getDb();
  const code = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  // Sweep expired rows opportunistically so the table can't grow unbounded.
  await db.delete(oauthHandoffCodes).where(lt(oauthHandoffCodes.expiresAt, now));
  await db.insert(oauthHandoffCodes).values({ code, userId, expiresAt: now + HANDOFF_TTL_MS });
  return code;
}

/**
 * Atomically redeem a handoff code. Deletes the row (single use) and returns
 * the user id, or null if the code is unknown or expired.
 */
export async function consumeHandoffCode(code: string): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .delete(oauthHandoffCodes)
    .where(eq(oauthHandoffCodes.code, code))
    .returning({
      userId: oauthHandoffCodes.userId,
      expiresAt: oauthHandoffCodes.expiresAt,
    });
  const row = rows[0];
  if (!row || row.expiresAt < Date.now()) return null;
  return row.userId;
}
