import { EmptyState } from '@/components/shared/EmptyState';
import '@/styles/social-shared.css';
import './FriendsManagement.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSignInPath } from '@/lib/account/sign-in-path';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/toasts';
import { Tabs } from '@/components/overlays/Tabs';
import { formatRelativeTime } from '@/lib/util/format-time';
import { formatIdentity } from '@/lib/social/display-name';
import { scrollToHeading } from '@/lib/util/scroll-to-heading';
import {
  acceptRequest,
  declineRequest,
  cancelRequest,
  removeFriend,
  listFriends,
  listRequests,
  getFriendsActivity,
  type Friend,
  type FriendRequest,
  type FriendActivityItem,
} from '@/lib/social/friends-client';
import { useInbox, markInboxSeen, countUnseen, useInboxSeenAt } from '@/lib/social/use-inbox';
import { useConfirm } from '@/components/overlays/use-confirm';
import { useFollowing } from '@/lib/social/use-following';
import { FollowingPanel } from '@/components/friends/FollowingPanel';
import { FriendRow, FriendRowSkeleton } from '@/components/friends/FriendRow';
import { PeopleSearch } from '@/components/friends/PeopleSearch';
import { SuggestedBrewers } from '@/components/friends/SuggestedBrewers';

import { userMessage } from '@/lib/util/user-error';
import { Button } from '@/components/shared/Button';
type TabId = 'friends' | 'following' | 'requests' | 'inbox' | 'activity';

const TABS = [
  { id: 'friends' as TabId, label: 'Friends' },
  { id: 'following' as TabId, label: 'Following' },
  { id: 'requests' as TabId, label: 'Requests' },
  { id: 'inbox' as TabId, label: 'Inbox' },
  { id: 'activity' as TabId, label: 'Activity' },
];

// ── Skeleton ──────────────────────────────────────────────────────────────────
function FriendsSkeleton() {
  return (
    <div className="friends-skeleton" role="status" aria-label="Loading" aria-busy="true">
      <span className="friends-skeleton-bar is-row" />
      <span className="friends-skeleton-bar is-row" />
      <span className="friends-skeleton-bar is-row" />
    </div>
  );
}

