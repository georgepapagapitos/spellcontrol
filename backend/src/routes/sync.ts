import { Router, type Request, type Response } from 'express';
import { logger } from '../logger';
import { requireAuth } from '../auth';
import { getPool } from '../db';

export const syncRouter: Router = Router();

/**
 * Delta sync.
 *
 *   GET  /api/sync?since=<rev>&limit=<n>
 *     → { rows, cursor, hasMore }
 *
 *   POST /api/sync
 *     body { upserts: [{ kind, id, data, importId? }],
 *            deletions: [{ kind, id }] }
 *     → { applied, cursor }
 *
 * Every user-data row carries its own monotonic `rev` (from `user_data_rev_seq`)
 * and a `deleted_at` tombstone. Clients pull deltas since the last cursor and
 * apply tombstones, so a deletion on one device propagates to every other
 * device on its next pull — replacing the prior whole-blob model that could
 * resurrect deletions from a stale device.
 *
 * No `baseVersion`, no document-level optimistic concurrency, no 409. The
 * server is authoritative per row. Last-write-wins by `rev`.
 *
 * Deleting an import cascades to all `user_cards` rows with that `import_id`
 * inside the same transaction — each cascaded card gets its own tombstone row
 * with a fresh `rev`, so peers see the cards disappear too.
 */

const DEFAULT_PAGE_LIMIT = 2000;
const MAX_PAGE_LIMIT = 5000;
/** Cap on (upserts + deletions) in a single POST. Protects the tx + JSON body. */
const MAX_BATCH_SIZE = 5000;

type Kind = 'import' | 'card' | 'binder' | 'deck' | 'game' | 'list';

const KIND_TO_TABLE: Record<Kind, string> = {
  import: 'user_imports',
  card: 'user_cards',
  binder: 'user_binders',
  deck: 'user_decks',
  game: 'user_games',
  list: 'user_lists',
};

function isKind(x: unknown): x is Kind {
  return typeof x === 'string' && x in KIND_TO_TABLE;
}

interface UpsertOp {
  kind: Kind;
  id: string;
  data: unknown;
  importId?: string;
}
interface DeletionOp {
  kind: Kind;
  id: string;
}
interface AppliedRow {
  kind: Kind;
  id: string;
  rev: number;
  deletedAt: number | null;
}

function parseUpserts(raw: unknown): { value: UpsertOp[] } | { error: string } {
  if (raw == null) return { value: [] };
  if (!Array.isArray(raw)) return { error: 'upserts must be an array.' };
  const out: UpsertOp[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Record<string, unknown> | null;
    if (!r || typeof r !== 'object') return { error: `upserts[${i}] must be an object.` };
    if (!isKind(r.kind)) return { error: `upserts[${i}].kind is invalid.` };
    if (typeof r.id !== 'string' || r.id.length === 0)
      return { error: `upserts[${i}].id must be a non-empty string.` };
    if (r.kind === 'card') {
      if (r.importId !== undefined && typeof r.importId !== 'string')
        return { error: `upserts[${i}].importId must be a string when provided.` };
    }
    out.push({
      kind: r.kind,
      id: r.id,
      data: r.data,
      ...(r.kind === 'card' && typeof r.importId === 'string' ? { importId: r.importId } : {}),
    });
  }
  return { value: out };
}

function parseDeletions(raw: unknown): { value: DeletionOp[] } | { error: string } {
  if (raw == null) return { value: [] };
  if (!Array.isArray(raw)) return { error: 'deletions must be an array.' };
  const out: DeletionOp[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Record<string, unknown> | null;
    if (!r || typeof r !== 'object') return { error: `deletions[${i}] must be an object.` };
    if (!isKind(r.kind)) return { error: `deletions[${i}].kind is invalid.` };
    if (typeof r.id !== 'string' || r.id.length === 0)
      return { error: `deletions[${i}].id must be a non-empty string.` };
    out.push({ kind: r.kind, id: r.id });
  }
  return { value: out };
}

