import './FriendsManagement.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';
import { Tabs } from './Tabs';
import { SearchPill } from './SearchPill';
import { formatRelativeTime } from '../lib/format-time';
import { formatIdentity } from '../lib/display-name';
import { prefersReducedMotion } from '../lib/use-list-flip';
import {
  searchUsers,
  sendFriendRequest,
  acceptRequest,
  declineRequest,
  cancelRequest,
  removeFriend,
  listFriends,
  listRequests,
  getFriendsActivity,
  type FriendUser,
  type Friend,
  type FriendRequest,
  type FriendActivityItem,
} from '../lib/friends-client';
import { useInbox, markInboxSeen } from '../lib/use-inbox';

type TabId = 'friends' | 'requests' | 'inbox' | 'activity';

const TABS = [
  { id: 'friends' as TabId, label: 'Friends' },
  { id: 'requests' as TabId, label: 'Requests' },
  { id: 'inbox' as TabId, label: 'Inbox' },
  { id: 'activity' as TabId, label: 'Activity' },
];

// ── Add Friend row action label ───────────────────────────────────────────────
function friendStatusLabel(status: FriendUser['friendStatus']): string {
  switch (status) {
    case 'none':
      return 'Add';
    case 'request_sent':
      return 'Pending';
    case 'request_received':
      return 'Accept';
    case 'friends':
      return 'Friends';
  }
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function FriendsSkeleton() {
  return (
    <div className="friends-skeleton" aria-label="Loading" aria-busy="true">
      <span className="friends-skeleton-bar is-row" />
      <span className="friends-skeleton-bar is-row" />
      <span className="friends-skeleton-bar is-row" />
    </div>
  );
}

export function FriendsManagement() {
  const status = useAuth((s) => s.status);
  // The inbox + its unseen count come from the shared hook (same source as the
  // nav badge) — no duplicate fetch/state here.
  const { count: inboxCount, items: inbox } = useInbox();

  // Active tab is derived from the URL, not local state, so a link elsewhere
  // in the app (e.g. the home activity strip's /you?friendsTab=inbox) can
  // switch the visible tab even when this component is already mounted.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabId = TABS.find((t) => t.id === searchParams.get('friendsTab'))?.id ?? 'friends';

  // Search
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<FriendUser[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // null = not yet loaded (shows skeleton); loaded = array (may be empty)
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [incoming, setIncoming] = useState<FriendRequest[] | null>(null);
  const [outgoing, setOutgoing] = useState<FriendRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
        setActivityError(err instanceof Error ? err.message : 'Failed to load activity.');
      });
  }, []);

  // Busy state per-item (keyed by user/request id)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

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
        setLoadError(err instanceof Error ? err.message : 'Failed to load friends.');
      });
  }, []);

  const handleTabChange = useCallback(
    (next: TabId) => {
      setSearchParams((p) => {
        p.set('friendsTab', next);
        return p;
      });
    },
    [setSearchParams]
  );

  // Side effects of the resolved tab (mark inbox seen; lazy-fetch activity
  // once). Keyed on `tab` rather than called from handleTabChange so a direct
  // deep link (e.g. /you?friendsTab=inbox) gets the same treatment as a click
  // — not just tab switches made after landing on the page.
  useEffect(() => {
    if (status !== 'authed') return;
    if (tab === 'inbox') markInboxSeen();
    if (tab === 'activity' && !activityFetchedRef.current) {
      activityFetchedRef.current = true;
      loadActivity();
    }
  }, [status, tab, loadActivity]);

  // Deep-link arrival: scroll the Friends heading (owned by the parent YouPage
  // group, not this component) into view and focus it, so a non-default
  // friendsTab always lands the user — or a screen reader — announced at
  // "Friends" instead of silently at the top of a long Settings page.
  useEffect(() => {
    if (tab === 'friends') return;
    const heading = document.getElementById('you-friends-group-title');
    if (!heading) return;
    heading.scrollIntoView({
      block: 'start',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
    heading.tabIndex = -1;
    heading.focus();
  }, [tab]);

  // Inline .then() chain on purpose: react-hooks/set-state-in-effect flags
  // await-then-setState patterns even when wrapped in a separate function.
  // Mirrors SharedLinksSettings — null initial state is the loading sentinel
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
        setLoadError(err instanceof Error ? err.message : 'Failed to load friends.');
        // Set empty arrays so skeleton goes away even on error
        setFriends([]);
        setIncoming([]);
        setOutgoing([]);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const results = await searchUsers(q);
      setSearchResults(results);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed.');
      setSearchResults(null);
    } finally {
      setSearching(false);
    }
  };

  const handleSearchAction = async (user: FriendUser) => {
    if (user.friendStatus !== 'none' && user.friendStatus !== 'request_received') return;
    setBusy(user.id, true);
    try {
      if (user.friendStatus === 'none') {
        await sendFriendRequest(user.username);
        toast.show({
          message: `Friend request sent to ${formatIdentity(user).primary}.`,
          tone: 'success',
        });
        // Update search result in-place
        setSearchResults((prev) =>
          prev
            ? prev.map((u) => (u.id === user.id ? { ...u, friendStatus: 'request_sent' } : u))
            : prev
        );
      } else if (user.friendStatus === 'request_received') {
        await acceptRequest(user.id);
        toast.show({
          message: `You and ${formatIdentity(user).primary} are now friends.`,
          tone: 'success',
        });
        setSearchResults((prev) =>
          prev ? prev.map((u) => (u.id === user.id ? { ...u, friendStatus: 'friends' } : u)) : prev
        );
        void loadData();
      }
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Action failed.',
        tone: 'error',
      });
    } finally {
      setBusy(user.id, false);
    }
  };

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
        message: err instanceof Error ? err.message : 'Failed to accept request.',
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
        message: err instanceof Error ? err.message : 'Failed to decline request.',
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
        message: err instanceof Error ? err.message : 'Failed to cancel request.',
        tone: 'error',
      });
    } finally {
      setBusy(req.addresseeId, false);
    }
  };

  const handleRemoveFriend = async (friend: Friend) => {
    setBusy(friend.id, true);
    try {
      await removeFriend(friend.id);
      toast.show({
        message: `Removed ${formatIdentity(friend).primary} from friends.`,
        tone: 'info',
      });
      void loadData();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : 'Failed to remove friend.',
        tone: 'error',
      });
    } finally {
      setBusy(friend.id, false);
    }
  };

  // ── Guest gate ───────────────────────────────────────────────────────────────
  if (status === 'guest') {
    return (
      // No <h1>Friends</h1> here — the parent YouPage group already renders
      // that heading (id="you-friends-group-title"); repeating it here would
      // read as a duplicate immediately below it and add a second page <h1>.
      <div className="friends-page">
        <div className="friends-signin-prompt">
          <p className="friends-signin-title">Sign in to connect with friends</p>
          <p className="friends-signin-body">
            Create an account or sign in to send friend requests, track your friends&rsquo;
            collections, and more.
          </p>
          <Link to="/auth" className="friends-signin-btn">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const loading = friends === null;
  const friendsList = friends ?? [];
  const incomingList = incoming ?? [];
  const outgoingList = outgoing ?? [];
  const inboxList = inbox ?? [];
  const requestCount = incomingList.length + outgoingList.length;
  // Suppress the unseen badge while the inbox tab is open (it's been seen).
  const unseenInbox = tab === 'inbox' ? 0 : inboxCount;

  const tabsWithCounts = TABS.map((t) => {
    let count: number | null = null;
    if (t.id === 'friends') count = friendsList.length || null;
    else if (t.id === 'requests') count = requestCount > 0 ? requestCount : null;
    else if (t.id === 'inbox') count = unseenInbox > 0 ? unseenInbox : null;
    return { ...t, count };
  });

  return (
    <div className="friends-page">
      {/* ── Add Friend search ──────────────────────────────────────────────── */}
      <section aria-label="Add a friend">
        <form className="friends-search-form" onSubmit={(e) => void handleSearch(e)}>
          <SearchPill
            placeholder="Search by username…"
            value={query}
            onChange={(next) => {
              setQuery(next);
              if (!next) {
                setSearchResults(null);
                setSearchError(null);
              }
            }}
            ariaLabel="Search users by username"
            inputProps={{ autoComplete: 'off', autoCapitalize: 'none', spellCheck: false }}
          />
          <button
            type="submit"
            className="friends-search-btn"
            disabled={searching || !query.trim()}
            aria-label="Search"
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        {searchError && (
          <p className="friends-error" role="alert">
            {searchError}
          </p>
        )}

        {searchResults !== null && (
          <ul className="friends-search-results" aria-label="Search results">
            {searchResults.length === 0 ? (
              <li className="friends-empty" role="status">
                No users found for &ldquo;{query}&rdquo;.
              </li>
            ) : (
              searchResults.map((user) => {
                const label = friendStatusLabel(user.friendStatus);
                const actionable =
                  user.friendStatus === 'none' || user.friendStatus === 'request_received';
                const isPrimary =
                  user.friendStatus === 'none' || user.friendStatus === 'request_received';
                const identity = formatIdentity(user);
                return (
                  <li key={user.id} className="friends-search-result">
                    <span className="friends-search-result-name">
                      <span className="friends-identity-text" title={identity.primary}>
                        {identity.primary}
                      </span>
                      {identity.secondary && (
                        <span className="friends-identity-handle">{identity.secondary}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className={`friends-action-btn${isPrimary ? ' is-primary' : ''}`}
                      onClick={() => void handleSearchAction(user)}
                      disabled={!actionable || busyIds.has(user.id)}
                      aria-label={`${label} ${identity.primary}`}
                    >
                      {busyIds.has(user.id) ? '…' : label}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </section>

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
            <button type="button" className="friends-error-retry" onClick={() => void loadData()}>
              Retry
            </button>
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
            <FriendsSkeleton />
          ) : friendsList.length === 0 ? (
            <div className="empty-state" role="status">
              <p className="empty-state-tagline">No friends yet</p>
              <p className="empty-state-hint">Search above to find and add other players.</p>
            </div>
          ) : (
            <ul className="friends-list" aria-label="Your friends">
              {friendsList.map((friend) => {
                const identity = formatIdentity(friend);
                return (
                  <li key={friend.id} className="friends-list-item">
                    <div className="friends-list-info">
                      <div className="friends-list-name" title={identity.primary}>
                        {identity.primary}
                      </div>
                      {identity.secondary && (
                        <div className="friends-identity-handle">{identity.secondary}</div>
                      )}
                      <div className="friends-list-since">
                        Friends since {formatRelativeTime(friend.friendedAt)}
                      </div>
                    </div>
                    <Link
                      to={`/friends/${friend.id}`}
                      className="friends-action-btn"
                      aria-label={`View what ${identity.primary} shared with friends`}
                    >
                      View shared
                    </Link>
                    <button
                      type="button"
                      className="friends-action-btn is-danger"
                      onClick={() => void handleRemoveFriend(friend)}
                      disabled={busyIds.has(friend.id)}
                      aria-label={`Remove ${identity.primary} from friends`}
                    >
                      {busyIds.has(friend.id) ? '…' : 'Remove'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
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
            <p className="friends-empty" role="status">
              No pending requests.
            </p>
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
                            <button
                              type="button"
                              className="friends-action-btn is-primary"
                              onClick={() => void handleAccept(req)}
                              disabled={busyIds.has(req.requesterId)}
                              aria-label={`Accept friend request from ${identity.primary}`}
                            >
                              {busyIds.has(req.requesterId) ? '…' : 'Accept'}
                            </button>
                            <button
                              type="button"
                              className="friends-action-btn"
                              onClick={() => void handleDecline(req)}
                              disabled={busyIds.has(req.requesterId)}
                              aria-label={`Decline friend request from ${identity.primary}`}
                            >
                              Decline
                            </button>
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
                            <button
                              type="button"
                              className="friends-action-btn"
                              onClick={() => void handleCancel(req)}
                              disabled={busyIds.has(req.addresseeId)}
                              aria-label={`Cancel friend request to ${identity.primary}`}
                            >
                              {busyIds.has(req.addresseeId) ? '…' : 'Cancel'}
                            </button>
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
            <div className="empty-state" role="status">
              <p className="empty-state-tagline">Nothing shared yet</p>
              <p className="empty-state-hint">
                When a friend shares a deck or collection with you, it shows up here.
              </p>
            </div>
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
                    <Link
                      to={`/s/${item.token}`}
                      className="friends-action-btn is-primary"
                      aria-label={`View ${item.label} shared by ${fromName}`}
                    >
                      View
                    </Link>
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
              <button
                type="button"
                className="friends-error-retry"
                onClick={() => void loadActivity()}
              >
                Retry
              </button>
            </div>
          ) : activity === null ? (
            <FriendsSkeleton />
          ) : activity.length === 0 ? (
            <div className="empty-state" role="status">
              <p className="empty-state-tagline">Nothing new from friends yet.</p>
              <p className="empty-state-hint">
                Add friends or check back later — this fills in as they publish decks or share with
                you.
              </p>
            </div>
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
    </div>
  );
}