export function FriendsManagement() {
  const status = useAuth((s) => s.status);
  const signInHref = useSignInPath();
  // The inbox + its unseen count come from the shared hook (same source as the
  // nav badge) — no duplicate fetch/state here.
  const { count: inboxCount, items: inbox } = useInbox();
  // Same server seen-state (T117) drives the Requests tab's own unseen pill,
  // computed below once incoming/outgoing have loaded.
  const inboxSeenAt = useInboxSeenAt();

  // Active tab is derived from the URL, not local state, so a link elsewhere
  // in the app (e.g. the home activity strip's /friends?tab=inbox) can switch
  // the visible tab even when this component is already mounted. `tab` is the
  // current param name; `friendsTab` is read too so links/bookmarks minted
  // while this lived at /you?friendsTab= keep working.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabId =
    TABS.find((t) => t.id === (searchParams.get('tab') ?? searchParams.get('friendsTab')))?.id ??
    'friends';

  // null = not yet loaded (shows skeleton); loaded = array (may be empty)
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [incoming, setIncoming] = useState<FriendRequest[] | null>(null);
  const [outgoing, setOutgoing] = useState<FriendRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const following = useFollowing(status === 'authed');

  // Activity tab: null = not yet loaded (skeleton). Fetched lazily on first
  // selection (see the tab-side-effects useEffect below), not on mount, and
  // the ref keeps a re-selection from refetching once a request has been
  // made (Retry bypasses the ref).
  const [activity, setActivity] = useState<FriendActivityItem[] | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const activityFetchedRef = useRef(false);

  const loadActivity = useCallback(() => {
    setActivityError(null);
    getFriendsActivity()
      .then((items) => setActivity(items))
      .catch((err: unknown) => {
        setActivityError(
          userMessage(err, "Couldn't load recent activity. Check your connection and try again.")
        );
      });
  }, []);

  // Busy state per-item (keyed by user/request id)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const { confirm, dialog: confirmDialog } = useConfirm();

  const setBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  // Imperative reload for event handlers (not called from effects).
  // Uses stable setter refs so it doesn't need to be in any dep array.
  const loadData = useCallback(() => {
    setLoadError(null);
    Promise.all([listFriends(), listRequests()])
      .then(([friendsRes, requestsRes]) => {
        setFriends(friendsRes);
        setIncoming(requestsRes.incoming);
        setOutgoing(requestsRes.outgoing);
      })
      .catch((err: unknown) => {
        setLoadError(
          userMessage(err, "Couldn't load your friends. Check your connection and try again.")
        );
      });
  }, []);

  const handleTabChange = useCallback(
    (next: TabId) => {
      setSearchParams((p) => {
        p.set('tab', next);
        p.delete('friendsTab');
        return p;
      });
    },
    [setSearchParams]
  );

  // Side effects of the resolved tab (mark inbox/requests seen — T117, one
  // shared server timestamp; lazy-fetch activity once). Keyed on `tab`
  // rather than called from handleTabChange so a direct deep link (e.g.
  // /you?friendsTab=inbox) gets the same treatment as a click — not just tab
  // switches made after landing on the page.
  useEffect(() => {
    if (status !== 'authed') return;
    if (tab === 'inbox' || tab === 'requests') markInboxSeen();
    if (tab === 'activity' && !activityFetchedRef.current) {
      activityFetchedRef.current = true;
      loadActivity();
    }
  }, [status, tab, loadActivity]);

  // Deep-link arrival: scroll the page heading (owned by the parent
  // FriendsPage, not this component) into view and focus it, so a non-default
  // tab always lands the user — or a screen reader — announced at "Social"
  // instead of silently at the top of the page.
  useEffect(() => {
    if (tab === 'friends') return;
    scrollToHeading('friends-page-heading-title');
  }, [tab]);

  // Inline .then() chain on purpose: react-hooks/set-state-in-effect flags
  // await-then-setState patterns even when wrapped in a separate function.
  // Null initial state is the loading sentinel
  // so we don't need synchronous setState before the promise.
  useEffect(() => {
    if (status !== 'authed') return;
    let cancelled = false;
    Promise.all([listFriends(), listRequests()])
      .then(([friendsRes, requestsRes]) => {
        if (cancelled) return;
        setFriends(friendsRes);
        setIncoming(requestsRes.incoming);
        setOutgoing(requestsRes.outgoing);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          userMessage(err, "Couldn't load your friends. Check your connection and try again.")
        );
        // Set empty arrays so skeleton goes away even on error
        setFriends([]);
        setIncoming([]);
        setOutgoing([]);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  // /trades refetches on window focus (#1538) so a page can't disagree with
  // the badge that sent you there. This page did not, and it measured stale:
  // a request landing while it sat open left the nav badge at 1 over a
  // Requests tab still reading "No pending requests", and an acceptance made
  // on another device never reached the Friends tab (playtest batch 9).
  useEffect(() => {
    if (status !== 'authed') return;
    window.addEventListener('focus', loadData);
    return () => window.removeEventListener('focus', loadData);
  }, [status, loadData]);

  const handleAccept = async (req: FriendRequest) => {
    setBusy(req.requesterId, true);
    try {
      await acceptRequest(req.requesterId);
      const requester = formatIdentity({
        username: req.requesterUsername,
        displayName: req.requesterDisplayName,
      });
      toast.show({
        message: `You and ${requester.primary} are now friends.`,
        tone: 'success',
      });
      void loadData();
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't accept that request. Try again."),
        tone: 'error',
      });
    } finally {
      setBusy(req.requesterId, false);
    }
  };

  const handleDecline = async (req: FriendRequest) => {
    setBusy(req.requesterId, true);
    try {
      await declineRequest(req.requesterId);
      toast.show({ message: 'Request declined.', tone: 'info' });
      void loadData();
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't decline that request. Try again."),
        tone: 'error',
      });
    } finally {
      setBusy(req.requesterId, false);
    }
  };

  const handleCancel = async (req: FriendRequest) => {
    setBusy(req.addresseeId, true);
    try {
      await cancelRequest(req.addresseeId);
      toast.show({ message: 'Request cancelled.', tone: 'info' });
      void loadData();
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't cancel that request. Try again."),
        tone: 'error',
      });
    } finally {
      setBusy(req.addresseeId, false);
    }
  };

  const handleRemoveFriend = async (friend: Friend) => {
    const identity = formatIdentity(friend);
    const ok = await confirm({
      title: `Remove ${identity.primary}?`,
      body: `You'll both lose access to anything the other shared friends-only, and any head-to-head history stops updating.`,
      confirmLabel: 'Remove friend',
      danger: true,
    });
    if (!ok) return;
    setBusy(friend.id, true);
    try {
      await removeFriend(friend.id);
      toast.show({
        message: `Removed ${formatIdentity(friend).primary} from friends`,
        tone: 'success',
      });
      void loadData();
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't remove that friend. Try again."),
        tone: 'error',
      });
    } finally {
      setBusy(friend.id, false);
    }
  };

  // ── Guest gate ───────────────────────────────────────────────────────────────
  if (status === 'guest') {
    return (
      // No <h1>Social</h1> here — the parent FriendsPage already renders
      // that heading (id="friends-page-heading-title"); repeating it here
      // would read as a duplicate immediately below it and add a second <h1>.
      <div className="friends-signin-prompt">
        <p className="friends-signin-title">Sign in to connect with friends</p>
        <p className="friends-signin-body">Create an account or sign in to send friend requests.</p>
        <Button variant="primary" to={signInHref}>
          Sign in
        </Button>
      </div>
    );
  }

  const loading = friends === null;
  const friendsList = friends ?? [];
  const incomingList = incoming ?? [];
  const outgoingList = outgoing ?? [];
  const inboxList = inbox ?? [];
  const followingList = following.brewers ?? [];
  const followingNames = new Set(followingList.map((b) => b.username));
  // Your circle, which the brewers-to-meet strip leaves out.
  const knownNames = new Set([...followingNames, ...friendsList.map((f) => f.username)]);
  // Few people in your circle: offer a short strip of brewers to meet. Only
  // once both lists have answered (a slow one must not flash it), and never
  // over an error.
  const fewPeople =
    !loading &&
    !loadError &&
    following.brewers !== null &&
    friendsList.length + followingList.length < 3;
  // Suppress the unseen badge while its own tab is open (it's been seen) —
  // same server truth (users.inbox_seen_at, T117) backs both.
  const unseenRequests = tab === 'requests' ? 0 : countUnseen(incomingList, inboxSeenAt);
  const unseenInbox = tab === 'inbox' ? 0 : inboxCount;

  const tabsWithCounts = TABS.map((t) => {
    let count: number | null = null;
    if (t.id === 'friends') count = friendsList.length || null;
    else if (t.id === 'following') count = followingList.length || null;
    else if (t.id === 'requests') count = unseenRequests > 0 ? unseenRequests : null;
    else if (t.id === 'inbox') count = unseenInbox > 0 ? unseenInbox : null;
    return { ...t, count };
  });

  return (
    <>
      <PeopleSearch
        friends={friends}
        incoming={incomingList}
        outgoing={outgoingList}
        following={followingNames}
        onChanged={() => void loadData()}
      />

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="friends-tabs-area">
        <Tabs
          tabs={tabsWithCounts}
          value={tab}
          onChange={handleTabChange}
          ariaLabel="Friends sections"
          variant="underline"
        />

        {loadError && (
          <div className="friends-error" role="alert">
            <span>{loadError}</span>
            <Button onClick={() => void loadData()} className="friends-error-retry">
              Retry
            </Button>
          </div>
        )}

        {/* Friends panel */}
        <div
          role="tabpanel"
          id="friends-panel-friends"
          aria-labelledby="sc-tab-friends"
          hidden={tab !== 'friends'}
          className="friends-panel"
        >
          {loading ? (
            <ul className="friends-list" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <FriendRowSkeleton key={i} />
              ))}
            </ul>
          ) : friendsList.length === 0 ? (
            <EmptyState
              status
              tagline="No friends yet."
              hint="Search above for someone you play with, then send a request."
            />
          ) : (
            <ul className="friends-list" aria-label="Your friends">
              {friendsList.map((friend) => (
                <FriendRow
                  key={friend.id}
                  friend={friend}
                  busy={busyIds.has(friend.id)}
                  onRemove={(f) => void handleRemoveFriend(f)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Following panel */}
        <div
          role="tabpanel"
          id="friends-panel-following"
          aria-labelledby="sc-tab-following"
          hidden={tab !== 'following'}
          className="friends-panel"
        >
          <FollowingPanel
            brewers={following.brewers}
            error={following.error}
            onRetry={following.reload}
          />
        </div>

        {/* Requests panel */}
        <div
          role="tabpanel"
          id="friends-panel-requests"
          aria-labelledby="sc-tab-requests"
          hidden={tab !== 'requests'}
          className="friends-panel"
        >
          {loading ? (
            <FriendsSkeleton />
          ) : incomingList.length === 0 && outgoingList.length === 0 ? (
            <EmptyState status tagline="No pending requests." />
          ) : (
            <>
              {incomingList.length > 0 && (
                <section className="friends-requests-section" aria-label="Incoming requests">
                  <h2 className="friends-requests-section-title">Incoming</h2>
                  <ul className="friends-request-list">
                    {incomingList.map((req) => {
                      const identity = formatIdentity({
                        username: req.requesterUsername,
                        displayName: req.requesterDisplayName,
                      });
                      return (
                        <li key={req.requesterId} className="friends-request-item">
                          <span className="friends-request-name">
                            <span className="friends-identity-text" title={identity.primary}>
                              {identity.primary}
                            </span>
                            {identity.secondary && (
                              <span className="friends-identity-handle">{identity.secondary}</span>
                            )}
                          </span>
                          <div className="friends-request-actions">
                            <Button
                              placement="row"
                              variant="primary"
                              onClick={() => void handleAccept(req)}
                              disabled={busyIds.has(req.requesterId)}
                              aria-label={`Accept friend request from ${identity.primary}`}
                            >
                              {busyIds.has(req.requesterId) ? 'Accepting…' : 'Accept'}
                            </Button>
                            <Button
                              placement="row"
                              onClick={() => void handleDecline(req)}
                              disabled={busyIds.has(req.requesterId)}
                              aria-label={`Decline friend request from ${identity.primary}`}
                            >
                              Decline
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {outgoingList.length > 0 && (
                <section className="friends-requests-section" aria-label="Outgoing requests">
                  <h2 className="friends-requests-section-title">Outgoing</h2>
                  <ul className="friends-request-list">
                    {outgoingList.map((req) => {
                      const identity = formatIdentity({
                        username: req.addresseeUsername,
                        displayName: req.addresseeDisplayName,
                      });
                      return (
                        <li key={req.addresseeId} className="friends-request-item">
                          <span className="friends-request-name">
                            <span className="friends-identity-text" title={identity.primary}>
                              {identity.primary}
                            </span>
                            {identity.secondary && (
                              <span className="friends-identity-handle">{identity.secondary}</span>
                            )}
                          </span>
                          <div className="friends-request-actions">
                            <Button
                              placement="row"
                              onClick={() => void handleCancel(req)}
                              disabled={busyIds.has(req.addresseeId)}
                              aria-label={`Cancel friend request to ${identity.primary}`}
                            >
                              {busyIds.has(req.addresseeId) ? 'Cancelling…' : 'Cancel'}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        {/* Inbox panel */}
        <div
          role="tabpanel"
          id="friends-panel-inbox"
          aria-labelledby="sc-tab-inbox"
          hidden={tab !== 'inbox'}
          className="friends-panel"
        >
          {inbox === null ? (
            <FriendsSkeleton />
          ) : inboxList.length === 0 ? (
            <EmptyState status tagline="Nothing shared yet." />
          ) : (
            <ul className="friends-inbox-list" aria-label="Shared with you">
              {inboxList.map((item) => {
                // Mid-sentence prose — primary name only, no secondary handle
                // (matches H2HSummary: a "@handle" inline reads awkwardly).
                const fromName = formatIdentity({
                  username: item.fromUsername,
                  displayName: item.fromDisplayName,
                }).primary;
                return (
                  <li key={item.token} className="friends-inbox-item">
                    <div className="friends-inbox-info">
                      <div className="friends-inbox-text">
                        <span className="friends-inbox-from">{fromName}</span> shared a {item.kind}:{' '}
                        <span className="friends-inbox-label">{item.label}</span>
                      </div>
                      <div className="friends-inbox-time">{formatRelativeTime(item.createdAt)}</div>
                    </div>
                    <Button
                      placement="row"
                      variant="primary"
                      to={`/s/${item.token}`}
                      aria-label={`View ${item.label} shared by ${fromName}`}
                    >
                      View
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Activity panel (new-from-friends) */}
        <div
          role="tabpanel"
          id="friends-panel-activity"
          aria-labelledby="sc-tab-activity"
          hidden={tab !== 'activity'}
          className="friends-panel"
        >
          {activityError ? (
            <div className="friends-error" role="alert">
              <span>{activityError}</span>
              <Button onClick={() => void loadActivity()} className="friends-error-retry">
                Retry
              </Button>
            </div>
          ) : activity === null ? (
            <FriendsSkeleton />
          ) : activity.length === 0 ? (
            <EmptyState status tagline="Nothing new from friends yet." />
          ) : (
            <ul className="friends-activity-list" aria-label="Recent friend activity">
              {activity.map((item) => {
                const key =
                  item.type === 'published_deck' ? `pub:${item.slug}` : `share:${item.token}`;
                const to = item.type === 'published_deck' ? `/d/${item.slug}` : `/s/${item.token}`;
                const verb = item.type === 'published_deck' ? 'published' : 'shared';
                const target = item.type === 'published_deck' ? item.deckName : item.label;
                return (
                  <li key={key} className="friends-activity-item">
                    <Link to={to} className="friends-inbox-item friends-activity-link">
                      <div className="friends-inbox-info">
                        <div className="friends-inbox-text">
                          <span className="friends-inbox-from">{item.friendUsername}</span> {verb}{' '}
                          <span className="friends-inbox-label">{target}</span>
                        </div>
                        <div className="friends-inbox-time">
                          {formatRelativeTime(item.occurredAt)}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {fewPeople && (tab === 'friends' || tab === 'following') && (
        <SuggestedBrewers known={knownNames} />
      )}
      {confirmDialog}
    </>
  );
}
