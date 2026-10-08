import { getPool } from '../db';
import { scrubText } from './events';

/**
 * Revealed-preference labels for suggestions (E518), carried by the first-party
 * beacon (`{ name: 'suggestion', ... }`, see events.ts). The same contract as
 * every other beacon row: an aggregate counter keyed by a day and a few
 * low-cardinality strings. A row names a commander, the card(s) a suggestion
 * moved, the surface it appeared on, and what the player did with it; it never
 * names a person, a deck, or a session, and the route reads no cookie for it.
 * Nothing here can be joined back to an account, so the table has no id column
 * and `parseSuggestion` drops any event that carries a field it does not know.
 */
export const SUGGESTION_SURFACES = new Set([
  'coach:all',
  'coach:fill-gaps',
  'coach:upgrade',
  'coach:budget',
  'coach:collection',
  'coach:decks',
  'coach:bracket-fit',
  'coach:combos',
  'coach:lands',
  'coach:cuts',
  'coach:plan',
  'swap',
  'cube-swap',
  'similar',
  'hidden-gems',
  'add-suggestions',
  'add-combos',
  'generation',
]);

export const SUGGESTION_ACTIONS = new Set(['shown', 'accept', 'dismiss', 'undo']);

/** Every key an event may carry. Anything else drops the whole event. */
const ALLOWED_KEYS = new Set([
  'name',
  'path',
  'surface',
  'action',
  'rank',
  'reason',
  'cmdr',
  'cmdrName',
  'partner',
  'cardIn',
  'cardOut',
  'n',
]);

const ORACLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON = /^[a-z][a-z-]{0,23}$/;
const NAME_MAX = 100;
/** Distinct label rows a single day may hold; the rest are dropped. */
export const SUGGESTION_ROWS_PER_DAY = 5000;

export interface SuggestionLabel {
  surface: string;
  action: string;
  rank: number;
  reason: string;
  commander: string;
  commanderName: string;
  partner: string;
  cardIn: string;
  cardOut: string;
  /** Rows this event stands for: the impression count on `shown`, 1 otherwise. */
  count: number;
}

function text(v: unknown): string {
  return typeof v === 'string' ? scrubText(v, NAME_MAX) : '';
}

/** The validated label, or null when the event is malformed or carries an extra field. */
export function parseSuggestion(body: Record<string, unknown>): SuggestionLabel | null {
  if (Object.keys(body).some((k) => !ALLOWED_KEYS.has(k))) return null;
  const surface = typeof body.surface === 'string' ? body.surface : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!SUGGESTION_SURFACES.has(surface) || !SUGGESTION_ACTIONS.has(action)) return null;
  // A cube has no commander, so its label carries neither field; every other surface is keyed on one.
  const cubeLabel = surface === 'cube-swap';
  const commander = typeof body.cmdr === 'string' ? body.cmdr.toLowerCase() : '';
  if (
    cubeLabel ? body.cmdr !== undefined || body.partner !== undefined : !ORACLE_ID.test(commander)
  )
    return null;
  const partner = typeof body.partner === 'string' ? body.partner.toLowerCase() : '';
  if (partner && !ORACLE_ID.test(partner)) return null;
  const rank = body.rank === undefined ? 0 : body.rank;
  if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 0 || rank > 99) return null;
  const reason = body.reason === undefined ? '' : body.reason;
  if (typeof reason !== 'string' || (reason !== '' && !REASON.test(reason))) return null;
  const cardIn = text(body.cardIn);
  const cardOut = text(body.cardOut);
  let count = 1;
  if (action === 'shown') {
    // An impression count for a lane, never a card.
    if (cardIn || cardOut) return null;
    const n = body.n;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 200) return null;
    count = n;
  } else if (!cardIn && !cardOut) {
    return null;
  }
  return {
    surface,
    action,
    rank,
    reason,
    commander,
    commanderName: text(body.cmdrName),
    partner,
    cardIn,
    cardOut,
    count,
  };
}

export async function countSuggestion(label: SuggestionLabel): Promise<void> {
  const pool = getPool();
  const key = [
    label.surface,
    label.action,
    label.reason,
    label.rank,
    label.commander,
    label.partner,
    label.cardIn,
    label.cardOut,
  ];
  const existing = await pool.query(
    `SELECT 1 FROM suggestion_counts
      WHERE day = CURRENT_DATE AND surface = $1 AND action = $2 AND reason = $3 AND rank = $4
        AND commander = $5 AND partner = $6 AND card_in = $7 AND card_out = $8`,
    key
  );
  if (existing.rowCount === 0) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM suggestion_counts WHERE day = CURRENT_DATE`
    );
    if (Number(rows[0]?.n ?? 0) >= SUGGESTION_ROWS_PER_DAY) return;
  }
  await pool.query(
    `INSERT INTO suggestion_counts
       (day, surface, action, reason, rank, commander, partner, card_in, card_out, commander_name, count)
       VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (day, surface, action, reason, rank, commander, partner, card_in, card_out)
       DO UPDATE SET count = suggestion_counts.count + $10`,
    [...key, label.commanderName, label.count]
  );
}
