import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { optionalAuth, requireAuth } from '../auth';
import { getDb, getPool } from '../db';
import { shares } from '../db/schema';
import { areFriends } from '../friends/relations';
import type { ShareDataView } from '../shares/cache';
import { invalidateShareContext, loadShareContext } from '../shares/context';
import { resolveShareLabels } from '../shares/labels';
import {
  findCubeById,
  findDeckById,
  findListById,
  projectBinder,
  projectCollection,
  projectCube,
  projectDeck,
  projectList,
} from '../shares/projections';

/**
 * Public share-link routes. Token-gated, read-only views of a user's
 * collection / binder / deck / list slice. Binder membership is computed
 * server-side via the isomorphic `@spellcontrol/binder-routing` engine —
 * the same routing logic the frontend runs (see projectBinder).
 */
export const sharesRouter: Router = Router();

const publicLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

/** 'feedback' is a deck share that also accepts suggestion submissions —
 *  see routes/feedback.ts. Viewers get the same PublicDeck projection. */
type ShareKind = 'collection' | 'binder' | 'deck' | 'list' | 'cube' | 'feedback';

function isShareKind(x: unknown): x is ShareKind {
  return (
    x === 'collection' ||
    x === 'binder' ||
    x === 'deck' ||
    x === 'list' ||
    x === 'cube' ||
    x === 'feedback'
  );
}

/**
 * Who can open a share. 'link' = anyone with the URL; 'friends' = any accepted
 * friend, signed in; 'direct' = one specific friend (the addressee), who finds
 * it in their inbox.
 */
type ShareAudience = 'link' | 'friends' | 'direct';

