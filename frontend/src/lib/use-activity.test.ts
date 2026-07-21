// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { markInboxSeen } from './use-inbox';
import type {
  ActivityResponse,
  DirectShareActivityItem,
  FeedbackActivityItem,
  FriendRequestActivityItem,
  RecentActivityItem,
} from './activity-client';

let authStatus: 'guest' | 'authed' = 'authed';
vi.mock('../store/auth', () => ({
  useAuth: <T>(selector: (s: { status: string }) => T): T => selector({ status: authStatus }),
}));

const getActivityMock = vi.fn<() => Promise<ActivityResponse>>();
vi.mock('./activity-client', () => ({
  getActivity: () => getActivityMock(),
}));

import {
  useActivity,
  computeActivityCount,
  subscribeToActivityAnnouncements,
} from './use-activity';

function friendRequest(id: string): FriendRequestActivityItem {
  return {
    type: 'friend_request',
    id: `friend_request:${id}`,
    requesterId: id,
    requesterUsername: id,
    requesterDisplayName: null,
    occurredAt: Date.now(),
  };
}

function directShare(token: string, occurredAt: number): DirectShareActivityItem {
  return {
    type: 'direct_share',
    id: `direct_share:${token}`,
    token,
    kind: 'deck',
    fromUsername: 'alice',
    fromDisplayName: null,
    label: 'A Deck',
    occurredAt,
  };
}

function feedbackItem(id: string): FeedbackActivityItem {
  return {
    type: 'feedback',
    id: `feedback:${id}`,
    deckId: 'd-1',
    deckName: 'A Deck',
    authorName: 'Bob',
    comment: 'Nice deck',
    occurredAt: Date.now(),
  };
}

async function fireFocus(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
  });
}

beforeEach(() => {
  authStatus = 'authed';
  localStorage.clear();
  getActivityMock.mockReset();
});

describe('computeActivityCount', () => {
  it('composes actionRequired + unseen direct shares + every other recent item', () => {
    const actionRequired = [friendRequest('r1'), friendRequest('r2')];
    const recent: RecentActivityItem[] = [
      directShare('t1', 100),
      directShare('t2', 200),
      feedbackItem('f1'),
    ];
    // lastSeen=0 -> both direct shares are unseen.
    expect(computeActivityCount(actionRequired, recent, 0)).toBe(2 + 2 + 1);
    // lastSeen=150 -> only the newer direct share (t2@200) is unseen.
    expect(computeActivityCount(actionRequired, recent, 150)).toBe(2 + 1 + 1);
  });

  it('returns 0 for empty input', () => {
    expect(computeActivityCount([], [], 0)).toBe(0);
  });
});

describe('useActivity', () => {
  it('does not fetch when unauthenticated, and count stays 0', () => {
    authStatus = 'guest';
    const { result } = renderHook(() => useActivity());
    expect(result.current.count).toBe(0);
    expect(getActivityMock).not.toHaveBeenCalled();
  });

  it('composes count from a resolved fetch', async () => {
    getActivityMock.mockResolvedValue({
      actionRequired: [friendRequest('r1')],
      recent: [directShare('t1', Date.now())],
    });
    const { result } = renderHook(() => useActivity());
    await waitFor(() => expect(result.current.count).toBe(2));
    expect(result.current.actionRequired).toHaveLength(1);
    expect(result.current.recent).toHaveLength(1);
  });

  it('a count decrease (markInboxSeen fired elsewhere) is reflected on the next refetch, without a reload', async () => {
    const occurredAt = Date.now();
    // mockImplementation (not mockResolvedValue) so each call returns a fresh
    // object/array — matching real fetch()+res.json(), which never hands back
    // the same reference twice. A shared static value would let React bail
    // out of the second setState as a same-reference no-op, masking whether
    // the count recomputation itself is actually correct.
    getActivityMock.mockImplementation(() =>
      Promise.resolve({ actionRequired: [], recent: [directShare('t1', occurredAt)] })
    );
    const { result } = renderHook(() => useActivity());
    await waitFor(() => expect(result.current.count).toBe(1));

    // Stamps the shared last-seen key and notifies use-inbox's own listeners
    // — useActivity doesn't subscribe to that fan-out, but it re-reads the
    // same localStorage key fresh on its own next refetch (window focus),
    // the same cadence useInbox/useFriendRequests already use.
    markInboxSeen();
    await fireFocus();
    await waitFor(() => expect(result.current.count).toBe(0));
  });

  it('never announces on the initial mount, only on a later increase', async () => {
    const announced: number[] = [];
    const unsubscribe = subscribeToActivityAnnouncements((n) => announced.push(n));

    const t1 = Date.now();
    getActivityMock.mockResolvedValueOnce({
      actionRequired: [],
      recent: [directShare('t1', t1)],
    });
    const { result } = renderHook(() => useActivity());
    await waitFor(() => expect(result.current.count).toBe(1));
    expect(announced).toEqual([]);

    getActivityMock.mockResolvedValueOnce({
      actionRequired: [],
      recent: [directShare('t1', t1), directShare('t2', t1 + 1000)],
    });
    await fireFocus();
    await waitFor(() => expect(result.current.count).toBe(2));
    expect(announced).toEqual([2]);

    unsubscribe();
  });

  it('does not announce when a refetch resolves with a lower or equal count', async () => {
    const announced: number[] = [];
    const unsubscribe = subscribeToActivityAnnouncements((n) => announced.push(n));

    getActivityMock.mockResolvedValueOnce({
      actionRequired: [],
      recent: [directShare('t1', Date.now()), directShare('t2', Date.now() + 10)],
    });
    const { result } = renderHook(() => useActivity());
    await waitFor(() => expect(result.current.count).toBe(2));

    getActivityMock.mockResolvedValueOnce({
      actionRequired: [],
      recent: [directShare('t1', Date.now())],
    });
    await fireFocus();
    await waitFor(() => expect(result.current.count).toBe(1));
    expect(announced).toEqual([]);

    unsubscribe();
  });
});
