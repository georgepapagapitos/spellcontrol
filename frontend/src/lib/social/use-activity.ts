import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@/store/auth';
import {
  getActivity,
  type ActionRequiredItem,
  type DirectShareActivityItem,
  type FollowedDeckPublishedActivityItem,
  type RecentActivityItem,
} from './activity-client';
import { countUnseen, useInboxSeenAt } from './use-inbox';
import type { InboxShareRow } from './share-client';

// Module-level fan-out for in-session count-increase announcements — same
// shape as use-inbox.ts's own markInboxSeen() listener Set — so the one
// mounted ActivityLiveRegion announces whichever component triggered the
// fetch that saw the increase.
const announceListeners = new Set<(count: number) => void>();

function announce(count: number): void {
  announceListeners.forEach((fn) => fn(count));
}

/** Subscribe to in-session activity-count increases. Returns an unsubscribe
 *  function. Used by ActivityLiveRegion — the only consumer that renders the
 *  announcement text. */
export function subscribeToActivityAnnouncements(fn: (count: number) => void): () => void {
  announceListeners.add(fn);
  return () => {
    announceListeners.delete(fn);
  };
}

function toInboxRow(item: DirectShareActivityItem): InboxShareRow {
  return {
    token: item.token,
    kind: item.kind,
    fromUsername: item.fromUsername,
    fromDisplayName: item.fromDisplayName,
    label: item.label,
    createdAt: item.occurredAt,
  };
}

/**
 * Pure: composes the nav-badge count from the endpoint's two buckets plus the
 * device-local inbox last-seen mark. Exported for direct unit testing —
 * mirrors use-inbox.ts's own countUnseen() convention. Direct shares reuse
 * countUnseen's unseen-since-last-open semantics (same as the old inbox
 * badge); every other recent item (feedback, grouped likes) has no per-item
 * seen-state, so it's always counted while inside the server's own
 * 30-item/7-day window.
 */
export function computeActivityCount(
  actionRequired: ActionRequiredItem[],
  recent: RecentActivityItem[],
  inboxLastSeen: number
): number {
  const directShares: DirectShareActivityItem[] = [];
  let otherRecent = 0;
  for (const item of recent) {
    if (item.type === 'direct_share') directShares.push(item);
    else otherRecent++;
  }
  return (
    actionRequired.length + countUnseen(directShares.map(toInboxRow), inboxLastSeen) + otherRecent
  );
}

interface ActivitySnapshot {
  actionRequired: ActionRequiredItem[];
  recent: RecentActivityItem[];
  following: FollowedDeckPublishedActivityItem[];
  /** Whether a fetch has settled at least once since the first consumer mounted. */
  hasFetched: boolean;
}

const EMPTY: ActivitySnapshot = {
  actionRequired: [],
  recent: [],
  following: [],
  hasFetched: false,
};

// One shared feed for every consumer. Header, MobileTabBar, ActivityLiveRegion
// (and Home or the social hub when open) each used to run their own fetch and
// focus listener, so every boot and every window focus sent three to five
// identical GET /api/activity, and an increase was detected (and announced)
// once per consumer.
let snapshot: ActivitySnapshot = EMPTY;
const storeListeners = new Set<() => void>();
let consumers = 0;
let inflight: Promise<void> | null = null;
// Latest inbox last-seen mark any consumer rendered with, for the increase
// check in the fetch callback (a mark change recomputes, never refetches).
let inboxSeenAtForCount = 0;
// null = no fetch has resolved since the first consumer mounted, so the
// announce-on-increase comparison never fires on mount.
let previousCount: number | null = null;

function setSnapshot(next: ActivitySnapshot): void {
  snapshot = next;
  storeListeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  storeListeners.add(fn);
  return () => {
    storeListeners.delete(fn);
  };
}

const getSnapshot = (): ActivitySnapshot => snapshot;

/** Fetch the feed, sharing a request that is already in flight. */
function refetch(): Promise<void> {
  if (inflight) return inflight;
  const run = getActivity()
    .then((data) => {
      if (inflight !== run) return; // every consumer left (sign-out) mid-fetch
      const nextCount = computeActivityCount(data.actionRequired, data.recent, inboxSeenAtForCount);
      if (previousCount !== null && nextCount > previousCount) announce(nextCount);
      previousCount = nextCount;
      setSnapshot({
        actionRequired: data.actionRequired,
        recent: data.recent,
        following: data.following ?? [],
        hasFetched: true,
      });
    })
    .catch(() => {
      /* silently ignore — the badge stays at its last known count */
      if (inflight === run && !snapshot.hasFetched) setSnapshot({ ...snapshot, hasFetched: true });
    })
    .finally(() => {
      if (inflight === run) inflight = null;
    });
  inflight = run;
  return run;
}

const onFocus = () => void refetch();

/** An authed consumer mounted: fetch (shared), and listen for focus while any is mounted. */
function acquire(): () => void {
  if (consumers++ === 0) window.addEventListener('focus', onFocus);
  void refetch();
  return () => {
    if (--consumers > 0) return;
    // The last consumer left (sign-out, or a test unmounting): drop the feed
    // so the next account never sees this one's badge.
    window.removeEventListener('focus', onFocus);
    inflight = null;
    previousCount = null;
    setSnapshot(EMPTY);
  };
}

/**
 * The one badge source of truth (social program W2) — replaces
 * Header.tsx/MobileTabBar.tsx's separate useFriendRequests() + useInbox()
 * calls with a single GET /api/activity, shared by every consumer. Fetches
 * when a consumer mounts and on window focus, only when authed.
 * Also the hook W3's Home consumes for the actual feed, not just the count.
 */
export function useActivity(): {
  count: number;
  actionRequired: ActionRequiredItem[];
  recent: RecentActivityItem[];
  /** New decks from brewers the viewer follows. Feed content only: never part
   *  of `count`, so following someone can't light the nav badge. */
  following: FollowedDeckPublishedActivityItem[];
  /** True until the first fetch settles (authed only — a guest never fetches,
   *  so this is false immediately). Home (Waiting on you, Around the table)
   *  is the one consumer that needs a loading signal; Header/MobileTabBar only render
   *  the count, which just pops in once resolved. */
  loading: boolean;
} {
  const status = useAuth((s) => s.status);
  const inboxSeenAt = useInboxSeenAt();
  const authed = status === 'authed';
  useEffect(() => {
    inboxSeenAtForCount = inboxSeenAt;
  }, [inboxSeenAt]);
  useEffect(() => (authed ? acquire() : undefined), [authed]);

  const shared = useSyncExternalStore(subscribe, getSnapshot);
  const feed = authed ? shared : EMPTY;
  const count = computeActivityCount(feed.actionRequired, feed.recent, inboxSeenAt);
  return {
    count,
    actionRequired: feed.actionRequired,
    recent: feed.recent,
    following: feed.following,
    loading: authed && !feed.hasFetched,
  };
}
