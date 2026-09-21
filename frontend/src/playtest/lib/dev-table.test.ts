import { describe, expect, it, beforeEach } from 'vitest';
import { parseDevTable, seedDevTable } from './dev-table';
import { usePlayStore } from '@/store/play';

describe('parseDevTable', () => {
  it('asks for nothing when the URL does not', () => {
    expect(parseDevTable('')).toBe(null);
    expect(parseDevTable('?foo=1')).toBe(null);
  });

  it('reads the seat count and the surfaces to mount', () => {
    expect(parseDevTable('?table=3&hold=1&takeback=1&signal=1')).toEqual({
      seats: 3,
      hold: true,
      takeback: true,
      signal: true,
    });
  });

  it('defaults to a pod and mounts nothing extra', () => {
    expect(parseDevTable('?table=x')).toEqual({
      seats: 4,
      hold: false,
      takeback: false,
      signal: false,
    });
  });

  it('clamps to a table that can actually exist', () => {
    expect(parseDevTable('?table=99')?.seats).toBe(6);
    expect(parseDevTable('?table=1')?.seats).toBe(2);
  });
});

describe('seedDevTable', () => {
  const opts = {
    seats: 4,
    userId: 'me',
    deckId: 'deck-1',
    deckName: 'My deck',
    commander: 'Atraxa',
    hold: false,
    takeback: false,
    signal: false,
  };

  beforeEach(() => {
    usePlayStore.setState({ online: null, onlineRequests: {}, onlineSignal: null });
  });

  it('seats you at seat 0 with the deck the board is playing', () => {
    // Both halves matter: the seat link matches on the user id AND the deck,
    // and a seat missing either is a table you are not part of.
    const game = seedDevTable(opts);
    expect(game.players).toHaveLength(4);
    expect(game.players[0].userId).toBe('me');
    expect(game.players[0].deckId).toBe('deck-1');
  });

  it('gives the opponents ids of their own, so they cannot be mistaken for you', () => {
    const game = seedDevTable(opts);
    const mine = game.players.filter((p) => p.userId === 'me');
    expect(mine).toHaveLength(1);
  });

  it('puts the table in the store, where every table surface reads it', () => {
    seedDevTable(opts);
    expect(usePlayStore.getState().online?.code).toBe('DEV1');
  });

  it('mounts a hold when asked, and not otherwise', () => {
    seedDevTable(opts);
    expect(Object.values(usePlayStore.getState().onlineRequests)).toEqual([]);
    seedDevTable({ ...opts, hold: true });
    const holds = Object.values(usePlayStore.getState().onlineRequests);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ kind: 'hold', status: 'pending' });
  });

  it('mounts a takeback request from a seat that is not yours', () => {
    seedDevTable({ ...opts, takeback: true });
    const reqs = Object.values(usePlayStore.getState().onlineRequests);
    expect(reqs[0]).toMatchObject({ kind: 'rewind', status: 'pending' });
    expect(reqs[0].requesterSeat).not.toBe(0);
  });

  it('fires an incoming signal when asked', () => {
    seedDevTable({ ...opts, signal: true });
    expect(usePlayStore.getState().onlineSignal?.signal.kind).toBe('reaction');
  });

  it('leaves a request live long enough to be looked at', () => {
    seedDevTable({ ...opts, hold: true });
    const [hold] = Object.values(usePlayStore.getState().onlineRequests);
    expect(hold.expiresAt - Date.now()).toBeGreaterThan(60_000);
  });
});
