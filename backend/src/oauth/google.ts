import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { and, eq, lt } from 'drizzle-orm';
import { getDb } from '../db';
import { users, userData, authIdentities, oauthHandoffCodes } from '../db/schema';
import { generateUsername, getAdminUsernames, type AuthedUser, type OAuthPlatform } from '../auth';

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
 * Map a verified Google identity to a SpellControl user, creating a fresh
 * account on first sign-in.
 *
 * v1 deliberately keeps Google accounts separate: it looks up the user *only*
 * by the Google identity, never by email, so an SSO login can never read or
 * merge into a password account. Linking ("same email = same account") is a
 * later additive change — the unique `users.email` column is already in place
 * for it.
 */
export async function resolveGoogleUser(identity: GoogleIdentity): Promise<AuthedUser> {
  const db = getDb();

  // Returning user — an identity row already points at their account.
  const linked = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(authIdentities)
    .innerJoin(users, eq(users.id, authIdentities.userId))
    .where(
      and(eq(authIdentities.provider, PROVIDER), eq(authIdentities.providerSubject, identity.sub))
    )
    .limit(1);
  if (linked[0]) {
    const row = linked[0];
    return {
      id: row.id,
      username: row.username,
      role: row.role === 'admin' ? 'admin' : 'user',
    };
  }

  // First sign-in — create the account, its data row, and the identity link.
  const id = crypto.randomUUID();
  const username = await generateUsername(identity.email ?? 'player');
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
  await db.insert(userData).values({
    userId: id,
    collection: null,
    binders: [],
    decks: [],
    version: 0,
    updatedAt: now,
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
