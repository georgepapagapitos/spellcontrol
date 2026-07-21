import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth';
import { getPool } from '../db';
import { testAwareLimiter } from '../route-utils';
import {
  materializeBinders,
  type BinderDef,
  type EnrichedCard,
} from '@spellcontrol/binder-routing';
import { asRecord, asString } from '../shares/projections';

/**
 * Tonight's trades (w5-tonight-trades): a reciprocity-gated cross-reference of
 * opted-in attendees' tradeable-binder cards and want-lists for one game
 * night. The actual matching reuses frontend's `buildTradeRadar` unchanged,
 * called client-side once per attendee pair — this route's only job is the
 * reciprocity gate and projecting each opted-in attendee's data.
 */
export const tonightTradesRouter: Router = Router();

// Matches friends.ts's friendCollectionLimiter tier — the existing precedent
// for "heavier per-friend-collection read".
const tonightTradesLimiter = testAwareLimiter({ windowMs: 60_000, max: 30 });

const NOT_FOUND = { error: 'Game night not found.' };

type AnyRecord = Record<string, unknown>;

/** Wire shape matching friends.ts's `/:friendId/collection` FriendCard exactly,
 *  so the frontend feeds this straight into buildTradeRadar with no adaptation. */
interface TonightTradeCard {
  name: string;
  oracleId: string;
  colors: string[];
  cmc: number;
  typeLine: string;
  edhrecRank?: number;
}

function toTradeableCard(raw: unknown): TonightTradeCard | null {
  const r = asRecord(raw);
  if (!r) return null;
  const name = asString(r.name);
  const oracleId = asString(r.oracleId);
  if (!name || !oracleId) return null;
  const colors = Array.isArray(r.colors)
    ? r.colors.filter((c): c is string => typeof c === 'string')
    : [];
  const card: TonightTradeCard = {
    name,
    oracleId,
    colors,
    cmc: typeof r.cmc === 'number' ? r.cmc : 0,
    typeLine: typeof r.typeLine === 'string' ? r.typeLine : '',
  };
  // ponytail: no SQLite-cache rank backfill here (unlike friends.ts) —
  // edhrecRank is carried for FriendCard shape parity only; buildTradeRadar
  // and RadarCardTile never read it, so the extra lookup isn't worth it.
  if (typeof r.edhrecRank === 'number') card.edhrecRank = r.edhrecRank;
  return card;
}

/**
 * GET /api/tonight-trades/:nightId — the trade board for one game night's
 * opted-in attendees. In-app-only, authed, operating on the internal id
 * (matches how `PATCH /api/game-nights/:id` already operates on `:id`, not
 * `:token`).
 *
 * Uniform 404 for an unknown night, a night the caller was never invited to,
 * and a night the caller has a non-opted-in RSVP on — all indistinguishable
 * from the outside. Folded blocking fix: the source spec 404'd the first case
 * but 403'd the second, which would let any authed user learn from the status
 * code alone whether an arbitrary night id exists anywhere in the app —
 * exactly the existence oracle `game-results.ts` documents avoiding.
 */
tonightTradesRouter.get(
  '/:nightId',
  requireAuth,
  tonightTradesLimiter,
  async (req: Request, res: Response) => {
    const nightId = typeof req.params.nightId === 'string' ? req.params.nightId : '';
    const pool = getPool();

    const night = await pool.query(`SELECT 1 FROM game_nights WHERE id = $1`, [nightId]);
    if (night.rows.length === 0) {
      return res.status(404).json(NOT_FOUND);
    }
    const myRsvp = await pool.query<{ trade_opt_in: boolean }>(
      `SELECT trade_opt_in FROM game_night_rsvps WHERE night_id = $1 AND user_id = $2`,
      [nightId, req.user!.id]
    );
    if (myRsvp.rows.length === 0 || myRsvp.rows[0].trade_opt_in !== true) {
      return res.status(404).json(NOT_FOUND);
    }

    // Strict consent: only rows explicitly opted in (and account-backed —
    // guests are structurally excluded, per the write-side guard in
    // game-nights.ts) participate.
    const attendeeRows = await pool.query<{
      user_id: string;
      username: string;
      display_name: string;
    }>(
      `SELECT r.user_id, u.username, r.display_name
         FROM game_night_rsvps r
         JOIN users u ON u.id = r.user_id
        WHERE r.night_id = $1 AND r.trade_opt_in = true AND r.user_id IS NOT NULL`,
      [nightId]
    );

    const attendees = await Promise.all(
      attendeeRows.rows.map(async (row) => {
        // Sequential, not Promise.all: a Pool checks out one client per call
        // either way, but firing all three at once per attendee (times every
        // attendee concurrently via the outer Promise.all) pressures small
        // connection pools for no real benefit here.
        const cardRows = await pool.query<{ data: unknown }>(
          `SELECT data FROM user_cards WHERE user_id = $1 AND deleted_at IS NULL`,
          [row.user_id]
        );
        const binderRows = await pool.query<{ data: unknown }>(
          `SELECT data FROM user_binders WHERE user_id = $1 AND deleted_at IS NULL`,
          [row.user_id]
        );
        const listRows = await pool.query<{ data: unknown }>(
          `SELECT data FROM user_lists WHERE user_id = $1 AND deleted_at IS NULL`,
          [row.user_id]
        );

        const cards = cardRows.rows.map((r) => r.data) as EnrichedCard[];
        const binders = binderRows.rows
          .map((r) => r.data)
          .filter((d): d is AnyRecord => asRecord(d) !== null);

        // Route the attendee's FULL binder set through materializeBinders
        // (first-match-wins by position across ALL binders), THEN filter to
        // tradeable — never pre-filter the binder array. A card the owner's
        // real, higher-priority non-tradeable binder would actually claim
        // must not leak into the trade board just because a lower-priority
        // tradeable binder's rules would also match it. Mirrors
        // shares/projections.ts:projectBinder's identical documented hazard
        // for the analogous "materialize one specific binder" case.
        let tradeableCards: TonightTradeCard[] = [];
        try {
          const { binders: materialized } = materializeBinders(
            cards,
            binders as unknown as BinderDef[],
            { search: '' }
          );
          const tradeableBinders = materialized.filter((b) => asRecord(b.def)?.tradeable === true);
          const seen = new Set<string>();
          for (const b of tradeableBinders) {
            for (const section of b.sections) {
              for (const raw of section.cards) {
                const card = toTradeableCard(raw);
                if (card && !seen.has(card.oracleId)) {
                  seen.add(card.oracleId);
                  tradeableCards.push(card);
                }
              }
            }
          }
        } catch {
          // Malformed binder/card JSONB for this attendee — treat as no
          // tradeable cards rather than 500ing the whole board for the caller.
          tradeableCards = [];
        }

        // Tracking lists catalogue owned cards, not wants — same gate as
        // frontend's isTrackingList (lib/lists.ts).
        // ponytail: duplicated one-line predicate (list.kind !== 'tracking');
        // if this logic ever grows past one line, promote it to a tiny
        // shared package. Backend and frontend are separate dependency trees
        // with no shared package for this one-line check today.
        const lists = listRows.rows
          .map((r) => r.data)
          .filter((d): d is AnyRecord => asRecord(d) !== null)
          .filter((l) => l.kind !== 'tracking');

        return {
          userId: row.user_id,
          username: row.username,
          displayName: row.display_name,
          lists,
          tradeableCards,
        };
      })
    );

    // username is safe here: every viewer of this endpoint is themselves an
    // opted-in accountholder on this night (symmetric trust), unlike the
    // public game-result projection.
    res.json({ attendees });
  }
);
