import { useEffect, useState } from 'react';
import { useAuth } from '../store/auth';
import { listRequests } from './friends-client';

/**
 * Returns the count of incoming pending friend requests for the nav badge.
 * Fetches on mount and on window focus. Only fetches when authed.
 */
export function useFriendRequests(): number {
  const status = useAuth((s) => s.status);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (status !== 'authed') return;

    let cancelled = false;

    const fetch = () => {
      listRequests()
        .then((data) => {
          if (!cancelled) setCount(data.incoming.length);
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

  return count;
}
