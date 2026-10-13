import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth';
import { getPool } from '../db';
import { testAwareLimiter } from '../route-utils';

/**
 * Bracket feedback (E418). A signed-in owner says whether the estimated bracket
 * looks right, or states the bracket their table plays the deck at. The label
 * is personal: it is never shown to anyone, and the only reader is the admin
 * export, which feeds human-reviewed calibration batches. Nothing here tunes
 * the estimator.
 *
 * One row per user, deck and deck content (`deck_hash` of the card list): a
 * re-vote on the same list updates the row, an edited list starts a new one.
 */
export const bracketVotesRouter: Router = Router();

const voteLimiter = testAwareLimiter({ windowMs: 60_000, max: 30 });

export const NOTE_MAX = 280;
/** The estimator's signal breakdown rides along; this bounds what a client can stash. */
const SIGNALS_MAX_BYTES = 64 * 1024;
const DECK_ID_MAX = 100;
const HASH = /^[0-9a-f]{64}$/;

export interface BracketVoteInput {
  deckId: string;
  deckHash: string;
  estimatorVersion: number;
  estimatedBracket: number;
  signals: Record<string, unknown>;
  statedBracket: number;
  vote: 'agree' | 'disagree';
  note: string;
}

function int(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

/** The validated vote, or the message to answer 400 with. */
export function parseBracketVote(body: unknown): BracketVoteInput | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'Invalid request.';
  const b = body as Record<string, unknown>;
  const deckId = typeof b.deckId === 'string' ? b.deckId : '';
  if (deckId.length < 1 || deckId.length > DECK_ID_MAX) return 'A deck is required.';
  const deckHash = typeof b.deckHash === 'string' ? b.deckHash.toLowerCase() : '';
  if (!HASH.test(deckHash)) return 'Invalid deck fingerprint.';
  const estimatorVersion = int(b.estimatorVersion, 1, 1000);
  if (estimatorVersion === null) return 'Invalid estimator version.';
  const estimatedBracket = int(b.estimatedBracket, 1, 5);
  const statedBracket = int(b.statedBracket, 1, 5);
  if (estimatedBracket === null || statedBracket === null) return 'Brackets run from 1 to 5.';
  const vote = b.vote;
  if (vote !== 'agree' && vote !== 'disagree') return 'The vote must be agree or disagree.';
  if ((vote === 'agree') !== (statedBracket === estimatedBracket)) {
    return 'The vote does not match the brackets.';
  }
  const signals = b.signals;
  if (typeof signals !== 'object' || signals === null || Array.isArray(signals)) {
    return 'Invalid signals.';
  }
  if (Buffer.byteLength(JSON.stringify(signals)) > SIGNALS_MAX_BYTES)
    return 'Signals are too large.';
  const rawNote = b.note === undefined ? '' : b.note;
  if (typeof rawNote !== 'string') return 'Invalid note.';
  const note = [...rawNote]
    .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c))
    .join('')
    .trim();
  if (note.length > NOTE_MAX) return `Keep the note to ${NOTE_MAX} characters.`;
  return {
    deckId,
    deckHash,
    estimatorVersion,
    estimatedBracket,
    signals: signals as Record<string, unknown>,
    statedBracket,
    vote,
    note,
  };
}

interface VoteRow {
  vote: string;
  stated_bracket: number;
  estimated_bracket: number;
  note: string;
  updated_at: string;
}

const shape = (r: VoteRow) => ({
  vote: r.vote,
  statedBracket: r.stated_bracket,
  estimatedBracket: r.estimated_bracket,
  note: r.note,
  updatedAt: Number(r.updated_at),
});

/** This account's vote on a deck's current content, or null. */
bracketVotesRouter.get('/', voteLimiter, requireAuth, async (req: Request, res: Response) => {
  const deckId = typeof req.query.deckId === 'string' ? req.query.deckId : '';
  const deckHash = typeof req.query.deckHash === 'string' ? req.query.deckHash.toLowerCase() : '';
  if (!deckId || deckId.length > DECK_ID_MAX || !HASH.test(deckHash)) {
    return res.status(400).json({ error: 'A deck and its fingerprint are required.' });
  }
  const { rows } = await getPool().query<VoteRow>(
    `SELECT vote, stated_bracket, estimated_bracket, note, updated_at::text AS updated_at
       FROM bracket_votes WHERE user_id = $1 AND deck_id = $2 AND deck_hash = $3`,
    [req.user!.id, deckId, deckHash]
  );
  res.json({ vote: rows[0] ? shape(rows[0]) : null });
});

/** Record or update the vote. */
bracketVotesRouter.put('/', voteLimiter, requireAuth, async (req: Request, res: Response) => {
  const parsed = parseBracketVote(req.body);
  if (typeof parsed === 'string') return res.status(400).json({ error: parsed });
  const pool = getPool();
  const userId = req.user!.id;
  // A deck the account already deleted has no labels to keep. A deck not yet
  // synced has no row at all, and that is fine: the first push is moments away.
  const deleted = await pool.query(
    `SELECT 1 FROM user_decks WHERE user_id = $1 AND id = $2 AND deleted_at IS NOT NULL`,
    [userId, parsed.deckId]
  );
  if (deleted.rowCount) return res.status(404).json({ error: 'That deck was deleted.' });
  const now = Date.now();
  const { rows } = await pool.query<VoteRow>(
    `INSERT INTO bracket_votes
       (user_id, deck_id, deck_hash, estimator_version, estimated_bracket, signals,
        stated_bracket, vote, note, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $10)
     ON CONFLICT (user_id, deck_id, deck_hash) DO UPDATE SET
       estimator_version = EXCLUDED.estimator_version,
       estimated_bracket = EXCLUDED.estimated_bracket,
       signals = EXCLUDED.signals,
       stated_bracket = EXCLUDED.stated_bracket,
       vote = EXCLUDED.vote,
       note = EXCLUDED.note,
       updated_at = EXCLUDED.updated_at
     RETURNING vote, stated_bracket, estimated_bracket, note, updated_at::text AS updated_at`,
    [
      userId,
      parsed.deckId,
      parsed.deckHash,
      parsed.estimatorVersion,
      parsed.estimatedBracket,
      JSON.stringify(parsed.signals),
      parsed.statedBracket,
      parsed.vote,
      parsed.note,
      now,
    ]
  );
  res.json({ vote: shape(rows[0]) });
});
