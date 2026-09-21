import { createGameState, makePlayer, type GameState } from '@/lib/game-state';
import type { GameRequest, GameSignal } from '@/lib/games-api';
import { usePlayStore } from '@/store/play';
import { logger } from '@/lib/logger';

/**
 * A fake online table, for looking at the board's table-only surfaces without
 * a pod.
 *
 * The opponent rail, the hold banner, the takeback prompts and the incoming
 * signals only ever render when this device holds a seat at a live game, which
 * means four people, four devices and a real server. That cost is why five of
 * those overlays reached production painted underneath the board (#2056,
 * #2058) with nobody noticing: the only way to see one was to hold a game
 * night.
 *
 * Nothing here touches a component. Every one of those surfaces is driven by
 * play-store state, so seating you at a fake table is a store write:
 *
 *  - `online`          the table itself, built by game-core's own
 *                      `createGameState`, so the fake is the same shape the
 *                      server would have sent
 *  - `onlineRequests`  holds (`kind: 'hold'`) and takebacks (`kind: 'rewind'`)
 *  - `onlineSignal`    an incoming reaction
 *
 * DEV ONLY. Every call is behind `import.meta.env.DEV`, so the whole module
 * drops out of a production build.
 *
 * Usage, on any playtest URL:
 *
 *   /decks/<id>/playtest?table=4
 *   /decks/<id>/playtest?table=4&takeback=1
 *   /decks/<id>/playtest?table=3&hold=1&signal=1
 *
 * `table=N` seats you plus N-1 opponents. The seat link matches on YOUR user
 * id and the deck being played, so this only seats you while signed in; signed
 * out you get a table you can see but are not part of, which is itself a
 * useful state to look at.
 */

/** Names for the fake seats, so the rail is readable rather than "Seat 2". */
const OPPONENT_NAMES = ['Maya', 'Devon', 'Priya', 'Sam', 'Iris'];

export interface DevTableOptions {
  /** Seats at the table, including yours. Clamped to 2–6. */
  seats: number;
  /** Your user id — the seat link matches on it. */
  userId: string | null;
  /** The deck this board is playing; the seat link matches on it too. */
  deckId: string;
  deckName: string | null;
  commander: string | null;
  /** Mount the hold banner with a live hold from another seat. */
  hold: boolean;
  /** Mount the takeback prompt: a request from another seat awaiting you. */
  takeback: boolean;
  /** Fire an incoming reaction, for TableSignals. */
  signal: boolean;
}

/** Reads the dev-table options off a query string, or null if not asked for. */
export function parseDevTable(
  search: string
): Pick<DevTableOptions, 'seats' | 'hold' | 'takeback' | 'signal'> | null {
  const params = new URLSearchParams(search);
  const raw = params.get('table');
  if (raw == null) return null;
  const seats = Number.parseInt(raw, 10);
  return {
    seats: Number.isFinite(seats) ? Math.min(6, Math.max(2, seats)) : 4,
    hold: params.get('hold') === '1',
    takeback: params.get('takeback') === '1',
    signal: params.get('signal') === '1',
  };
}

function request(
  kind: GameRequest['kind'],
  requesterSeat: number,
  summary: string,
  steps?: number
): GameRequest {
  const now = Date.now();
  return {
    id: `dev-${kind}-${requesterSeat}`,
    code: 'DEV1',
    kind,
    payload: steps == null ? { summary } : { steps, summary },
    requesterSeat,
    approvals: {},
    status: 'pending',
    // Far enough out that the banner does not expire while being looked at.
    createdAt: now,
    expiresAt: now + 10 * 60 * 1000,
  };
}

/** Seats this device at a fake table and mounts whichever surfaces were asked for. */
export function seedDevTable(opts: DevTableOptions): GameState {
  const seats = Math.min(6, Math.max(2, opts.seats));
  const players = Array.from({ length: seats }, (_, seat) =>
    makePlayer({
      id: seat === 0 ? 'dev-me' : `dev-opp-${seat}`,
      // Only seat 0 is you; the rest must not carry your id or the seat link
      // would find the wrong one.
      userId: seat === 0 ? opts.userId : `dev-opp-${seat}`,
      seat,
      name: seat === 0 ? 'You' : (OPPONENT_NAMES[seat - 1] ?? `Seat ${seat + 1}`),
      // Your seat has to name the deck this board is playing, or the seat
      // link refuses it and you get a table you are not seated at.
      deckId: seat === 0 ? opts.deckId : `dev-deck-${seat}`,
      deckName: seat === 0 ? opts.deckName : 'Their deck',
      commander: seat === 0 ? opts.commander : null,
      startingLife: 40,
      isHost: seat === 0,
    })
  );

  const online = createGameState({
    id: 'dev-table',
    code: 'DEV1',
    mode: 'online',
    hostUserId: opts.userId,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players,
    ts: Date.now(),
  });

  const onlineRequests: Record<number, GameRequest> = {};
  if (opts.hold) onlineRequests[1] = request('hold', 1, 'Holding. Anyone respond?');
  if (opts.takeback) {
    onlineRequests[2 % seats] = request('rewind', 2 % seats, 'Take back the last two actions', 2);
  }
  const onlineSignal: { seq: number; signal: GameSignal } | null = opts.signal
    ? { seq: 1, signal: { kind: 'reaction', seat: 1, ts: Date.now(), emote: '👍' } }
    : null;

  usePlayStore.setState({
    online,
    onlineRequests,
    onlineSignal,
    onlineBoards: {},
    onlineArrows: [],
    onlineTicker: [],
    boardVisible: true,
  });

  logger.info(
    `[dev-table] seated at a fake ${seats}-player table` +
      (opts.userId ? '' : ' (signed out, so you hold no seat)')
  );
  return online;
}
