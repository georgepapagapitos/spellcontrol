import { useEffect, useState } from 'react';
import { useActivity, subscribeToActivityAnnouncements } from '../lib/use-activity';

/**
 * Mounted once in Layout.tsx (not duplicated in Header/MobileTabBar, which
 * are simultaneously present in the DOM at all times — only CSS display:none
 * per breakpoint hides one, which isn't a reliable de-dupe for a live
 * region). Calls useActivity() itself so it independently detects count
 * increases too, matching the existing useInbox/useFriendRequests precedent
 * of each nav surface fetching independently rather than sharing a cache.
 *
 * Renders nothing visible. The badge's own aria-label already communicates
 * the current count to a screen reader landing on the nav item, so this
 * region exists purely for in-session deltas — never announces on mount.
 */
export function ActivityLiveRegion() {
  useActivity();
  const [message, setMessage] = useState('');

  useEffect(() => {
    return subscribeToActivityAnnouncements((count) => {
      setMessage(`${count} new update${count === 1 ? '' : 's'}`);
    });
  }, []);

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}
