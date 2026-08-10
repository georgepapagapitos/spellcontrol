import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth';
import { getPool } from '../db';
import { areFriends } from '../friends/relations';
import { testAwareLimiter } from '../route-utils';
import type { TradeCard, TradeCopy } from '../db/schema';

/**
 * Friend-to-friend trade offers.
 *
 * This router is deliberately the app's one server-authoritative two-party
 * object. Everything else a user owns is single-writer and last-write-wins;
 * a trade has two writers and states that must not merge ("I accepted" racing
 * "I withdrew" is a correctness bug, not a conflict to resolve), so every
 * transition here is a conditional UPDATE guarded on the current status and a
 * losing racer gets a 409.
 *
 * ⚠️ It never touches user_cards. Accepting a trade does not move anybody's
 * collection rows server-side — each side's own client settles locally and
 * pushes through the normal sync queue (see frontend lib/trade-settlement.ts).
 * The settled_at columns only record that it happened, so the UI can
 * distinguish "accepted" from "accepted and already in your collection".
 */
export const tradesRouter: Router = Router();

// Reads are a list of the caller's own threads — same tier as the other
// per-friend reads. Writes are rarer and each one notifies another human,
// so they sit on the tighter tier shares.ts uses for its own writes.
const tradeReadLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });
const tradeWriteLimiter = testAwareLimiter({ windowMs: 60_000, max: 30 });

/** Per side. A trade is a handful of cards across a table, not a bulk import;
 *  the cap exists so a malicious client can't park megabytes in one JSONB. */
const MAX_LINES_PER_SIDE = 40;
const MAX_QUANTITY_PER_LINE = 20;
const MAX_NOTE_LENGTH = 500;
/** Newest-first listing cap. A pair that has traded more than this has history
 *  worth paging, which no surface asks for yet. */
const MAX_LISTED = 100;

export type TradeStatus = 'proposed' | 'accepted' | 'declined' | 'withdrawn';

interface TradeOfferRow {
  id: string;
  proposer_id: string;
  recipient_id: string;
  status: string;
  note: string;
  proposer_cards: unknown;
  recipient_cards: unknown;
  proposer_settled_at: string | null;
  recipient_settled_at: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

/** What a caller sees. Sides are named from the CALLER's point of view — the
 *  same offer reads as "you give X, you get Y" to one user and the mirror to
 *  the other, so no surface has to work out which end it is on. */
export interface TradeOfferView {
  id: string;
  /** True when the caller is the one who sent it. */
  mine: boolean;
  counterpartyId: string;
  counterpartyUsername: string;
  counterpartyDisplayName: string | null;
  status: TradeStatus;
  note: string;
  give: TradeCard[];
  receive: TradeCard[];
  /** Whether the CALLER has applied their side to their own collection. */
  settled: boolean;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseCopy(raw: unknown): TradeCopy | null {
  const r = asRecord(raw);
  if (!r) return null;
  const scryfallId = typeof r.scryfallId === 'string' ? r.scryfallId.slice(0, 64) : '';
  if (!scryfallId) return null;
  const copy: TradeCopy = {
    scryfallId,
    finish: typeof r.finish === 'string' ? r.finish.slice(0, 32) : 'nonfoil',
  };
  if (typeof r.condition === 'string' && r.condition) copy.condition = r.condition.slice(0, 32);
  if (typeof r.language === 'string' && r.language) copy.language = r.language.slice(0, 16);
  return copy;
}

/**
 * Normalizes one side of an offer. Returns null (rejecting the whole request)
 * rather than silently dropping malformed lines — a trade the sender can't see
 * the true contents of is worse than an error.
 *
 * `requireCopies` is true for a side whose printings must already be pinned
 * down: the proposer's own side at send time, and the recipient's side at
 * accept time. The other side legitimately arrives oracle-level.
 */
function parseSide(raw: unknown, requireCopies: boolean): TradeCard[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_LINES_PER_SIDE) return null;
  const seen = new Set<string>();
  const cards: TradeCard[] = [];
  for (const entry of raw) {
    const r = asRecord(entry);
    if (!r) return null;
    const oracleId = typeof r.oracleId === 'string' ? r.oracleId.slice(0, 64) : '';
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 200) : '';
    if (!oracleId || !name) return null;
    if (seen.has(oracleId)) return null;
    seen.add(oracleId);

