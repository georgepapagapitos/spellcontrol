import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayStore } from './play';
import { applyAction, createGameState, makePlayer, type GameState } from '../lib/game-state';
import { createGame, sendGameSignal, type GameSignal } from '../lib/games-api';

/**
 * Arrows on the table: an `arrow` signal adds one everyone keeps, `clear`
 * drops every arrow its author drew, the list is bounded, and leaving the
 * table drops them all. Driven through `sendSignal`, the same path a live
 * table uses (the server's echo is what the store adopts).
 */

vi.mock('../lib/games-api', () => ({
  createGame: vi.fn(),
  getGame: vi.fn(),
  pollGame: vi.fn(),
  joinGame: vi.fn(),
  patchGame: vi.fn(),
  leaveGame: vi.fn(async () => ({ deleted: true })),
  raiseGameRequest: vi.fn(),
  respondGameRequest: vi.fn(),
  cancelGameRequest: vi.fn(),
  sendGameSignal: vi.fn(),
}));
vi.mock('../lib/games-sse', () => ({ subscribeGameEvents: vi.fn(() => () => {}) }));
vi.mock('../lib/games-longpoll', () => ({
  subscribeGameLongPoll: vi.fn(() => () => {}),
  usesLongPoll: vi.fn(() => false),
}));

const mockCreate = vi.mocked(createGame);
const mockSend = vi.mocked(sendGameSignal);

function onlineGame(): GameState {
  const g = createGameState({
    id: 'game_online',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'u1',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: [
      makePlayer({ id: 'p0', userId: 'u1', seat: 0, name: 'Host', startingLife: 40, isHost: true }),
      makePlayer({ id: 'p1', userId: 'u2', seat: 1, name: 'Guest', startingLife: 40 }),
      makePlayer({ id: 'p2', userId: 'u3', seat: 2, name: 'Third', startingLife: 40 }),
    ],
  });
  return { ...applyAction(g, { type: 'start' }), version: 1 };
}

function arrow(seat: number, ts: number, extra: Partial<GameSignal> = {}): GameSignal {
  return { kind: 'arrow', seat, ts, op: 'add', fromSeat: seat, toSeat: 1, ...extra };
}

/** Echo `signal` from the server for the next sendSignal, and send it. */
async function send(signal: GameSignal) {
  mockSend.mockResolvedValueOnce(signal);
  await usePlayStore
    .getState()
    .sendSignal(
      signal.op === 'clear'
        ? { kind: 'arrow', op: 'clear' }
        : { kind: 'arrow', op: 'add', fromSeat: signal.fromSeat!, toSeat: signal.toSeat! }
    );
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue(onlineGame());
  await usePlayStore.getState().hostOnline({
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
  });
});

afterEach(() => {
  usePlayStore.getState().clearOnline();
});

describe('arrow signals', () => {
  it('adds one arrow per signal, keyed by its identity, and clears by author', async () => {
    await send(arrow(0, 1, { fromCardId: 'a', toCardId: 'b' }));
    await send(arrow(2, 2));
    expect(usePlayStore.getState().onlineArrows).toEqual([
      { id: '0:1', seat: 0, fromSeat: 0, fromCardId: 'a', toSeat: 1, toCardId: 'b' },
      { id: '2:2', seat: 2, fromSeat: 2, toSeat: 1 },
    ]);

    // The same frame delivered twice (echo + transport) is one arrow.
    await send(arrow(2, 2));
    expect(usePlayStore.getState().onlineArrows).toHaveLength(2);

    await send({ kind: 'arrow', seat: 0, ts: 3, op: 'clear' });
    expect(usePlayStore.getState().onlineArrows.map((a) => a.id)).toEqual(['2:2']);
    expect(mockSend).toHaveBeenLastCalledWith('ABCD', { kind: 'arrow', op: 'clear' });
  });

  it('keeps at most the newest 24 arrows', async () => {
    for (let i = 1; i <= 30; i++) await send(arrow(0, i));
    const ids = usePlayStore.getState().onlineArrows.map((a) => a.id);
    expect(ids).toHaveLength(24);
    expect(ids[0]).toBe('0:7');
    expect(ids[23]).toBe('0:30');
  });

  it('leaving the table drops every arrow', async () => {
    await send(arrow(0, 1));
    expect(usePlayStore.getState().onlineArrows).toHaveLength(1);
    await usePlayStore.getState().leaveOnline();
    expect(usePlayStore.getState().onlineArrows).toEqual([]);
  });
});
