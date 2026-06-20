import { useEffect, useState } from 'react';
import { useAuth } from '../store/auth';
import { getInbox, type InboxShareRow } from './share-client';

/** Device-local "last time the user opened their inbox" marker (no schema/sync —
 *  mirrors the friend-requests badge, which also has no server seen-state). */
export const INBOX_LAST_SEEN_KEY = 'inbox_last_seen_at';

// Module-level fan-out so every badge re-renders the instant the inbox is opened,
// not just on the next focus/refetch.
const seenListeners = new Set<() => void>();

function readLastSeen(): number {
  const raw = localStorage.getItem(INBOX_LAST_SEEN_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Stamp the inbox as seen now and notify every mounted badge. Call when the
 *  user opens the inbox surface. */
export function markInboxSeen(): void {
  localStorage.setItem(INBOX_LAST_SEEN_KEY, String(Date.now()));
  seenListeners.forEach((fn) => fn());
}

/** Pure: how many inbox items arrived after the last-seen mark. Exported for tests. */
export function countUnseen(items: InboxShareRow[] | null, lastSeen: number): number {
  return items ? items.filter((i) => i.createdAt > lastSeen).length : 0;
}

/**
 * Directed-share inbox for the nav badge + the inbox panel. Fetches on mount and
 * window focus (no polling), only when authed — same cadence as
 * use-friend-requests. `count` is the number of items newer than the last time
 * the user opened the inbox (device-local), and drops to 0 reactively when
 * markInboxSeen() fires.
 */
export function useInbox(): { count: number; items: InboxShareRow[] | null } {
  const status = useAuth((s) => s.status);
  const [items, setItems] = useState<InboxShareRow[] | null>(null);
  const [lastSeen, setLastSeen] = useState(readLastSeen);

  useEffect(() => {
    if (status !== 'authed') return;
    let cancelled = false;

    const refetch = () => {
      getInbox()
        .then((data) => {
          if (!cancelled) setItems(data);
        })
        .catch(() => {
          /* keep last known items */
        });
    };
    const onSeen = () => setLastSeen(readLastSeen());

    refetch();
    window.addEventListener('focus', refetch);
    seenListeners.add(onSeen);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refetch);
      seenListeners.delete(onSeen);
    };
  }, [status]);

  return { count: countUnseen(items, lastSeen), items };
}