    const quantity = typeof r.quantity === 'number' ? Math.floor(r.quantity) : 0;
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_LINE) {
      return null;
    }

    const rawCopies = Array.isArray(r.copies) ? r.copies : [];
    const copies: TradeCopy[] = [];
    for (const c of rawCopies) {
      const copy = parseCopy(c);
      if (!copy) return null;
      copies.push(copy);
    }
    // A resolved side must name exactly as many physical copies as it claims
    // to hand over, otherwise settlement on the far end is guesswork.
    if (requireCopies && copies.length !== quantity) return null;
    if (!requireCopies && copies.length > 0 && copies.length !== quantity) return null;

    cards.push({ oracleId, name, quantity, copies });
  }
  return cards;
}

function asCards(raw: unknown): TradeCard[] {
  // Stored rows were validated by parseSide on the way in; this is the
  // read-side coercion, not a second validation pass.
  return Array.isArray(raw) ? (raw as TradeCard[]) : [];
}

function toStatus(raw: string): TradeStatus {
  return raw === 'accepted' || raw === 'declined' || raw === 'withdrawn' ? raw : 'proposed';
}

function nullableNumber(raw: string | null): number | null {
  return raw === null ? null : Number(raw);
}

function toView(
  row: TradeOfferRow,
  callerId: string,
  counterparty: { username: string; displayName: string | null }
): TradeOfferView {
  const mine = row.proposer_id === callerId;
  return {
    id: row.id,
    mine,
    counterpartyId: mine ? row.recipient_id : row.proposer_id,
    counterpartyUsername: counterparty.username,
    counterpartyDisplayName: counterparty.displayName,
    status: toStatus(row.status),
    note: row.note,
    give: asCards(mine ? row.proposer_cards : row.recipient_cards),
    receive: asCards(mine ? row.recipient_cards : row.proposer_cards),
    settled: (mine ? row.proposer_settled_at : row.recipient_settled_at) !== null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    resolvedAt: nullableNumber(row.resolved_at),
  };
}

const SELECT_COLUMNS = `id, proposer_id, recipient_id, status, note, proposer_cards,
         recipient_cards, proposer_settled_at, recipient_settled_at,
         created_at, updated_at, resolved_at`;

/**
 * Loads an offer the caller is a party to. Returns null and writes a uniform
 * 404 otherwise — an offer between two other users must be indistinguishable
 * from one that never existed, the same existence-oracle care
 * tonight-trades.ts and game-results.ts take.
 */
async function loadOwnOffer(
  res: Response,
  callerId: string,
  offerId: string
): Promise<TradeOfferRow | null> {
  const { rows } = await getPool().query<TradeOfferRow>(
    `SELECT ${SELECT_COLUMNS} FROM trade_offers
      WHERE id = $1 AND (proposer_id = $2 OR recipient_id = $2)`,
    [offerId, callerId]
  );
  if (rows.length === 0) {
    res.status(404).json({ error: 'Trade offer not found.' });
    return null;
  }
  return rows[0];
}

/** Batch-resolves the display identity of every counterparty in a result set. */
async function loadCounterparties(
  ids: string[]
): Promise<Map<string, { username: string; displayName: string | null }>> {
  const map = new Map<string, { username: string; displayName: string | null }>();
  if (ids.length === 0) return map;
  const { rows } = await getPool().query<{
    id: string;
    username: string;
    display_name: string | null;
  }>(`SELECT id, username, display_name FROM users WHERE id = ANY($1::text[])`, [ids]);
  for (const r of rows) {
    map.set(r.id, { username: r.username, displayName: r.display_name });
  }
  return map;
}

async function viewFor(row: TradeOfferRow, callerId: string): Promise<TradeOfferView> {
  const otherId = row.proposer_id === callerId ? row.recipient_id : row.proposer_id;
  const map = await loadCounterparties([otherId]);
  return toView(row, callerId, map.get(otherId) ?? { username: '', displayName: null });
}

/**
 * POST /api/trades — propose a trade to a friend.
 *
 * `give` is the proposer's own side and MUST arrive with printings resolved:
 * they picked real copies out of their own collection, and that detail is the
 * only reason the card lands in the recipient's binder as the printing that
 * physically changed hands. `receive` is what they are asking for, named
 * oracle-level because the friend-collection projection they picked from is
 * oracle-level by design (contents yes, value no).
 */
