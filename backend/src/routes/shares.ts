import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { requireAuth } from '../auth';
import { getDb } from '../db';
import { shares, userData, users } from '../db/schema';
import {
  findDeckById,
  findListById,
  projectCollection,
  projectDeck,
  projectList,
} from '../shares/projections';

/**
 * Public share-link routes. Token-gated, read-only views of a user's
 * collection / deck / list slice. Binders are intentionally not supported
 * in v1 — binder membership is computed by the frontend rules engine and
 * needs a shared-package extraction before the server can project it.
 */
export const sharesRouter: Router = Router();

const isTest = process.env.NODE_ENV === 'test' || !!process.env.TEST_DATABASE_URL;
const publicLimiter = isTest
  ? (_req: Request, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 60_000, max: 60 });

type ShareKind = 'collection' | 'deck' | 'list';

function isShareKind(x: unknown): x is ShareKind {
  return x === 'collection' || x === 'deck' || x === 'list';
}

function newToken(): string {
  // 24 bytes → 32 url-safe chars. Unguessable; collision-resistant.
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Create or return the existing active share link for a resource. Idempotent
 * per (userId, kind, resourceId): re-clicking "Share" returns the same token
 * unless it was revoked, in which case a new one is minted.
 */
sharesRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const body = req.body as { kind?: unknown; resourceId?: unknown };
  if (!isShareKind(body.kind)) {
    return res.status(400).json({
      error: "kind must be one of 'collection', 'deck', or 'list'.",
    });
  }
  const kind = body.kind;
  const resourceId =
    kind === 'collection' ? '' : typeof body.resourceId === 'string' ? body.resourceId : '';
  if (kind !== 'collection' && !resourceId) {
    return res.status(400).json({ error: 'resourceId is required for kind=deck and kind=list.' });
  }

  const db = getDb();
  // Reuse the active token if one exists.
  const existing = await db
    .select()
    .from(shares)
    .where(
      and(
        eq(shares.userId, req.user!.id),
        eq(shares.kind, kind),
        eq(shares.resourceId, resourceId),
        isNull(shares.revokedAt)
      )
    )
    .limit(1);
  if (existing.length > 0) {
    return res.json({ share: existing[0] });
  }

  const row = {
    token: newToken(),
    userId: req.user!.id,
    kind,
    resourceId,
    createdAt: Date.now(),
    revokedAt: null,
  };
  await db.insert(shares).values(row);
  res.status(201).json({ share: row });
});

/** List the caller's active share links. */
sharesRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(shares)
    .where(and(eq(shares.userId, req.user!.id), isNull(shares.revokedAt)))
    .orderBy(desc(shares.createdAt));
  res.json({ shares: rows });
});

function readTokenParam(req: Request): string {
  const raw = req.params.token;
  return typeof raw === 'string' ? raw : raw[0];
}

/** Revoke a share token. Returns 204 on success, 404 if the caller doesn't own it. */
sharesRouter.delete('/:token', requireAuth, async (req: Request, res: Response) => {
  const token = readTokenParam(req);
  const db = getDb();
  const updated = await db
    .update(shares)
    .set({ revokedAt: Date.now() })
    .where(and(eq(shares.token, token), eq(shares.userId, req.user!.id), isNull(shares.revokedAt)))
    .returning({ token: shares.token });
  if (updated.length === 0) {
    return res.status(404).json({ error: 'Share not found.' });
  }
  res.status(204).end();
});

/**
 * Public read: anyone with the token can view. Rate-limited.
 * Returns 404 (not 401) for unknown / revoked tokens to keep the surface
 * stealthy — no way to enumerate or distinguish revoked from never-existed.
 */
sharesRouter.get('/public/:token', publicLimiter, async (req: Request, res: Response) => {
  const token = readTokenParam(req);
  const db = getDb();
  const rows = await db
    .select()
    .from(shares)
    .where(and(eq(shares.token, token), isNull(shares.revokedAt)))
    .limit(1);
  const share = rows[0];
  if (!share) {
    return res.status(404).json({ error: 'Share not found.' });
  }

  const dataRows = await db
    .select()
    .from(userData)
    .where(eq(userData.userId, share.userId))
    .limit(1);
  const data = dataRows[0];
  if (!data) {
    return res.status(404).json({ error: 'Share not found.' });
  }

  const userRows = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, share.userId))
    .limit(1);
  const username = userRows[0]?.username ?? 'unknown';

  if (share.kind === 'collection') {
    return res.json({
      kind: 'collection' as const,
      data: projectCollection(username, data.collection),
    });
  }
  if (share.kind === 'deck') {
    const deck = findDeckById(data.decks, share.resourceId);
    const projected = projectDeck(username, deck);
    if (!projected) {
      return res.status(404).json({ error: 'Share not found.' });
    }
    return res.json({ kind: 'deck' as const, data: projected });
  }
  if (share.kind === 'list') {
    const list = findListById(data.collection, share.resourceId);
    const projected = projectList(username, list);
    if (!projected) {
      return res.status(404).json({ error: 'Share not found.' });
    }
    return res.json({ kind: 'list' as const, data: projected });
  }
  // Unknown kind in the DB — defensive, shouldn't happen post-validation.
  return res.status(404).json({ error: 'Share not found.' });
});
