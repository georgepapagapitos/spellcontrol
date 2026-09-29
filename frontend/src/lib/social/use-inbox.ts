import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import { getInbox, type InboxShareRow } from './share-client';

/** Device-local "last time the user opened their inbox" marker — the
 *  fallback used only while signed out / before bootstrap resolves (T117:
 *  the source of truth for an authed session is now the server's
 *  `users.inbox_seen_at`, via `useInboxSeenAt()` below). */
export const INBOX_LAST_SEEN_KEY = 'inbox_last_seen_at';

// Module-level fan-out so every badge re-renders the instant the inbox is opened,
// not just on the next focus/refetch.
const seenListeners = new Set<() => void>();

function readLastSeen(): number {
  const raw = localStorage.getItem(INBOX_LAST_SEEN_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Stamp the inbox/friend-requests as seen now (T117): the server truth
 *  (`users.inbox_seen_at`, best-effort — see `useAuth().stampInboxSeen`)
 *  plus the local fallback mark, and notify every mounted badge. Call when
 *  the user opens the inbox or friends page. */
export function markInboxSeen(): void {
  localStorage.setItem(INBOX_LAST_SEEN_KEY, String(Date.now()));
  seenListeners.forEach((fn) => fn());
  void useAuth.getState().stampInboxSeen();
}

/** Pure: how many items arrived after the last-seen mark. Works for the
 *  inbox's `InboxShareRow[]` and friend-requests' `FriendRequest[]` alike —
 *  both carry a `createdAt`. Exported for tests. */
export function countUnseen(items: { createdAt: number }[] | null, lastSeen: number): number {
  return items ? items.filter((i) => i.createdAt > lastSeen).length : 0;
}

/**
 * The seen-state cutoff shared by every inbox/friend-request badge (T117):
 * server truth (`users.inbox_seen_at`, via the `useAuth` store) while authed,
 * falling back to the device-local marker only while signed out or before
 * the session's first `/me` resolves — so a still-loading session doesn't
 * flash "everything is new". Reacts immediately to `markInboxSeen()`, same
 * as the old localStorage-only mark did.
 */
export function useInboxSeenAt(): number {
  const status = useAuth((s) => s.status);
  const serverSeenAt = useAuth((s) => s.inboxSeenAt);
  const [localSeen, setLocalSeen] = useState(readLastSeen);

  useEffect(() => {
    const onSeen = () => setLocalSeen(readLastSeen());
    seenListeners.add(onSeen);
    return () => {
      seenListeners.delete(onSeen);
    };
  }, []);

  // `== null` (not `!== null`) so a mocked `useAuth` in a test that omits
  // `inboxSeenAt` from its state object falls back to the local marker
  // instead of coercing `undefined` into every comparison.
  return status === 'authed' && serverSeenAt != null ? serverSeenAt : localSeen;
}

/**
 * Directed-share inbox for the nav badge + the inbox panel. Fetches on mount and
 * window focus (no polling), only when authed — same cadence as
 * use-friend-requests. `count` is the number of items newer than the last time
 * the user opened the inbox (server truth, T117), and drops to 0 reactively when
 * markInboxSeen() fires.
 */
export function useInbox(): { count: number; items: InboxShareRow[] | null } {
  const status = useAuth((s) => s.status);
  const lastSeen = useInboxSeenAt();
  const [items, setItems] = useState<InboxShareRow[] | null>(null);

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

    refetch();
    window.addEventListener('focus', refetch);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refetch);
    };
  }, [status]);

  return { count: countUnseen(items, lastSeen), items };
}