tradesRouter.post('/', requireAuth, tradeWriteLimiter, async (req: Request, res: Response) => {
  const callerId = req.user!.id;
  const body = asRecord(req.body) ?? {};
  const recipientId = typeof body.recipientId === 'string' ? body.recipientId : '';

  if (!recipientId || recipientId === callerId) {
    return res.status(400).json({ error: 'Pick a friend to trade with.' });
  }
  if (!(await areFriends(callerId, recipientId))) {
    // Actionable on purpose: this fires for a game-night attendee the caller
    // hasn't added yet, and the thrown message IS the toast copy.
    return res.status(403).json({ error: 'You can only trade with friends — add them first.' });
  }

  const give = parseSide(body.give, true);
  const receive = parseSide(body.receive, false);
  if (!give || !receive) {
    return res.status(400).json({ error: 'That trade has a card we could not read.' });
  }
  if (give.length === 0 && receive.length === 0) {
    return res.status(400).json({ error: 'Add at least one card to the trade.' });
  }

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : '';
  const now = Date.now();
  const id = crypto.randomUUID();

  await getPool().query(
    `INSERT INTO trade_offers
         (id, proposer_id, recipient_id, status, note, proposer_cards, recipient_cards,
          created_at, updated_at)
       VALUES ($1, $2, $3, 'proposed', $4, $5::jsonb, $6::jsonb, $7, $7)`,
    [id, callerId, recipientId, note, JSON.stringify(give), JSON.stringify(receive), now]
  );

  const row = await loadOwnOffer(res, callerId, id);
  if (!row) return;
  res.status(201).json({ offer: await viewFor(row, callerId) });
});

/**
 * GET /api/trades — every offer the caller is a party to, newest first.
 * `?withUserId=` narrows to one friend (the friend hub's thread view);
 * `?status=` narrows to one state.
 */
tradesRouter.get('/', requireAuth, tradeReadLimiter, async (req: Request, res: Response) => {
  const callerId = req.user!.id;
  const withUserId = typeof req.query.withUserId === 'string' ? req.query.withUserId : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';

  const params: unknown[] = [callerId];
  let sql = `SELECT ${SELECT_COLUMNS} FROM trade_offers
              WHERE (proposer_id = $1 OR recipient_id = $1)`;
  if (withUserId) {
    params.push(withUserId);
    sql += ` AND (proposer_id = $${params.length} OR recipient_id = $${params.length})`;
  }
  if (status) {
    params.push(status);
    sql += ` AND status = $${params.length}`;
  }
  // Over-fetch by one so the cap can be REPORTED rather than silently applied.
  // Without this the client cannot tell "you have exactly 100 trades" from
  // "you have more and we quietly dropped the rest", and /trades' history group
  // only ever grows — so the page would eventually start lying by omission.
  params.push(MAX_LISTED + 1);
  sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

  const { rows: all } = await getPool().query<TradeOfferRow>(sql, params);
  const truncated = all.length > MAX_LISTED;
  const rows = truncated ? all.slice(0, MAX_LISTED) : all;
  const otherIds = [
    ...new Set(rows.map((r) => (r.proposer_id === callerId ? r.recipient_id : r.proposer_id))),
  ];
  const people = await loadCounterparties(otherIds);
  res.json({
    offers: rows.map((r) =>
      toView(
        r,
        callerId,
        people.get(r.proposer_id === callerId ? r.recipient_id : r.proposer_id) ?? {
          username: '',
          displayName: null,
        }
      )
    ),
    /** True when older offers exist beyond `MAX_LISTED` and were not returned. */
    truncated,
  });
});

/**
 * PATCH /api/trades/:id — accept, decline, or withdraw.
 *
 * Accepting carries `resolved`: the recipient's client stamping the exact
 * printings it is handing over onto its own side of the offer. Without it the
 * proposer would receive a card with no printing named and their binder would
 * show a default one — the same "it's a physical binder" fidelity the rest of
 * the app keeps.
 *
 * Every transition is a conditional UPDATE on status='proposed'. Two devices
 * racing, or an accept racing a withdraw, means exactly one wins and the loser
 * gets a 409 telling it to re-read.
 */