function isShareAudience(x: unknown): x is ShareAudience {
  return x === 'link' || x === 'friends' || x === 'direct';
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
  const body = req.body as {
    kind?: unknown;
    resourceId?: unknown;
    audience?: unknown;
    addresseeId?: unknown;
  };
  if (!isShareKind(body.kind)) {
    return res.status(400).json({
      error: "kind must be one of 'collection', 'binder', 'deck', 'list', 'cube', or 'feedback'.",
    });
  }
  const kind = body.kind;
  const resourceId =
    kind === 'collection' ? '' : typeof body.resourceId === 'string' ? body.resourceId : '';
  if (kind !== 'collection' && !resourceId) {
    return res.status(400).json({ error: 'resourceId is required for this kind.' });
  }
  // Absent audience = 'link' so every existing client keeps minting public links.
  const audience: ShareAudience =
    body.audience === undefined ? 'link' : (body.audience as ShareAudience);
  if (!isShareAudience(audience)) {
    return res.status(400).json({ error: "audience must be 'link', 'friends', or 'direct'." });
  }

  // Directed shares carry the recipient's user id (the client already has it
  // from the friends list). The recipient must be an accepted friend — that
  // check also covers a non-existent id (no friendship row), so we return a
  // uniform 403 rather than leaking whether the id is a real account.
  let addresseeId: string | null = null;
  if (audience === 'direct') {
    const target = typeof body.addresseeId === 'string' ? body.addresseeId : '';
    if (!target) {
      return res.status(400).json({ error: 'addresseeId is required for a direct share.' });
    }
    if (target === req.user!.id || !(await areFriends(req.user!.id, target))) {
      return res.status(403).json({ error: 'You can only send a direct share to a friend.' });
    }
    addresseeId = target;
  }

  const db = getDb();
  // Idempotent per (userId, kind, resourceId, audience, addresseeId): re-opening
  // the dialog on the same audience+recipient returns the same token. A link, a
  // friends, and a direct-to-Alice share of one resource are distinct rows.
  const existing = await db
    .select()
    .from(shares)
    .where(
      and(
        eq(shares.userId, req.user!.id),
        eq(shares.kind, kind),
        eq(shares.resourceId, resourceId),
        eq(shares.audience, audience),
        addresseeId ? eq(shares.addresseeId, addresseeId) : isNull(shares.addresseeId),
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
    audience,
    addresseeId,
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

/**
 * The caller's inbox: shares other users directed to them (audience='direct',
 * addressee = caller). Each carries the sender's username and the resolved
 * resource label; shares whose underlying resource was deleted are dropped
 * (they'd 404 on open). Newest first.
 */
sharesRouter.get('/inbox', requireAuth, async (req: Request, res: Response) => {
  const pool = getPool();
  const rows = await pool.query<{
    token: string;
    kind: string;
    resource_id: string;
    created_at: string;
    sender_id: string;
    sender_username: string;
  }>(
    `SELECT s.token, s.kind, s.resource_id, s.created_at,
            s.user_id AS sender_id, u.username AS sender_username
       FROM shares s
       JOIN users u ON u.id = s.user_id
      WHERE s.addressee_id = $1 AND s.audience = 'direct' AND s.revoked_at IS NULL
      ORDER BY s.created_at DESC`,
    [req.user!.id]
  );

  // Labels resolve against each sender's own resources, so group by sender.
  const bySender = new Map<string, Array<{ kind: string; resourceId: string }>>();
  for (const r of rows.rows) {
    const arr = bySender.get(r.sender_id) ?? [];
    arr.push({ kind: r.kind, resourceId: r.resource_id });
    bySender.set(r.sender_id, arr);
  }
  const labels = new Map<string, string>();
  for (const [senderId, refs] of bySender) {
    const resolved = await resolveShareLabels(senderId, refs);
    for (const [k, v] of resolved) labels.set(`${senderId}:${k}`, v);
  }

  const inbox = rows.rows
    .map((r) => ({
      token: r.token,
      kind: r.kind,
      fromUsername: r.sender_username,
      label: labels.get(`${r.sender_id}:${r.kind}:${r.resource_id}`) ?? null,
      createdAt: Number(r.created_at),
    }))
    .filter((s) => s.label !== null);

  res.json({ shares: inbox });
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
  // Drop any cached context for this token so the next public read sees the
  // revocation immediately rather than waiting out the TTL window.
  invalidateShareContext(token);
  res.status(204).end();
});

/**
 * Public read. For audience='link' (the default, and every legacy share):
 * anyone with the token can view — `optionalAuth` runs but no session is
 * required. For audience='friends': the caller must be signed in AND an
 * accepted friend of the owner, else 401/403. Friendship is re-checked on
 * every read (never cached), so unfriending immediately revokes access.
 * Returns 404 (not 401) for unknown / revoked tokens to keep the surface
 * stealthy — no way to enumerate or distinguish revoked from never-existed.
 */
sharesRouter.get(
  '/public/:token',
  publicLimiter,
  optionalAuth,
  async (req: Request, res: Response) => {
    const token = readTokenParam(req);
    const ctx = await loadShareContext(token);
    if (!ctx) {
      return res.status(404).json({ error: 'Share not found.' });
    }
    const { share, data, ownerUsername: username } = ctx;

    if (share.audience === 'friends') {
      if (!req.user) {
        return res.status(401).json({ error: 'Sign in to view this shared content.' });
      }
      if (!(await areFriends(req.user.id, share.userId))) {
        return res
          .status(403)
          .json({ error: 'This share is only visible to the owner’s friends.' });
      }
    } else if (share.audience === 'direct') {
      if (!req.user) {
        return res.status(401).json({ error: 'Sign in to view this shared content.' });
      }
      // Only the addressee may open it. A NULL addressee (recipient deleted →
      // ON DELETE SET NULL) is inert: 404, never a public fallback.
      if (!share.addresseeId || req.user.id !== share.addresseeId) {
        return res.status(404).json({ error: 'Share not found.' });
      }
    }

    return projectAndRespond(res, share, data, username);
  }
);

/** Dispatch a loaded share to its per-kind projector. Extracted so the access
 *  gate above stays readable. */
function projectAndRespond(
  res: Response,
  share: { kind: string; resourceId: string },
  data: ShareDataView,
  username: string
): Response {
  if (share.kind === 'collection') {
    return res.json({
      kind: 'collection' as const,
      data: projectCollection(username, data.collection),
    });
  }
  if (share.kind === 'deck' || share.kind === 'feedback') {
    const deck = findDeckById(data.decks, share.resourceId);
    const projected = projectDeck(username, deck);
    if (!projected) {
      return res.status(404).json({ error: 'Share not found.' });
    }
    // A feedback share projects the same deck view; the kind tells the client
    // to render the suggestion-mode UI instead of the read-only one.
    return res.json({ kind: share.kind, data: projected });
  }
  if (share.kind === 'list') {
    const list = findListById(data.collection, share.resourceId);
    const projected = projectList(username, list);
    if (!projected) {
      return res.status(404).json({ error: 'Share not found.' });
    }
    return res.json({ kind: 'list' as const, data: projected });
  }
  if (share.kind === 'binder') {
    const projected = projectBinder(username, share.resourceId, data.collection, data.binders);
    if (!projected) {
      return res.status(404).json({ error: 'Share not found.' });
    }
    return res.json({ kind: 'binder' as const, data: projected });
  }
  if (share.kind === 'cube') {
    const cube = findCubeById(data.cubes, share.resourceId);
    const projected = projectCube(username, cube);
    if (!projected) {
      return res.status(404).json({ error: 'Share not found.' });
    }
    return res.json({ kind: 'cube' as const, data: projected });
  }
  // Unknown kind in the DB — defensive, shouldn't happen post-validation.
  return res.status(404).json({ error: 'Share not found.' });
}
