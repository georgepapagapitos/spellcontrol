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
 *     body { upserts: [{ kind, id, data, importId?, clientRev? }],
 *            deletions: [{ kind, id }] }
 *     → { applied, conflicts, cursor }
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
  /**
   * Deck-only optimistic-concurrency token: the `rev` the client last saw for
   * this deck. When > 0 the server only writes if the stored rev still matches,
   * otherwise it reports a conflict (see the deck reject-stale path below).
   * Absent/0 = unconditional last-write-wins, the behaviour for every other kind.
   */
  clientRev?: number;
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
    if (r.kind === 'deck' && r.clientRev !== undefined) {
      if (typeof r.clientRev !== 'number' || !Number.isFinite(r.clientRev) || r.clientRev < 0)
        return { error: `upserts[${i}].clientRev must be a non-negative number when provided.` };
    }
    out.push({
      kind: r.kind,
      id: r.id,
      data: r.data,
      ...(r.kind === 'card' && typeof r.importId === 'string' ? { importId: r.importId } : {}),
      ...(r.kind === 'deck' && typeof r.clientRev === 'number' ? { clientRev: r.clientRev } : {}),
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
  const conflicts: Array<{ kind: 'deck'; id: string; serverRev: number; serverData: unknown }> = [];
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Resolve import-delete cascades up front: every live card under a deleted
    // import becomes a tombstone. Doing the SELECTs first lets us allocate the
    // exact number of revs in a single round-trip below.
    const cascadeIdsByDeletion: (string[] | null)[] = [];
    for (const d of deletions.value) {
      if (d.kind === 'import') {
        const cards = await client.query<{ id: string }>(
          `SELECT id FROM user_cards
           WHERE user_id = $1 AND import_id = $2 AND deleted_at IS NULL`,
          [userId, d.id]
        );
        cascadeIdsByDeletion.push(cards.rows.map((r) => r.id));
      } else {
        cascadeIdsByDeletion.push(null);
      }
    }

    // Allocate every rev this request needs in ONE sequence round-trip. The
    // old code called nextval() once per row inside the loop, so a 2000-row
    // chunk meant 2000 extra round-trips to the DB (~24s on prod). Pairing
    // this with the batched writes below collapses a chunk to a handful of
    // queries total. nextval() is non-transactional, so a rollback just leaves
    // unused gaps in the sequence — harmless.
    const cascadeTotal = cascadeIdsByDeletion.reduce((n, ids) => n + (ids?.length ?? 0), 0);
    const revs = await allocRevs(
      client,
      upserts.value.length + deletions.value.length + cascadeTotal
    );
    let ri = 0;

    // ── Upserts: one bulk INSERT … ON CONFLICT per kind via unnest. ──
    // De-dupe by id within a kind (last write wins) so a batch that happens to
    // carry the same id twice can't trip "ON CONFLICT cannot affect row a
    // second time". data is passed as text[] and cast per-row to jsonb, which
    // sidesteps the fiddlier jsonb[] array binding.
    type UpsertBucket = Map<string, { data: string | null; rev: number; importId: string }>;
    const upsertByKind = new Map<Kind, UpsertBucket>();
    // Decks are handled separately (optimistic concurrency, below), not in the
    // bulk unnest path. De-duped by id like the buckets — last write wins.
    const deckUpserts = new Map<string, { data: string | null; rev: number; clientRev: number }>();
    for (const u of upserts.value) {
      const r = revs[ri++];
      if (u.kind === 'deck') {
        deckUpserts.set(u.id, {
          data: u.data === undefined ? null : JSON.stringify(u.data),
          rev: r,
          clientRev: u.clientRev ?? 0,
        });
        continue;
      }
      const bucket = upsertByKind.get(u.kind) ?? new Map();
      upsertByKind.set(u.kind, bucket);
      bucket.set(u.id, {
        data: u.data === undefined ? null : JSON.stringify(u.data),
        rev: r,
        importId: u.importId ?? '',
      });
    }
    for (const [kind, bucket] of upsertByKind) {
      const ids = [...bucket.keys()];
      const datas = ids.map((id) => bucket.get(id)!.data);
      const bucketRevs = ids.map((id) => bucket.get(id)!.rev);
      if (kind === 'card') {
        const importIds = ids.map((id) => bucket.get(id)!.importId);
        await client.query(
          `INSERT INTO user_cards (user_id, id, import_id, data, rev, deleted_at, updated_at)
           SELECT $1, u.id, u.import_id, u.data::jsonb, u.rev, NULL, $2
           FROM unnest($3::text[], $4::text[], $5::text[], $6::bigint[])
             AS u(id, import_id, data, rev)
           ON CONFLICT (user_id, id) DO UPDATE
             SET import_id = EXCLUDED.import_id, data = EXCLUDED.data, rev = EXCLUDED.rev,
                 deleted_at = NULL, updated_at = EXCLUDED.updated_at`,
          [userId, now, ids, importIds, datas, bucketRevs]
        );
      } else {
        await client.query(
          `INSERT INTO ${KIND_TO_TABLE[kind]} (user_id, id, data, rev, deleted_at, updated_at)
           SELECT $1, u.id, u.data::jsonb, u.rev, NULL, $2
           FROM unnest($3::text[], $4::text[], $5::bigint[]) AS u(id, data, rev)
           ON CONFLICT (user_id, id) DO UPDATE
             SET data = EXCLUDED.data, rev = EXCLUDED.rev,
                 deleted_at = NULL, updated_at = EXCLUDED.updated_at`,
          [userId, now, ids, datas, bucketRevs]
        );
      }
      for (const id of ids) applied.push({ kind, id, rev: bucket.get(id)!.rev, deletedAt: null });
    }

    // ── Decks: optimistic concurrency (reject-stale). A deck is a rich blob
    //    where a silent last-write-wins clobber loses real work, so when the
    //    client sends the rev it last saw (clientRev > 0) we only write if the
    //    stored rev still matches; otherwise we report the server's current row
    //    as a conflict and leave it untouched (server wins, client re-pulls).
    //    clientRev 0/absent (every pre-clientRev client) keeps the unconditional
    //    last-write-wins every other kind uses — so this path is dormant and
    //    behaviour-neutral until the client starts sending clientRev. ──
    for (const [id, d] of deckUpserts) {
      if (d.clientRev > 0) {
        const upd = await client.query(
          `UPDATE user_decks
           SET data = $3::jsonb, rev = $4, deleted_at = NULL, updated_at = $5
           WHERE user_id = $1 AND id = $2 AND rev = $6
           RETURNING id`,
          [userId, id, d.data, d.rev, now, d.clientRev]
        );
        if (upd.rowCount === 1) {
          applied.push({ kind: 'deck', id, rev: d.rev, deletedAt: null });
          continue;
        }
        // clientRev didn't match. If a row exists at a different rev it changed
        // on another device → conflict. If no row exists at all the client
        // referenced a rev for a deck we don't have → fall through to insert
        // rather than drop the user's data.
        const cur = await client.query<{ data: unknown; rev: string }>(
          `SELECT data, rev FROM user_decks WHERE user_id = $1 AND id = $2`,
          [userId, id]
        );
        if (cur.rows.length > 0) {
          conflicts.push({
            kind: 'deck',
            id,
            serverRev: Number(cur.rows[0].rev),
            serverData: cur.rows[0].data,
          });
          continue;
        }
      }
      // Unconditional last-write-wins: clientRev 0/absent, or a missing row above.
      await client.query(
        `INSERT INTO user_decks (user_id, id, data, rev, deleted_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, NULL, $5)
         ON CONFLICT (user_id, id) DO UPDATE
           SET data = EXCLUDED.data, rev = EXCLUDED.rev,
               deleted_at = NULL, updated_at = EXCLUDED.updated_at`,
        [userId, id, d.data, d.rev, now]
      );
      applied.push({ kind: 'deck', id, rev: d.rev, deletedAt: null });
    }

    // ── Deletions (+ cascades): assign revs in the same order the old loop did
    //    (cascade cards first, then the deletion itself), then bulk-tombstone. ──
    const cascadePairs: Array<{ id: string; rev: number }> = [];
    const delByKind = new Map<Kind, Map<string, number>>();
    for (let i = 0; i < deletions.value.length; i++) {
      const d = deletions.value[i];
      const cascadeIds = cascadeIdsByDeletion[i];
      if (cascadeIds) {
        for (const cid of cascadeIds) {
          const cr = revs[ri++];
          cascadePairs.push({ id: cid, rev: cr });
          applied.push({ kind: 'card', id: cid, rev: cr, deletedAt: now });
        }
      }
      const r = revs[ri++];
      const bucket = delByKind.get(d.kind) ?? new Map();
      delByKind.set(d.kind, bucket);
      bucket.set(d.id, r);
      applied.push({ kind: d.kind, id: d.id, rev: r, deletedAt: now });
    }

    // Cascade cards are known to exist (just SELECTed live), so a single bulk
    // UPDATE keyed by id is enough — no shell-insert fallback needed.
    if (cascadePairs.length > 0) {
      await client.query(
        `UPDATE user_cards AS c
         SET data = NULL, rev = v.rev, deleted_at = $2, updated_at = $2
         FROM unnest($3::text[], $4::bigint[]) AS v(id, rev)
         WHERE c.user_id = $1 AND c.id = v.id`,
        [userId, now, cascadePairs.map((p) => p.id), cascadePairs.map((p) => p.rev)]
      );
    }

    for (const [kind, bucket] of delByKind) {
      const ids = [...bucket.keys()];
      const delRevs = ids.map((id) => bucket.get(id)!);
      const updated = await client.query<{ id: string }>(
        `UPDATE ${KIND_TO_TABLE[kind]} AS t
         SET data = NULL, rev = v.rev, deleted_at = $2, updated_at = $2
         FROM unnest($3::text[], $4::bigint[]) AS v(id, rev)
         WHERE t.user_id = $1 AND t.id = v.id
         RETURNING t.id`,
        [userId, now, ids, delRevs]
      );
      // Tombstone-of-an-unknown-row: any requested id the UPDATE didn't hit gets
      // a tombstone shell so a later peer upsert still observes the deletion
      // (last-write-wins by rev). Defensive — clients normally delete known rows.
      const matched = new Set(updated.rows.map((r) => r.id));
      const missing = ids.filter((id) => !matched.has(id));
      if (missing.length > 0) {
        const missingRevs = missing.map((id) => bucket.get(id)!);
        if (kind === 'card') {
          await client.query(
            `INSERT INTO user_cards (user_id, id, import_id, data, rev, deleted_at, updated_at)
             SELECT $1, v.id, '', NULL, v.rev, $2, $2
             FROM unnest($3::text[], $4::bigint[]) AS v(id, rev)
             ON CONFLICT (user_id, id) DO NOTHING`,
            [userId, now, missing, missingRevs]
          );
        } else {
          await client.query(
            `INSERT INTO ${KIND_TO_TABLE[kind]} (user_id, id, data, rev, deleted_at, updated_at)
             SELECT $1, v.id, NULL, v.rev, $2, $2
             FROM unnest($3::text[], $4::bigint[]) AS v(id, rev)
             ON CONFLICT (user_id, id) DO NOTHING`,
            [userId, now, missing, missingRevs]
          );
        }
      }
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
      `deletions=${deletions.value.length} conflicts=${conflicts.length} ` +
      `cascaded=${applied.length - (upserts.value.length - conflicts.length) - deletions.value.length} ` +
      `cursor=${cursor}`
  );
  res.json({ applied, conflicts, cursor });
});

interface QueryClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

/**
 * Allocate `n` consecutive revs from the shared sequence in a single query.
 * `SELECT nextval(seq) FROM generate_series(1, n)` evaluates nextval() once per
 * generated row, yielding n distinct increasing values — the bulk-allocation
 * idiom that replaces the old one-round-trip-per-row pattern.
 */
async function allocRevs(client: QueryClient, n: number): Promise<number[]> {
  if (n <= 0) return [];
  const { rows } = await client.query<{ rev: string }>(
    `SELECT nextval('user_data_rev_seq') AS rev FROM generate_series(1, $1)`,
    [n]
  );
  return rows.map((r) => Number(r.rev));
}