tradesRouter.patch('/:id', requireAuth, tradeWriteLimiter, async (req: Request, res: Response) => {
  const callerId = req.user!.id;
  const offerId = typeof req.params.id === 'string' ? req.params.id : '';
  const body = asRecord(req.body) ?? {};
  const action = typeof body.action === 'string' ? body.action : '';

  const existing = await loadOwnOffer(res, callerId, offerId);
  if (!existing) return;

  const isRecipient = existing.recipient_id === callerId;
  const now = Date.now();

  if (action === 'withdraw' || action === 'decline') {
    // Withdrawing is the sender's to do; declining is the receiver's.
    const allowed = action === 'withdraw' ? !isRecipient : isRecipient;
    if (!allowed) {
      return res.status(403).json({
        error: action === 'withdraw' ? 'Not your offer to withdraw.' : 'Not your offer to decline.',
      });
    }
    const { rowCount } = await getPool().query(
      `UPDATE trade_offers SET status = $2, resolved_at = $3, updated_at = $3
          WHERE id = $1 AND status = 'proposed'`,
      [offerId, action === 'withdraw' ? 'withdrawn' : 'declined', now]
    );
    if (rowCount === 0) {
      return res.status(409).json({ error: 'That trade was already answered.' });
    }
  } else if (action === 'accept') {
    if (!isRecipient) {
      return res.status(403).json({ error: 'Only the person offered a trade can accept it.' });
    }
    const asked = asCards(existing.recipient_cards);
    const resolved = parseSide(body.resolved, true);
    if (!resolved) {
      return res.status(400).json({ error: 'That trade has a card we could not read.' });
    }
    // The accepter may only pin down printings for the cards actually asked
    // for, in the quantities asked for — accept must not be a channel for
    // rewriting the deal. A genuine change of terms is a counter-offer,
    // which is a new offer in the other direction.
    const askedByOracle = new Map(asked.map((c) => [c.oracleId, c]));
    const sameShape =
      resolved.length === asked.length &&
      resolved.every((c) => askedByOracle.get(c.oracleId)?.quantity === c.quantity);
    if (!sameShape) {
      return res.status(400).json({ error: 'That trade changed while you were looking at it.' });
    }

    const { rowCount } = await getPool().query(
      `UPDATE trade_offers
            SET status = 'accepted', recipient_cards = $2::jsonb,
                resolved_at = $3, updated_at = $3
          WHERE id = $1 AND status = 'proposed'`,
      [offerId, JSON.stringify(resolved), now]
    );
    if (rowCount === 0) {
      return res.status(409).json({ error: 'That trade was already answered.' });
    }
  } else {
    return res.status(400).json({ error: 'Unknown action.' });
  }

  const row = await loadOwnOffer(res, callerId, offerId);
  if (!row) return;
  res.json({ offer: await viewFor(row, callerId) });
});

/**
 * POST /api/trades/:id/settled — the caller records that they have applied
 * their own side to their own collection.
 *
 * Idempotent by construction (the UPDATE is guarded on IS NULL), and it is
 * only ever a report of something the client already did: the client settles
 * locally FIRST and calls this second, so a crash in between re-settles on
 * next load rather than silently losing cards. Client-side settlement is
 * itself idempotent, which is what makes that ordering safe.
 */
tradesRouter.post(
  '/:id/settled',
  requireAuth,
  tradeWriteLimiter,
  async (req: Request, res: Response) => {
    const callerId = req.user!.id;
    const offerId = typeof req.params.id === 'string' ? req.params.id : '';

    const existing = await loadOwnOffer(res, callerId, offerId);
    if (!existing) return;
    if (existing.status !== 'accepted') {
      return res.status(409).json({ error: 'That trade was not accepted.' });
    }

    const column =
      existing.proposer_id === callerId ? 'proposer_settled_at' : 'recipient_settled_at';
    await getPool().query(
      `UPDATE trade_offers SET ${column} = $2, updated_at = $2
        WHERE id = $1 AND ${column} IS NULL`,
      [offerId, Date.now()]
    );

    const row = await loadOwnOffer(res, callerId, offerId);
    if (!row) return;
    res.json({ offer: await viewFor(row, callerId) });
  }
);
