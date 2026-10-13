import { Router, type Request, type Response } from 'express';
import { requireAdmin } from '../auth';
import { getPool } from '../db';
import { testAwareLimiter } from '../route-utils';

export const adminBracketVotesRouter: Router = Router();

const adminLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

/**
 * GET /api/admin/bracket-votes[?format=csv]
 * The bracket feedback labels (E418) for a human-reviewed calibration batch:
 * every labelled deck with the estimate, its signal breakdown, what the owner
 * stated, the vote and the note. Disagreements first. Read-only; nothing
 * feeds the estimator automatically.
 */
adminBracketVotesRouter.get(
  '/',
  adminLimiter,
  requireAdmin,
  async (req: Request, res: Response) => {
    const { rows } = await getPool().query<{
      username: string;
      deck_id: string;
      deck_hash: string;
      estimator_version: number;
      estimated_bracket: number;
      stated_bracket: number;
      vote: string;
      note: string;
      signals: unknown;
      updated_at: string;
    }>(
      `SELECT u.username, v.deck_id, v.deck_hash, v.estimator_version, v.estimated_bracket,
            v.stated_bracket, v.vote, v.note, v.signals, v.updated_at::text AS updated_at
       FROM bracket_votes v JOIN users u ON u.id = v.user_id
      ORDER BY (v.vote = 'disagree') DESC, v.updated_at DESC
      LIMIT 5000`
    );
    const votes = rows.map((r) => ({
      username: r.username,
      deckId: r.deck_id,
      deckHash: r.deck_hash,
      estimatorVersion: r.estimator_version,
      estimatedBracket: r.estimated_bracket,
      statedBracket: r.stated_bracket,
      vote: r.vote,
      note: r.note,
      signals: r.signals,
      updatedAt: Number(r.updated_at),
    }));
    if (req.query.format !== 'csv') return res.json({ votes });
    // A cell that starts with = + - @ would run as a formula in a spreadsheet.
    const cell = (v: unknown) => {
      const t = typeof v === 'string' ? v : JSON.stringify(v);
      const safe = /^[-=+@\t\r]/.test(t) ? `'${t}` : t;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const head = [
      'username',
      'deckId',
      'deckHash',
      'estimatorVersion',
      'estimatedBracket',
      'statedBracket',
      'vote',
      'note',
      'signals',
      'updatedAt',
    ] as const;
    const lines = [head.join(',')].concat(votes.map((v) => head.map((k) => cell(v[k])).join(',')));
    res
      .type('text/csv')
      .set('Content-Disposition', 'attachment; filename="bracket-votes.csv"')
      .send(lines.join('\n'));
  }
);
