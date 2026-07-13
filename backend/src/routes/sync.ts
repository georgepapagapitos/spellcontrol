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
 *            deletions: [{ kind, id }],
 *            cardGroupChecks?: [{ scryfallId, finish, baseline: copyId[] }] }
 *     → { applied, conflicts, cursor }
 *
 * Every user-data row carries its own monotonic `rev` (from `user_data_rev_seq`)
 * and a `deleted_at` tombstone. Clients pull deltas since the last cursor and
 * apply tombstones, so a deletion on one device propagates to every other
 * device on its next pull — replacing the prior whole-blob model that could
 * resurrect deletions from a stale device.
 *
 * No `baseVersion`, no 409 (HTTP always 200). Last-write-wins per row for
 * every kind except decks, which use per-row optimistic concurrency via
 * `clientRev`: a stale write is rejected in-band and returned in `conflicts[]`.
 *
 * Deleting an import cascades to all `user_cards` rows with that `import_id`
 * inside the same transaction — each cascaded card gets its own tombstone row
 * with a fresh `rev`, so peers see the cards disappear too.
 *
 * Cards get a narrower reject-stale of their own (E129): a card row's `rev`
 * is still unconditional LWW, but quantity is row CARDINALITY (one row per
 * copy), so two devices adding/removing different copyIds of the same
 * printing from a stale shared count never collide per-row — the server
 * would otherwise silently union to a total neither device intended. The
 * optional `cardGroupChecks` on the POST body assert the client's believed
 * live copyIds for a (scryfallId, finish) group; if the group's actual live
 * set no longer matches, every upsert/deletion in this batch touching that
 * group is rejected together and reported via the SAME `conflicts[]` shape
 * as decks (kind: 'card'), so the client's existing conflict-apply path
 * handles it with no new code. Absent/empty `cardGroupChecks` (old clients,
 * or a batch with no cardinality-changing card op) skips this entirely —
 * unconditional last-write-wins, byte-identical to before E129.
 */

const DEFAULT_PAGE_LIMIT = 2000;
const MAX_PAGE_LIMIT = 5000;
/** Cap on (upserts + deletions) in a single POST. Protects the tx + JSON body. */
const MAX_BATCH_SIZE = 5000;

type Kind = 'import' | 'card' | 'binder' | 'deck' | 'game' | 'list' | 'cube';

