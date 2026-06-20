import './FriendsPage.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';
import { Tabs } from '../components/Tabs';
import { formatRelativeTime } from '../lib/format-time';
import {
  searchUsers,
  sendFriendRequest,
  acceptRequest,
  declineRequest,
  cancelRequest,
  removeFriend,
  listFriends,
  listRequests,
  type FriendUser,
  type Friend,
  type FriendRequest,
} from '../lib/friends-client';
import { getInbox, type InboxShareRow } from '../lib/share-client';
import { countUnseen, markInboxSeen, INBOX_LAST_SEEN_KEY } from '../lib/use-inbox';

type TabId = 'friends' | 'requests' | 'inbox';

const TABS = [
  { id: 'friends' as TabId, label: 'Friends' },
  { id: 'requests' as TabId, label: 'Requests' },
  { id: 'inbox' as TabId, label: 'Inbox' },
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

export function FriendsPage() {
  const status = useAuth((s) => s.status);

  const [tab, setTab] = useState<TabId>('friends');

  // Search
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<FriendUser[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // null = not yet loaded (shows skeleton); loaded = array (may be empty)
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [incoming, setIncoming] = useState<FriendRequest[] | null>(null);
  const [outgoing, setOutgoing] = useState<FriendRequest[] | null>(null);
  const [inbox, setInbox] = useState<InboxShareRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Device-local "last opened the inbox" mark, for the unseen tab badge.
  const [inboxSeenAt, setInboxSeenAt] = useState(
    () => Number(localStorage.getItem(INBOX_LAST_SEEN_KEY)) || 0
  );

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
    Promise.all([listFriends(), listRequests(), getInbox()])
      .then(([friendsRes, requestsRes, inboxRes]) => {
        setFriends(friendsRes);
        setIncoming(requestsRes.incoming);
        setOutgoing(requestsRes.outgoing);
        setInbox(inboxRes);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load friends.');
      });
  }, []);

  // Opening the inbox tab marks it seen (clears the unseen badge here + in nav).
  const handleTabChange = useCallback((next: TabId) => {
    setTab(next);
    if (next === 'inbox') {
      markInboxSeen();
      setInboxSeenAt(Date.now());
    }
  }, []);

  // Inline .then() chain on purpose: react-hooks/set-state-in-effect flags
  // await-then-setState patterns even when wrapped in a separate function.
  // Mirrors SharedLinksSettings — null initial state is the loading sentinel
  // so we don't need synchronous setState before the promise.
  useEffect(() => {
    if (status !== 'authed') return;
    let cancelled = false;
    Promise.all([listFriends(), listRequests(), getInbox()])
      .then(([friendsRes, requestsRes, inboxRes]) => {
        if (cancelled) return;
        setFriends(friendsRes);
        setIncoming(requestsRes.incoming);
        setOutgoing(requestsRes.outgoing);
        setInbox(inboxRes);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load friends.');
        // Set empty arrays so skeleton goes away even on error
        setFriends([]);
        setIncoming([]);
        setOutgoing([]);
        setInbox([]);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const searchInputRef = useRef<HTMLInputElement>(null);

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
        toast.show({ message: `Friend request sent to ${user.username}.`, tone: 'success' });
        // Update search result in-place
        setSearchResults((prev) =>
          prev
            ? prev.map((u) => (u.id === user.id ? { ...u, friendStatus: 'request_sent' } : u))
            : prev
        );
      } else if (user.friendStatus === 'request_received') {
        await acceptRequest(user.id);
        toast.show({ message: `You and ${user.username} are now friends.`, tone: 'success' });
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
      toast.show({
        message: `You and ${req.requesterUsername} are now friends.`,
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
      toast.show({ message: `Removed ${friend.username} from friends.`, tone: 'info' });
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
      <div className="friends-page">
        <h1 className="friends-page-heading">Friends</h1>
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
  const unseenInbox = tab === 'inbox' ? 0 : countUnseen(inbox, inboxSeenAt);

  const tabsWithCounts = TABS.map((t) => {
    let count: number | null = null;
    if (t.id === 'friends') count = friendsList.length || null;
    else if (t.id === 'requests') count = requestCount > 0 ? requestCount : null;
    else if (t.id === 'inbox') count = unseenInbox > 0 ? unseenInbox : null;
    return { ...t, count };
  });

  return (
    <div className="friends-page">
      <h1 className="friends-page-heading">Friends</h1>

      {/* ── Add Friend search ──────────────────────────────────────────────── */}
      <section aria-label="Add a friend">
        <form className="friends-search-form" onSubmit={(e) => void handleSearch(e)}>
          <input
            ref={searchInputRef}
            className="friends-search-input"
            type="search"
            placeholder="Search by username…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value) {
                setSearchResults(null);
                setSearchError(null);
              }
            }}
            aria-label="Search users by username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
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
                return (
                  <li key={user.id} className="friends-search-result">
                    <span className="friends-search-result-name" title={user.username}>
                      {user.username}
                    </span>
                    <button
                      type="button"
                      className={`friends-action-btn${isPrimary ? ' is-primary' : ''}`}
                      onClick={() => void handleSearchAction(user)}
                      disabled={!actionable || busyIds.has(user.id)}
                      aria-label={`${label} ${user.username}`}
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
            <p className="friends-empty" role="status">
              No friends yet — search above to add them.
            </p>
          ) : (
            <ul className="friends-list" aria-label="Your friends">
              {friendsList.map((friend) => (
                <li key={friend.id} className="friends-list-item">
                  <div className="friends-list-info">
                    <div className="friends-list-name" title={friend.username}>
                      {friend.username}
                    </div>
                    <div className="friends-list-since">
                      Friends since {formatRelativeTime(friend.friendedAt)}
                    </div>
                  </div>
                  <Link
                    to={`/friends/${friend.id}`}
                    className="friends-action-btn"
                    aria-label={`View what ${friend.username} shared with friends`}
                  >
                    View shared
                  </Link>
                  <button
                    type="button"
                    className="friends-action-btn is-danger"
                    onClick={() => void handleRemoveFriend(friend)}
                    disabled={busyIds.has(friend.id)}
                    aria-label={`Remove ${friend.username} from friends`}
                  >
                    {busyIds.has(friend.id) ? '…' : 'Remove'}
                  </button>
                </li>
              ))}
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
                    {incomingList.map((req) => (
                      <li key={req.requesterId} className="friends-request-item">
                        <span className="friends-request-name" title={req.requesterUsername}>
                          {req.requesterUsername}
                        </span>
                        <div className="friends-request-actions">
                          <button
                            type="button"
                            className="friends-action-btn is-primary"
                            onClick={() => void handleAccept(req)}
                            disabled={busyIds.has(req.requesterId)}
                            aria-label={`Accept friend request from ${req.requesterUsername}`}
                          >
                            {busyIds.has(req.requesterId) ? '…' : 'Accept'}
                          </button>
                          <button
                            type="button"
                            className="friends-action-btn"
                            onClick={() => void handleDecline(req)}
                            disabled={busyIds.has(req.requesterId)}
                            aria-label={`Decline friend request from ${req.requesterUsername}`}
                          >
                            Decline
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {outgoingList.length > 0 && (
                <section className="friends-requests-section" aria-label="Outgoing requests">
                  <h2 className="friends-requests-section-title">Outgoing</h2>
                  <ul className="friends-request-list">
                    {outgoingList.map((req) => (
                      <li key={req.addresseeId} className="friends-request-item">
                        <span className="friends-request-name" title={req.addresseeUsername}>
                          {req.addresseeUsername}
                        </span>
                        <div className="friends-request-actions">
                          <button
                            type="button"
                            className="friends-action-btn"
                            onClick={() => void handleCancel(req)}
                            disabled={busyIds.has(req.addresseeId)}
                            aria-label={`Cancel friend request to ${req.addresseeUsername}`}
                          >
                            {busyIds.has(req.addresseeId) ? '…' : 'Cancel'}
                          </button>
                        </div>
                      </li>
                    ))}
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
          {loading ? (
            <FriendsSkeleton />
          ) : inboxList.length === 0 ? (
            <p className="friends-empty" role="status">
              No shared items yet — when a friend sends you something, it appears here.
            </p>
          ) : (
            <ul className="friends-inbox-list" aria-label="Shared with you">
              {inboxList.map((item) => (
                <li key={item.token} className="friends-inbox-item">
                  <div className="friends-inbox-info">
                    <div className="friends-inbox-text">
                      <span className="friends-inbox-from">{item.fromUsername}</span> shared a{' '}
                      {item.kind}: <span className="friends-inbox-label">{item.label}</span>
                    </div>
                    <div className="friends-inbox-time">{formatRelativeTime(item.createdAt)}</div>
                  </div>
                  <Link
                    to={`/s/${item.token}`}
                    className="friends-action-btn is-primary"
                    aria-label={`View ${item.label} shared by ${item.fromUsername}`}
                  >
                    View
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
