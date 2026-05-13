import { describe, it, expect, beforeEach } from 'vitest';
import { aggregateDeckRecords, usePlayStore } from './play';
import type { GameRecord } from '../lib/game-state';

function resetStore() {
  usePlayStore.setState({
    local: null,
    online: null,
    history: [],
    onlineError: null,
    onlinePolling: false,
    hydrated: true,
  });
}

describe('usePlayStore — local game flow', () => {
  beforeEach(() => resetStore());

  it('starts a local game with the given setup', () => {
    usePlayStore.getState().startLocal({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
      players: [
        { name: 'Alice', deckId: null, deckName: null, commander: null },
        { name: 'Bob', deckId: 'd1', deckName: 'Bob deck', commander: 'X' },
      ],
    });
    const local = usePlayStore.getState().local!;
    expect(local).not.toBeNull();
    expect(local.status).toBe('active');
    expect(local.players).toHaveLength(2);
    expect(local.players[1].deckId).toBe('d1');
  });

  it('dispatches life delta and updates state', () => {
    const s = usePlayStore.getState();
    s.startLocal({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: false,
      poisonEnabled: false,
      players: [
        { name: 'A', deckId: null, deckName: null, commander: null },
        { name: 'B', deckId: null, deckName: null, commander: null },
      ],
    });
    usePlayStore.getState().dispatchLocal({ type: 'life', seat: 0, delta: -5, actorSeat: 0 });
    expect(usePlayStore.getState().local!.players[0].life).toBe(35);
  });

  it('appends a record to history when a local game ends', () => {
    const s = usePlayStore.getState();
    s.startLocal({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: false,
      poisonEnabled: false,
      players: [
        { name: 'A', deckId: 'da', deckName: 'A deck', commander: null },
        { name: 'B', deckId: 'db', deckName: 'B deck', commander: null },
      ],
    });
    usePlayStore.getState().endLocal(0);
    const hist = usePlayStore.getState().history;
    expect(hist).toHaveLength(1);
    expect(hist[0].winnerSeat).toBe(0);
    expect(hist[0].players[0].deckId).toBe('da');
  });

  it('auto-eliminates and finishes via reducer', () => {
    const s = usePlayStore.getState();
    s.startLocal({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: false,
      poisonEnabled: false,
      players: [
        { name: 'A', deckId: null, deckName: null, commander: null },
        { name: 'B', deckId: null, deckName: null, commander: null },
      ],
    });
    usePlayStore.getState().dispatchLocal({ type: 'life', seat: 1, delta: -40, actorSeat: 0 });
    const local = usePlayStore.getState().local!;
    expect(local.players[1].eliminated).toBe(true);
    expect(local.status).toBe('finished');
    expect(local.winnerSeat).toBe(0);
    // recordIfFinished should have written the history entry.
    expect(usePlayStore.getState().history).toHaveLength(1);
  });
});

describe('aggregateDeckRecords', () => {
  it('counts wins/losses per deck for the given user (online)', () => {
    const records: GameRecord[] = [
      {
        id: 'g1',
        code: 'AAAA',
        format: 'commander',
        startingLife: 40,
        mode: 'online',
        startedAt: 1,
        endedAt: 2,
        durationMs: 1,
        winnerSeat: 0,
        players: [
          {
            seat: 0,
            userId: 'u1',
            name: 'me',
            deckId: 'd1',
            deckName: 'D1',
            commander: null,
            finalLife: 1,
            eliminated: false,
          },
          {
            seat: 1,
            userId: 'u2',
            name: 'them',
            deckId: 'd9',
            deckName: 'D9',
            commander: null,
            finalLife: 0,
            eliminated: true,
          },
        ],
      },
      {
        id: 'g2',
        code: 'BBBB',
        format: 'commander',
        startingLife: 40,
        mode: 'online',
        startedAt: 3,
        endedAt: 4,
        durationMs: 1,
        winnerSeat: 1,
        players: [
          {
            seat: 0,
            userId: 'u1',
            name: 'me',
            deckId: 'd1',
            deckName: 'D1',
            commander: null,
            finalLife: 0,
            eliminated: true,
          },
          {
            seat: 1,
            userId: 'u2',
            name: 'them',
            deckId: 'd9',
            deckName: 'D9',
            commander: null,
            finalLife: 5,
            eliminated: false,
          },
        ],
      },
    ];
    const rows = aggregateDeckRecords(records, 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].deckId).toBe('d1');
    expect(rows[0].played).toBe(2);
    expect(rows[0].wins).toBe(1);
    expect(rows[0].losses).toBe(1);
    expect(rows[0].winRate).toBe(0.5);
  });

  it('attributes local games by deck (not user)', () => {
    const records: GameRecord[] = [
      {
        id: 'g1',
        code: '',
        format: 'commander',
        startingLife: 40,
        mode: 'local',
        startedAt: 1,
        endedAt: 2,
        durationMs: 1,
        winnerSeat: 0,
        players: [
          {
            seat: 0,
            userId: null,
            name: 'A',
            deckId: 'd1',
            deckName: 'D1',
            commander: null,
            finalLife: 5,
            eliminated: false,
          },
          {
            seat: 1,
            userId: null,
            name: 'B',
            deckId: 'd2',
            deckName: 'D2',
            commander: null,
            finalLife: 0,
            eliminated: true,
          },
        ],
      },
    ];
    const rows = aggregateDeckRecords(records, 'someone');
    expect(rows.map((r) => r.deckId).sort()).toEqual(['d1', 'd2']);
  });
});
