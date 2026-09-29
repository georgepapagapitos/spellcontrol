import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import { listRequests, type FriendRequest } from './friends-client';
import { countUnseen, useInboxSeenAt } from './use-inbox';

/**
 * Incoming pending friend requests. Fetches on mount and window focus, only
 * when authed. `count` is every pending request (YouPage's "N pending"
 * summary — a description, not a badge, so it's never suppressed by
 * seen-state); `unseenCount` (T117) is the subset newer than the shared
 * server `inbox_seen_at` mark, for badge/dot use — same source as
 * `useInbox`'s count.
 */
export function useFriendRequests(): { count: number; unseenCount: number } {
  const status = useAuth((s) => s.status);
  const lastSeen = useInboxSeenAt();
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);

  useEffect(() => {
    if (status !== 'authed') return;

    let cancelled = false;

    const fetch = () => {
      listRequests()
        .then((data) => {
          if (!cancelled) setIncoming(data.incoming);
        })
        .catch(() => {
          /* silently ignore — badge stays at last known count */
        });
    };

    fetch();
    window.addEventListener('focus', fetch);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', fetch);
    };
  }, [status]);

  return { count: incoming.length, unseenCount: countUnseen(incoming, lastSeen) };
}
