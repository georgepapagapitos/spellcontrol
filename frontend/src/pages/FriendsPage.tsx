import '../components/FriendsManagement.css';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { FriendsManagement } from '../components/FriendsManagement';
import { listPods, pendingPodInviteCount, type Pod } from '../lib/pods-client';

/**
 * `/friends` — a real destination, not a settings section. Owns the page
 * heading and the "Pods" shortcut (with its pending-invite badge); the
 * social mechanics (search, requests, inbox, activity) are all
 * `FriendsManagement`, which self-gates to a sign-in prompt for guests.
 */
export function FriendsPage() {
  const username = useAuth((s) => s.user?.username ?? null);

  // Pods pending the caller's reply — feeds the "Pods" link's own badge only
  // (no dependency on the unified activity feed's Home badge). Best-effort:
  // a failure just leaves the badge off, same as YouPage's identities fetch.
  const [pods, setPods] = useState<Pod[] | null>(null);
  const pendingPodInvites = pods ? pendingPodInviteCount(pods) : 0;

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    listPods()
      .then((r) => {
        if (!cancelled) setPods(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [username]);

  return (
    <div className="friends-page">
      <div className="friends-page-header">
        <h1 id="friends-page-heading-title" className="friends-page-heading">
          Friends
        </h1>
        <Link
          to="/pods"
          className="site-nav-link"
          aria-label={
            pendingPodInvites > 0
              ? `Pods, ${pendingPodInvites} pending invite${pendingPodInvites === 1 ? '' : 's'}`
              : undefined
          }
        >
          <span>Pods</span>
          {pendingPodInvites > 0 && (
            <span className="friends-nav-link-badge" aria-hidden="true">
              {pendingPodInvites}
            </span>
          )}
        </Link>
      </div>
      <FriendsManagement />
    </div>
  );
}
