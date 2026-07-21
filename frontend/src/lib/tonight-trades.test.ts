import { describe, it, expect } from 'vitest';
import { buildTonightTrades } from './tonight-trades';
import type { TonightTradeAttendee } from './game-nights-api';
import type { FriendCard } from './cube/pool';
import type { ListDef, ListEntry } from '../types';

function friendCard(overrides: Partial<FriendCard> & { name: string }): FriendCard {
  return { oracleId: '', colors: [], cmc: 0, typeLine: 'Artifact', ...overrides };
}

let entryCounter = 0;
function entry(overrides: Partial<ListEntry> & { name: string }): ListEntry {
  return {
    id: `e${entryCounter++}`,
    scryfallId: 'sf',
    setCode: 'tst',
    collectorNumber: '1',
    finish: 'nonfoil',
    quantity: 1,
    ...overrides,
  };
}

function wantList(name: string, entries: ListEntry[]): ListDef {
  return { id: `list-${name}`, name, entries, order: 0, createdAt: 0, updatedAt: 0 };
}

function attendee(
  overrides: Partial<TonightTradeAttendee> & { userId: string }
): TonightTradeAttendee {
  return {
    username: overrides.userId,
    displayName: overrides.userId,
    lists: [],
    tradeableCards: [],
    ...overrides,
  };
}

describe('buildTonightTrades', () => {
  it('aggregates incoming from every other attendee, tagged with the supplying username', () => {
    const me = attendee({
      userId: 'me',
      lists: [wantList('Wants', [entry({ name: 'Sol Ring', oracleId: 'o-sol' })])],
    });
    const a = attendee({
      userId: 'a',
      username: 'alice',
      tradeableCards: [friendCard({ name: 'Sol Ring', oracleId: 'o-sol' })],
    });
    const b = attendee({ userId: 'b', username: 'bob' }); // no tradeableCards

    const { incoming } = buildTonightTrades('me', [me, a, b]);
    expect(incoming).toHaveLength(1);
    expect(incoming[0]).toMatchObject({ name: 'Sol Ring', supplierUsername: 'alice' });
  });

  it('an attendee with no tradeableCards contributes nothing to incoming but can still appear in outgoing', () => {
    const me = attendee({
      userId: 'me',
      tradeableCards: [friendCard({ name: 'Lightning Bolt', oracleId: 'o-bolt' })],
    });
    const a = attendee({ userId: 'a', username: 'alice' }); // no tradeableCards, no lists
    const b = attendee({
      userId: 'b',
      username: 'bob',
      lists: [wantList('Wants', [entry({ name: 'Lightning Bolt', oracleId: 'o-bolt' })])],
    });

    const { incoming, outgoing } = buildTonightTrades('me', [me, a, b]);
    expect(incoming).toEqual([]);
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]).toMatchObject({ name: 'Lightning Bolt', wanterUsername: 'bob' });
  });

  it('outgoing aggregates what each other attendee wants from my tradeable cards, tagged per wanter', () => {
    const me = attendee({
      userId: 'me',
      tradeableCards: [friendCard({ name: 'Lightning Bolt', oracleId: 'o-bolt' })],
    });
    const a = attendee({
      userId: 'a',
      username: 'alice',
      lists: [wantList('Wants', [entry({ name: 'Lightning Bolt', oracleId: 'o-bolt' })])],
    });
    const b = attendee({
      userId: 'b',
      username: 'bob',
      lists: [
        wantList('Wants', [entry({ name: 'Lightning Bolt', oracleId: 'o-bolt', quantity: 2 })]),
      ],
    });

    const { outgoing } = buildTonightTrades('me', [me, a, b]);
    const byWanter = outgoing.map((m) => m.wanterUsername).sort();
    expect(byWanter).toEqual(['alice', 'bob']);
  });

  it('a single-attendee input (just me) returns empty incoming/outgoing — no self-matching', () => {
    const me = attendee({
      userId: 'me',
      lists: [wantList('Wants', [entry({ name: 'Sol Ring', oracleId: 'o-sol' })])],
      tradeableCards: [friendCard({ name: 'Sol Ring', oracleId: 'o-sol' })],
    });
    expect(buildTonightTrades('me', [me])).toEqual({ incoming: [], outgoing: [] });
  });
});
