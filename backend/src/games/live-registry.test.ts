import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addSubscriber,
  broadcastGameDeleted,
  lastSeenAt,
  removeSubscriber,
  touchPresence,
  type Subscriber,
} from './live-registry';

vi.mock('./discord-tables', () => ({ releaseDiscordTable: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  broadcastGameDeleted('SEEN');
});

describe('lastSeenAt', () => {
  it('is null for a game this process has never seen', () => {
    expect(lastSeenAt('SEEN')).toBe(null);
  });

  it('is now while anyone is connected', () => {
    const sub = { userId: 'u1', onState: vi.fn(), onDeleted: vi.fn() } as unknown as Subscriber;
    addSubscriber('SEEN', sub);
    expect(lastSeenAt('SEEN', 5_000)).toBe(5_000);
    removeSubscriber('SEEN', sub);
  });

  it('is the latest time anyone was seen once nobody is connected', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    touchPresence('SEEN', 'u1');
    vi.setSystemTime(3_000);
    touchPresence('SEEN', 'u2');
    vi.setSystemTime(9_000);
    expect(lastSeenAt('SEEN')).toBe(3_000);
  });

  it('forgets a game once it is deleted', () => {
    touchPresence('SEEN', 'u1');
    broadcastGameDeleted('SEEN');
    expect(lastSeenAt('SEEN')).toBe(null);
  });
});
