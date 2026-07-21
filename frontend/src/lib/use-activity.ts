import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../store/auth';
import {
  getActivity,
  type DirectShareActivityItem,
  type FriendRequestActivityItem,
  type RecentActivityItem,
} from './activity-client';
import { countUnseen, INBOX_LAST_SEEN_KEY } from './use-inbox';
import type { InboxShareRow } from './share-client';

// Module-level fan-out for in-session count-increase announcements — same
// shape as use-inbox.ts's own markInboxSeen() listener Set — so the one
// mounted ActivityLiveRegion announces regardless of which useActivity()
// instance (Header, MobileTabBar, or the live region itself) detected the
// increase first.
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

// use-inbox.ts's own last-seen reader is module-private (not exported), so
// this mirrors its exact 3-line parse-with-fallback against the same shared
// key rather than requesting an export change to a file this bucket
// otherwise doesn't touch.
function readInboxLastSeen(): number {
  const raw = localStorage.getItem(INBOX_LAST_SEEN_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
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
  actionRequired: FriendRequestActivityItem[],
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

/**
 * The one badge source of truth (social program W2) — replaces
 * Header.tsx/MobileTabBar.tsx's separate useFriendRequests() + useInbox()
 * calls with a single fetch of GET /api/activity. Fetches on mount + window
 * focus, only when authed (identical cadence to useInbox/useFriendRequests).
 * Also the hook W3's Home consumes for the actual feed, not just the count.
 */
export function useActivity(): {
  count: number;
  actionRequired: FriendRequestActivityItem[];
  recent: RecentActivityItem[];
} {
  const status = useAuth((s) => s.status);
  const [actionRequired, setActionRequired] = useState<FriendRequestActivityItem[]>([]);
  const [recent, setRecent] = useState<RecentActivityItem[]>([]);
  // null = no fetch has resolved yet this session — the announce-on-increase
  // comparison never fires against it, so mount never announces.
  const previousCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== 'authed') return;
    let cancelled = false;

    const refetch = () => {
      getActivity()
        .then((data) => {
          if (cancelled) return;
          setActionRequired(data.actionRequired);
          setRecent(data.recent);
          const nextCount = computeActivityCount(
            data.actionRequired,
            data.recent,
            readInboxLastSeen()
          );
          if (previousCountRef.current !== null && nextCount > previousCountRef.current) {
            announce(nextCount);
          }
          previousCountRef.current = nextCount;
        })
        .catch(() => {
          /* silently ignore — badge stays at last known count, same
             convention as useInbox/useFriendRequests */
        });
    };

    refetch();
    window.addEventListener('focus', refetch);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refetch);
    };
  }, [status]);

  const count = computeActivityCount(actionRequired, recent, readInboxLastSeen());
  return { count, actionRequired, recent };
}
