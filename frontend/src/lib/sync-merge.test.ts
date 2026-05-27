import { describe, it, expect } from 'vitest';
import { mergeSnapshots, countLocal, countServer, type LocalSnapshot } from './sync-merge';
import type { SyncSnapshot } from './auth-api';
import type { StoredCollection } from './local-cards';
import type { EnrichedCard, BinderDef, ListDef } from '../types';
import type { Deck } from '../store/decks';
import type { GameRecord } from './game-state';

function card(copyId: string, extra: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId,
    name: 'Test',
    oracleId: 'o-' + copyId,
    setCode: 'tst',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'sf-' + copyId,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'manabox',
    finish: 'nonfoil',
    foil: false,
    ...extra,
  };
}

function collection(cards: EnrichedCard[], lists: ListDef[] = []): StoredCollection {
  return {
    fileName: 'test.csv',
    cards,
    scryfallHits: cards.length,
    scryfallMisses: 0,
    uploadedAt: 100,
    importHistory: [
      { id: 'i1', name: 'test.csv', count: cards.length, format: 'manabox', addedAt: 100 },
    ],
    lists,
  };
}

function binder(id: string, name = id): BinderDef {
  return { id, name, createdAt: 1, updatedAt: 1, position: 0 } as never;
}

function deck(id: string, name = id): Deck {
  return { id, name, createdAt: 1, updatedAt: 1 } as never;
}

function game(id: string): GameRecord {
  return { id } as never;
}

function snap(opts: Partial<SyncSnapshot> = {}): SyncSnapshot {
  return {
    collection: null,
    binders: [],
    decks: [],
    games: [],
    version: 3,
    updatedAt: 0,
    ...opts,
  };
}

function localSnap(opts: Partial<LocalSnapshot> = {}): LocalSnapshot {
  return {
    collection: null,
    binders: [],
    decks: [],
    games: [],
    ...opts,
  };
}

