import '../components/FriendsManagement.css';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { FriendsManagement } from '../components/FriendsManagement';
import { useActivity } from '../lib/use-activity';
import { listPods, pendingPodInviteCount, type Pod } from '../lib/pods-client';

/**
 * `/friends` — a real destination, not a settings section. Owns the page
 * heading and the "Trades" / "Pods" shortcuts (each with its own pending
 * badge); the social mechanics (search, requests, inbox, activity) are all
 * `FriendsManagement`, which self-gates to a sign-in prompt for guests.
 */
export function FriendsPage() {
  const username = useAuth((s) => s.user?.username ?? null);

  // Offers waiting on the viewer. Read off the shared activity feed the Home
  // card and nav badge already use rather than a second listTrades() call —
  // it self-gates on auth and is the same bucket that drives the badge, so
  // this door can never disagree with the notification that sent them here.
  const { actionRequired } = useActivity();
  const pendingTrades = actionRequired.filter((i) => i.type === 'trade_offer').length;

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
        <div className="friends-page-links">
          <Link
            to="/trades"
            className="site-nav-link"
            aria-label={
              pendingTrades > 0
                ? `Trades, ${pendingTrades} offer${pendingTrades === 1 ? '' : 's'} waiting on you`
                : undefined
            }
          >
            <span>Trades</span>
            {pendingTrades > 0 && (
              <span className="friends-nav-link-badge" aria-hidden="true">
                {pendingTrades}
              </span>
            )}
          </Link>
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
      </div>
      <FriendsManagement />
    </div>
  );
}