const KIND_TO_TABLE: Record<Kind, string> = {
  import: 'user_imports',
  card: 'user_cards',
  binder: 'user_binders',
  deck: 'user_decks',
  game: 'user_games',
  list: 'user_lists',
  cube: 'user_cubes',
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

/** E129: a client's asserted baseline for one (scryfallId, finish) printing group. */
interface CardGroupCheck {
  scryfallId: string;
  finish: string;
  baseline: string[];
}

const MAX_GROUP_CHECKS = 500;

function parseCardGroupChecks(raw: unknown): { value: CardGroupCheck[] } | { error: string } {
  if (raw == null) return { value: [] };
  if (!Array.isArray(raw)) return { error: 'cardGroupChecks must be an array.' };
  if (raw.length > MAX_GROUP_CHECKS)
    return { error: `Too many cardGroupChecks; max ${MAX_GROUP_CHECKS} per request.` };
  const out: CardGroupCheck[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Record<string, unknown> | null;
    if (!r || typeof r !== 'object') return { error: `cardGroupChecks[${i}] must be an object.` };
    if (typeof r.scryfallId !== 'string' || r.scryfallId.length === 0)
      return { error: `cardGroupChecks[${i}].scryfallId must be a non-empty string.` };
    if (typeof r.finish !== 'string' || r.finish.length === 0)
      return { error: `cardGroupChecks[${i}].finish must be a non-empty string.` };
    if (!Array.isArray(r.baseline) || r.baseline.some((x) => typeof x !== 'string'))
      return { error: `cardGroupChecks[${i}].baseline must be an array of strings.` };
    out.push({ scryfallId: r.scryfallId, finish: r.finish, baseline: r.baseline as string[] });
  }
  return { value: out };
}

/** Delimiter is safe: scryfallId is a UUID and finish is one of a small enum, neither contains it. */
function cardGroupKey(scryfallId: string, finish: string): string {
  return `${scryfallId}::${finish}`;
}

/** A card row's own (scryfallId, finish) group key, read off its stored JSON data. */
function cardGroupOfData(data: unknown): string | undefined {
  const d = data as { scryfallId?: string; finish?: string } | null;
  return d?.scryfallId ? cardGroupKey(d.scryfallId, d.finish ?? 'nonfoil') : undefined;
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
  // `fresh=1` ⇒ the client has no local rows (bootstrap pull), so skip every
  // tombstone and return only live rows — it has nothing to delete, and a
  // long-lived account's historical tombstones would otherwise dominate the
  // first pull. `$3 = includeTombstones`: true keeps the delete-propagating
  // behaviour for incremental (since > 0) pulls.
  const includeTombstones = req.query.fresh !== '1';

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
      FROM user_imports WHERE user_id = $1 AND rev > $2 AND ($3 OR deleted_at IS NULL)
    UNION ALL
    SELECT 'card'::text AS kind, id, data, rev, deleted_at, import_id
      FROM user_cards WHERE user_id = $1 AND rev > $2 AND ($3 OR deleted_at IS NULL)
    UNION ALL
    SELECT 'binder'::text AS kind, id, data, rev, deleted_at, NULL::text
      FROM user_binders WHERE user_id = $1 AND rev > $2 AND ($3 OR deleted_at IS NULL)
    UNION ALL
    SELECT 'deck'::text AS kind, id, data, rev, deleted_at, NULL::text
      FROM user_decks WHERE user_id = $1 AND rev > $2 AND ($3 OR deleted_at IS NULL)
    UNION ALL
    SELECT 'game'::text AS kind, id, data, rev, deleted_at, NULL::text
      FROM user_games WHERE user_id = $1 AND rev > $2 AND ($3 OR deleted_at IS NULL)
    UNION ALL
    SELECT 'list'::text AS kind, id, data, rev, deleted_at, NULL::text
      FROM user_lists WHERE user_id = $1 AND rev > $2 AND ($3 OR deleted_at IS NULL)
    UNION ALL
    SELECT 'cube'::text AS kind, id, data, rev, deleted_at, NULL::text
      FROM user_cubes WHERE user_id = $1 AND rev > $2 AND ($3 OR deleted_at IS NULL)
    ORDER BY rev ASC
    LIMIT $4
    `,
    [userId, since, includeTombstones, limit + 1]
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
  const body = req.body as {
    upserts?: unknown;
    deletions?: unknown;
    cardGroupChecks?: unknown;
  };

  const upserts = parseUpserts(body.upserts);
  if ('error' in upserts) return res.status(400).json({ error: upserts.error });
  const deletions = parseDeletions(body.deletions);
  if ('error' in deletions) return res.status(400).json({ error: deletions.error });
  const cardGroupChecks = parseCardGroupChecks(body.cardGroupChecks);
  if ('error' in cardGroupChecks) return res.status(400).json({ error: cardGroupChecks.error });

  if (upserts.value.length + deletions.value.length > MAX_BATCH_SIZE) {
    return res.status(413).json({
      error: `Batch too large; max ${MAX_BATCH_SIZE} operations per request.`,
    });
  }

  const now = Date.now();
  const applied: AppliedRow[] = [];
  const conflicts: Array<{
    kind: 'deck' | 'card';
    id: string;
    serverRev: number;
    serverData: unknown;
    /** Card-only; the row's owning import so the client's restore doesn't lose it. */
    importId?: string;
  }> = [];
  const client = await getPool().connect();
  // A failed ROLLBACK leaves the connection in an aborted-transaction state;
  // pass it to release() so pg destroys it instead of recycling a poisoned
  // connection back into the pool (which would corrupt the next request).
  let rollbackFailed: Error | undefined;
  try {
    await client.query('BEGIN');

    // ── E129: card printing-group reject-stale check. Runs BEFORE any of this
    //    transaction's own writes, so it reflects the pre-batch server state.
    //    Absent/empty cardGroupChecks (old clients, or a batch with no
    //    cardinality-changing card op) leaves staleGroups empty and every
    //    branch below is a no-op — unconditional LWW, unchanged. ──
    const staleGroups = new Set<string>();
    for (const chk of cardGroupChecks.value) {
      const { rows: liveRows } = await client.query<{ id: string }>(
        `SELECT id FROM user_cards
         WHERE user_id = $1 AND deleted_at IS NULL
           AND data->>'scryfallId' = $2 AND COALESCE(data->>'finish', 'nonfoil') = $3`,
        [userId, chk.scryfallId, chk.finish]
      );
      const liveIds = liveRows.map((r) => r.id).sort();
      const baseline = [...chk.baseline].sort();
      const same =
        liveIds.length === baseline.length && liveIds.every((id, i) => id === baseline[i]);
      if (!same) staleGroups.add(cardGroupKey(chk.scryfallId, chk.finish));
    }

    // Current server state for every card id this batch touches — needed only
    // when a group turned out stale, both to identify which specific
    // upserts/deletions belong to it (a deletion carries no data of its own to
    // derive a group from) and to hand the client back what to self-heal to.
    let staleCardServerRows = new Map<string, { data: unknown; rev: number; importId: string }>();
    if (staleGroups.size > 0) {
      const touchedCardIds = [
        ...upserts.value.filter((u) => u.kind === 'card').map((u) => u.id),
        ...deletions.value.filter((d) => d.kind === 'card').map((d) => d.id),
      ];
      if (touchedCardIds.length > 0) {
        const { rows: current } = await client.query<{
          id: string;
          data: unknown;
          rev: string;
          import_id: string;
        }>(
          `SELECT id, data, rev, import_id FROM user_cards
           WHERE user_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL`,
          [userId, touchedCardIds]
        );
        staleCardServerRows = new Map(
          current.map((r) => [r.id, { data: r.data, rev: Number(r.rev), importId: r.import_id }])
        );
      }
    }

    // Allocate every rev this request needs in ONE sequence round-trip. The
    // old code called nextval() once per row inside the loop, so a 2000-row
    // chunk meant 2000 extra round-trips to the DB (~24s on prod). Pairing
    // this with the batched writes below collapses a chunk to a handful of
    // queries total. nextval() is non-transactional, so a rollback just leaves
    // unused gaps in the sequence — harmless. (Import-cascade tombstones draw
    // their revs from nextval() inside the cascade UPDATE itself, below.)
    const revs = await allocRevs(client, upserts.value.length + deletions.value.length);
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
      if (u.kind === 'card' && staleGroups.size > 0) {
        const gk = cardGroupOfData(u.data);
        if (gk && staleGroups.has(gk)) {
          const server = staleCardServerRows.get(u.id);
          conflicts.push({
            kind: 'card',
            id: u.id,
            serverRev: server?.rev ?? 0,
            serverData: server?.data ?? null,
            ...(server ? { importId: server.importId } : {}),
          });
          continue; // rejected: group changed elsewhere — don't apply, rev r goes unused
        }
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
    //    clientRev 0/absent keeps the unconditional last-write-wins every other
    //    kind uses — back-compat for non-deck kinds and any pre-clientRev client. ──
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

    // ── Deletions (+ cascades). ──
    const delByKind = new Map<Kind, Map<string, number>>();
    for (const d of deletions.value) {
      const r = revs[ri++];
      if (d.kind === 'card' && staleGroups.size > 0) {
        const server = staleCardServerRows.get(d.id);
        const gk = server ? cardGroupOfData(server.data) : undefined;
        if (server && gk && staleGroups.has(gk)) {
          conflicts.push({
            kind: 'card',
            id: d.id,
            serverRev: server.rev,
            serverData: server.data,
            importId: server.importId,
          });
          continue; // rejected: group changed elsewhere — leave this row alone
        }
      }
      const bucket = delByKind.get(d.kind) ?? new Map();
      delByKind.set(d.kind, bucket);
      bucket.set(d.id, r);
      applied.push({ kind: d.kind, id: d.id, rev: r, deletedAt: now });
    }

    // Import-delete cascades: tombstone every live card under a deleted
    // import in ONE atomic UPDATE, drawing revs from nextval() in-statement.
    // The old pre-SELECT → bulk-UPDATE pair left a READ COMMITTED window
    // where a concurrently-committed card upsert slipped between the SELECT
    // and the UPDATE and survived as a live orphan under a tombstoned import
    // (E67). Running the cascade after this batch's upserts also means a
    // card upserted in the same batch as its import's deletion is cascaded
    // too — the delete wins, matching cross-batch semantics. (A card that
    // commits in another transaction after this one has no fix at the
    // cascade side; that residual is cosmetic import-grouping only.)
    const importDeleteIds = [...(delByKind.get('import')?.keys() ?? [])];
    if (importDeleteIds.length > 0) {
      const cascaded = await client.query<{ id: string; rev: string }>(
        `UPDATE user_cards
         SET data = NULL, rev = nextval('user_data_rev_seq'), deleted_at = $2, updated_at = $2
         WHERE user_id = $1 AND import_id = ANY($3::text[]) AND deleted_at IS NULL
         RETURNING id, rev`,
        [userId, now, importDeleteIds]
      );
      for (const row of cascaded.rows) {
        applied.push({ kind: 'card', id: row.id, rev: Number(row.rev), deletedAt: now });
      }
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
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      rollbackFailed = rbErr instanceof Error ? rbErr : new Error(String(rbErr));
      logger.warn(`[sync] POST.rollback-failed user=${userId}`, rbErr);
    }
    logger.warn(`[sync] POST.fail user=${userId}`, err);
    throw err;
  } finally {
    client.release(rollbackFailed);
  }

  const cursor = applied.reduce((mx, a) => Math.max(mx, a.rev), 0);
  // Rejected ops (conflicts) can now come from either upserts or deletions
  // (E129 card-group check, not just the deck path), so back out cascade
  // count from the total submitted minus whatever wasn't applied.
  const cascaded =
    applied.length - (upserts.value.length + deletions.value.length - conflicts.length);
  logger.debug(
    `[sync] POST.ok user=${userId} upserts=${upserts.value.length} ` +
      `deletions=${deletions.value.length} conflicts=${conflicts.length} ` +
      `cascaded=${cascaded} cursor=${cursor}`
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
