import { getPool } from '../db';
import { asRecord, asString } from '../shares/projections';
import { signatureMissesCombos } from '../shares/bracket-floor';

/**
 * Rule 0 notes: what a pod's members chose to put on the table before a game.
 *
 * Two gates, both enforced per request and never cached:
 *  1. the owner opted the deck into THIS pod (`pod_decks`), and is still a
 *     `member` of it;
 *  2. the deck is already visible to the VIEWER by the existing ladder: a live
 *     publication, a live friends share and the viewer is an accepted friend of
 *     the owner, or a live direct share addressed to the viewer. An opt-in never
 *     widens who can see a deck. The owner always sees their own rows, flagged
 *     `reach: 'private'` when the pod can't see them, so the picker can say why.
 *
 * Everything returned is derived from the deck's stored bracket estimate, which
 * a viewer who may open the deck can already recompute from its list.
 */

export type Rule0Reach = 'public' | 'friends' | 'private';

export interface Rule0Signals {
  gameChangers: number;
  gameChangerNames: string[];
  massLandDenial: number;
  extraTurns: number;
  twoCardCombos: number;
  multiCardCombos: number;
}

export interface Rule0Deck {
  userId: string;
  username: string;
  deckId: string;
  name: string;
  commanderName: string | null;
  /** Stated bracket if the owner set one, else the estimate; null if never analyzed. */
  bracket: number | null;
  bracketStated: boolean;
  estimatedBracket: number | null;
  /** The estimate ran before combos were counted, so it is only a floor. */
  estimateIsFloor: boolean;
  signals: Rule0Signals | null;
  reach: Rule0Reach;
  mine: boolean;
}

function finite(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
}

function count(x: unknown): number {
  const n = finite(x);
  return n !== undefined && n > 0 ? Math.floor(n) : 0;
}

function names(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string').slice(0, 12) : [];
}

/** The note-relevant slice of a stored deck. Defensive: the JSONB is opaque. */
export function projectRule0Deck(
  deckData: unknown
): Pick<
  Rule0Deck,
  | 'name'
  | 'commanderName'
  | 'bracket'
  | 'bracketStated'
  | 'estimatedBracket'
  | 'estimateIsFloor'
  | 'signals'
> | null {
  const deck = asRecord(deckData);
  const name = deck ? asString(deck.name) : undefined;
  if (!deck || !name) return null;
  const estimation = asRecord(deck.bracketEstimation);
  const estimated = finite(estimation?.bracket) ?? null;
  const stated = finite(deck.bracketOverride);
  const b = asRecord(estimation?.breakdown);
  return {
    name: name.slice(0, 80),
    commanderName: asString(asRecord(deck.commander)?.name) ?? null,
    bracket: stated ?? estimated,
    bracketStated: stated !== undefined,
    estimatedBracket: estimated,
    estimateIsFloor: estimated !== null && signatureMissesCombos(deck.gradeBracketSignature),
    signals: b
      ? {
          gameChangers: count(b.gameChangerCount),
          gameChangerNames: names(b.gameChangerNames),
          massLandDenial: count(b.massLandDenialCount),
          extraTurns: count(b.extraTurnCount),
          twoCardCombos: count(b.twoCardComboCount),
          multiCardCombos: count(b.multiCardComboCount),
        }
      : null,
  };
}

/** Is `userId` a current (accepted) member of the pod? */
export async function isActivePodMember(podId: string, userId: string): Promise<boolean> {
  const r = await getPool().query(
    `SELECT 1 FROM pod_members WHERE pod_id = $1 AND user_id = $2 AND status = 'member'`,
    [podId, userId]
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * The reach of one deck toward `viewerId`: 'public' (live publication),
 * 'friends' (a live friends share and the viewer is an accepted friend or the
 * owner, or a live share addressed to the viewer), else 'private'.
 */
export async function deckReachFor(
  ownerId: string,
  deckId: string,
  viewerId: string
): Promise<Rule0Reach> {
  const r = await getPool().query<{ reach: Rule0Reach }>(REACH_SQL_ONE, [
    ownerId,
    deckId,
    viewerId,
  ]);
  return r.rows[0]?.reach ?? 'private';
}

const REACH_EXPR = `CASE
  WHEN EXISTS (SELECT 1 FROM deck_publications dp
                WHERE dp.user_id = $OWNER AND dp.deck_id = $DECK
                  AND dp.unpublished_at IS NULL AND dp.moderated_at IS NULL) THEN 'public'
  WHEN EXISTS (SELECT 1 FROM shares s
                WHERE s.user_id = $OWNER AND s.kind = 'deck' AND s.resource_id = $DECK
                  AND s.revoked_at IS NULL
                  AND ((s.audience = 'friends' AND ($OWNER = $VIEWER OR EXISTS (
                          SELECT 1 FROM friendships f
                           WHERE f.status = 'accepted'
                             AND ((f.requester_id = $OWNER AND f.addressee_id = $VIEWER)
                               OR (f.requester_id = $VIEWER AND f.addressee_id = $OWNER)))))
                    OR (s.audience = 'direct' AND s.addressee_id = $VIEWER))) THEN 'friends'
  ELSE 'private' END`;

const REACH_SQL_ONE = `SELECT ${REACH_EXPR.replaceAll('$OWNER', '$1')
  .replaceAll('$DECK', '$2')
  .replaceAll('$VIEWER', '$3')} AS reach`;

/**
 * Every opted-in deck of the pod's current members that `viewerId` may see.
 * The caller has already checked the viewer is an active member.
 */
export async function loadRule0Decks(podId: string, viewerId: string): Promise<Rule0Deck[]> {
  const reach = REACH_EXPR.replaceAll('$OWNER', 'pd.user_id')
    .replaceAll('$DECK', 'pd.deck_id')
    .replaceAll('$VIEWER', '$2');
  const rows = await getPool().query<{
    user_id: string;
    username: string;
    deck_id: string;
    data: unknown;
    reach: Rule0Reach;
  }>(
    `SELECT pd.user_id, u.username, pd.deck_id, d.data, ${reach} AS reach
       FROM pod_decks pd
       JOIN pod_members pm ON pm.pod_id = pd.pod_id AND pm.user_id = pd.user_id
                          AND pm.status = 'member'
       JOIN users u ON u.id = pd.user_id
       JOIN user_decks d ON d.user_id = pd.user_id AND d.id = pd.deck_id
                        AND d.deleted_at IS NULL
      WHERE pd.pod_id = $1
      ORDER BY u.username ASC, pd.added_at ASC`,
    [podId, viewerId]
  );
  const out: Rule0Deck[] = [];
  for (const r of rows.rows) {
    const mine = r.user_id === viewerId;
    // The gate: someone else's deck that is private to this viewer is dropped
    // here, so it never reaches the wire.
    if (!mine && r.reach === 'private') continue;
    const p = projectRule0Deck(r.data);
    if (!p) continue;
    out.push({
      userId: r.user_id,
      username: r.username,
      deckId: r.deck_id,
      ...p,
      reach: r.reach,
      mine,
    });
  }
  return out;
}