function parseSince(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function parseLimit(raw: unknown): number {
  if (raw == null || raw === '') return DEFAULT_PAGE_LIMIT;
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.floor(n), MAX_PAGE_LIMIT);
}

/**
 * Paged delta pull. UNION ALL across the five entity tables filtered by
 * `rev > since`, ordered by `rev ASC` so the client can apply in order and
 * advance its cursor monotonically.
 */
syncRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const since = parseSince(req.query.since);
  const limit = parseLimit(req.query.limit);

  // Fetch limit+1 to detect hasMore without a second COUNT query.
  const { rows } = await getPool().query<{
    kind: Kind;
    id: string;
    data: unknown;
    rev: string;
    deleted_at: string | null;
    import_id: string | null;
  }>(
    `
    SELECT 'import'::text AS kind, id, data, rev, deleted_at, NULL::text AS import_id
      FROM user_imports WHERE user_id = $1 AND rev > $2
    UNION ALL
    SELECT 'card'::text AS kind, id, data, rev, deleted_at, import_id
      FROM user_cards WHERE user_id = $1 AND rev > $2
    UNION ALL
    SELECT 'binder'::text AS kind, id, data, rev, deleted_at, NULL::text
      FROM user_binders WHERE user_id = $1 AND rev > $2
    UNION ALL
    SELECT 'deck'::text AS kind, id, data, rev, deleted_at, NULL::text
      FROM user_decks WHERE user_id = $1 AND rev > $2
    UNION ALL
    SELECT 'game'::text AS kind, id, data, rev, deleted_at, NULL::text
      FROM user_games WHERE user_id = $1 AND rev > $2
    UNION ALL
    SELECT 'list'::text AS kind, id, data, rev, deleted_at, NULL::text
      FROM user_lists WHERE user_id = $1 AND rev > $2
    ORDER BY rev ASC
    LIMIT $3
    `,
    [userId, since, limit + 1]
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const out = page.map((r) => ({
    kind: r.kind,
    id: r.id,
    data: r.data,
    rev: Number(r.rev),
    deletedAt: r.deleted_at == null ? null : Number(r.deleted_at),
    ...(r.kind === 'card' ? { importId: r.import_id ?? '' } : {}),
  }));
  const cursor = out.length > 0 ? out[out.length - 1].rev : since;
  res.json({ rows: out, cursor, hasMore });
});

/**
 * Apply a delta batch. One transaction; each operation gets a fresh `rev`
 * from the shared sequence. Deleting an import cascades to its cards (each
 * cascade tombstone gets its own rev, surfaced in `applied` so the client
 * can stamp them locally).
 *
 * A delete that targets a row the server doesn't have inserts a tombstone-
 * only row anyway — defensive, so a future upsert with the same id from a
 * peer can still observe the deletion.
 */
syncRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const body = req.body as { upserts?: unknown; deletions?: unknown };

  const upserts = parseUpserts(body.upserts);
  if ('error' in upserts) return res.status(400).json({ error: upserts.error });
  const deletions = parseDeletions(body.deletions);
  if ('error' in deletions) return res.status(400).json({ error: deletions.error });

  if (upserts.value.length + deletions.value.length > MAX_BATCH_SIZE) {
    return res.status(413).json({
      error: `Batch too large; max ${MAX_BATCH_SIZE} operations per request.`,
    });
  }

  const now = Date.now();
  const applied: AppliedRow[] = [];
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    for (const u of upserts.value) {
      const r = await nextRev(client);
      const table = KIND_TO_TABLE[u.kind];
      const dataJson = u.data === undefined ? null : JSON.stringify(u.data);
      if (u.kind === 'card') {
        await client.query(
          `INSERT INTO user_cards
             (user_id, id, import_id, data, rev, deleted_at, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, NULL, $6)
           ON CONFLICT (user_id, id) DO UPDATE
             SET import_id = EXCLUDED.import_id,
                 data = EXCLUDED.data,
                 rev = EXCLUDED.rev,
                 deleted_at = NULL,
                 updated_at = EXCLUDED.updated_at`,
          [userId, u.id, u.importId ?? '', dataJson, r, now]
        );
      } else {
        await client.query(
          `INSERT INTO ${table}
             (user_id, id, data, rev, deleted_at, updated_at)
           VALUES ($1, $2, $3::jsonb, $4, NULL, $5)
           ON CONFLICT (user_id, id) DO UPDATE
             SET data = EXCLUDED.data,
                 rev = EXCLUDED.rev,
                 deleted_at = NULL,
                 updated_at = EXCLUDED.updated_at`,
          [userId, u.id, dataJson, r, now]
        );
      }
      applied.push({ kind: u.kind, id: u.id, rev: r, deletedAt: null });
    }

    for (const d of deletions.value) {
      // Cascade-on-import-delete: tombstone every live card under this import
      // before tombstoning the import itself. Each cascaded card gets its own
      // rev so peers see them all reach the new state in order.
      if (d.kind === 'import') {
        const cards = await client.query<{ id: string }>(
          `SELECT id FROM user_cards
           WHERE user_id = $1 AND import_id = $2 AND deleted_at IS NULL`,
          [userId, d.id]
        );
        for (const c of cards.rows) {
          const cr = await nextRev(client);
          await client.query(
            `UPDATE user_cards
             SET data = NULL, rev = $3, deleted_at = $4, updated_at = $4
             WHERE user_id = $1 AND id = $2`,
            [userId, c.id, cr, now]
          );
          applied.push({ kind: 'card', id: c.id, rev: cr, deletedAt: now });
        }
      }

      const r = await nextRev(client);
      const table = KIND_TO_TABLE[d.kind];
      const result = await client.query(
        `UPDATE ${table}
         SET data = NULL, rev = $3, deleted_at = $4, updated_at = $4
         WHERE user_id = $1 AND id = $2`,
        [userId, d.id, r, now]
      );
      if (result.rowCount === 0) {
        // Tombstone-of-an-unknown-row: insert a tombstone shell so a future
        // peer upsert can still observe the deletion (last-write-wins by rev).
        // Defensive — typically the client only deletes rows it knows exist.
        if (d.kind === 'card') {
          await client.query(
            `INSERT INTO user_cards
               (user_id, id, import_id, data, rev, deleted_at, updated_at)
             VALUES ($1, $2, '', NULL, $3, $4, $4)
             ON CONFLICT (user_id, id) DO NOTHING`,
            [userId, d.id, r, now]
          );
        } else {
          await client.query(
            `INSERT INTO ${table}
               (user_id, id, data, rev, deleted_at, updated_at)
             VALUES ($1, $2, NULL, $3, $4, $4)
             ON CONFLICT (user_id, id) DO NOTHING`,
            [userId, d.id, r, now]
          );
        }
      }
      applied.push({ kind: d.kind, id: d.id, rev: r, deletedAt: now });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.warn(`[sync] POST.fail user=${userId}`, err);
    throw err;
  } finally {
    client.release();
  }

  const cursor = applied.reduce((mx, a) => Math.max(mx, a.rev), 0);
  logger.debug(
    `[sync] POST.ok user=${userId} upserts=${upserts.value.length} ` +
      `deletions=${deletions.value.length} ` +
      `cascaded=${applied.length - upserts.value.length - deletions.value.length} ` +
      `cursor=${cursor}`
  );
  res.json({ applied, cursor });
});

interface QueryClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

async function nextRev(client: QueryClient): Promise<number> {
  const { rows } = await client.query<{ rev: string }>(
    `SELECT nextval('user_data_rev_seq') AS rev`
  );
  return Number(rows[0].rev);
}