describe('mergeSnapshots', () => {
  it('returns server data when local is empty', () => {
    const server = snap({
      collection: collection([card('s1'), card('s2')]),
      binders: [binder('sb1')],
      decks: [deck('sd1')],
      version: 7,
    });
    const merged = mergeSnapshots(localSnap(), server);
    expect(merged.collection?.cards.map((c) => c.copyId)).toEqual(['s1', 's2']);
    expect(merged.binders.map((b) => b.id)).toEqual(['sb1']);
    expect(merged.decks.map((d) => d.id)).toEqual(['sd1']);
    expect(merged.version).toBe(7);
  });

  it('returns local data when server is empty', () => {
    const local = localSnap({
      collection: collection([card('l1')]),
      binders: [binder('lb1')],
    });
    const merged = mergeSnapshots(local, snap());
    expect(merged.collection?.cards.map((c) => c.copyId)).toEqual(['l1']);
    expect(merged.binders.map((b) => b.id)).toEqual(['lb1']);
  });

  it('unions cards by copyId — both sides preserved, no copies lost', () => {
    const local = localSnap({ collection: collection([card('l1'), card('l2')]) });
    const server = snap({ collection: collection([card('s1'), card('s2')]) });
    const merged = mergeSnapshots(local, server);
    expect(merged.collection?.cards.map((c) => c.copyId).sort()).toEqual(['l1', 'l2', 's1', 's2']);
  });

  it('prefers local on copyId collision', () => {
    const local = localSnap({
      collection: collection([card('shared', { name: 'Local Name' })]),
    });
    const server = snap({
      collection: collection([card('shared', { name: 'Server Name' })]),
    });
    const merged = mergeSnapshots(local, server);
    expect(merged.collection?.cards).toHaveLength(1);
    expect(merged.collection?.cards[0]?.name).toBe('Local Name');
  });

  it('unions binders by id, prefers local on collision', () => {
    const local = localSnap({
      binders: [binder('shared', 'Local Binder'), binder('l-only', 'Local Only')],
    });
    const server = snap({
      binders: [binder('shared', 'Server Binder'), binder('s-only', 'Server Only')],
    });
    const merged = mergeSnapshots(local, server);
    expect(merged.binders).toHaveLength(3);
    expect(merged.binders.find((b) => b.id === 'shared')?.name).toBe('Local Binder');
    expect(merged.binders.find((b) => b.id === 'l-only')).toBeTruthy();
    expect(merged.binders.find((b) => b.id === 's-only')).toBeTruthy();
  });

  it('unions decks, games, and lists by id', () => {
    const local = localSnap({
      collection: collection([], [{ id: 'list-l' } as never]),
      decks: [deck('d-l')],
      games: [game('g-l')],
    });
    const server = snap({
      collection: collection([], [{ id: 'list-s' } as never]),
      decks: [deck('d-s')],
      games: [game('g-s')],
    });
    const merged = mergeSnapshots(local, server);
    expect(merged.collection?.lists.map((l) => l.id).sort()).toEqual(['list-l', 'list-s']);
    expect(merged.decks.map((d) => d.id).sort()).toEqual(['d-l', 'd-s']);
    expect(merged.games.map((g) => g.id).sort()).toEqual(['g-l', 'g-s']);
  });

  it('carries server version and updatedAt onto the merged snapshot', () => {
    const merged = mergeSnapshots(
      localSnap({ collection: collection([card('l1')]) }),
      snap({ collection: collection([card('s1')]), version: 42, updatedAt: 9999 })
    );
    expect(merged.version).toBe(42);
    expect(merged.updatedAt).toBe(9999);
  });

  it('does not mutate inputs', () => {
    const local = localSnap({
      collection: collection([card('l1')]),
      binders: [binder('lb')],
    });
    const server = snap({
      collection: collection([card('s1')]),
      binders: [binder('sb')],
    });
    const localBindersBefore = local.binders.slice();
    const serverBindersBefore = (server.binders as BinderDef[]).slice();
    mergeSnapshots(local, server);
    expect(local.binders).toEqual(localBindersBefore);
    expect(server.binders).toEqual(serverBindersBefore);
  });

  it('de-dupes import history by id when merging collections', () => {
    const local = localSnap({
      collection: {
        ...collection([card('l1')]),
        importHistory: [
          { id: 'shared-import', name: 'a', count: 1, format: 'manabox', addedAt: 1 },
          { id: 'local-only', name: 'b', count: 1, format: 'manabox', addedAt: 2 },
        ],
      },
    });
    const server = snap({
      collection: {
        ...collection([card('s1')]),
        importHistory: [
          { id: 'shared-import', name: 'a', count: 1, format: 'manabox', addedAt: 1 },
          { id: 'server-only', name: 'c', count: 1, format: 'manabox', addedAt: 3 },
        ],
      },
    });
    const merged = mergeSnapshots(local, server);
    const ids = merged.collection?.importHistory.map((h) => h.id);
    expect(ids).toHaveLength(3);
    expect(ids).toContain('shared-import');
    expect(ids).toContain('local-only');
    expect(ids).toContain('server-only');
  });
});

describe('countLocal / countServer', () => {
  it('counts each slice independently', () => {
    const local = localSnap({
      collection: collection([card('a'), card('b')], [{ id: 'l1' } as never]),
      binders: [binder('b1'), binder('b2')],
      decks: [deck('d1')],
      games: [game('g1'), game('g2'), game('g3')],
    });
    expect(countLocal(local)).toEqual({
      cards: 2,
      binders: 2,
      decks: 1,
      lists: 1,
      games: 3,
    });
  });

  it('returns zeros for empty snapshots', () => {
    expect(countLocal(localSnap())).toEqual({
      cards: 0,
      binders: 0,
      decks: 0,
      lists: 0,
      games: 0,
    });
    expect(countServer(snap())).toEqual({
      cards: 0,
      binders: 0,
      decks: 0,
      lists: 0,
      games: 0,
    });
  });

  it('tolerates malformed server snapshots with non-array slices', () => {
    // SyncSnapshot types binders/decks/games as `unknown[]`; defensively
    // an older or corrupted snapshot might arrive without these arrays.
    const broken = {
      collection: null,
      binders: undefined as unknown as unknown[],
      decks: undefined as unknown as unknown[],
      games: undefined as unknown as unknown[],
      version: 1,
      updatedAt: 0,
    };
    expect(countServer(broken)).toEqual({
      cards: 0,
      binders: 0,
      decks: 0,
      lists: 0,
      games: 0,
    });
    const merged = mergeSnapshots(localSnap({ binders: [binder('a')] }), broken);
    expect(merged.binders.map((b) => b.id)).toEqual(['a']);
  });
});
