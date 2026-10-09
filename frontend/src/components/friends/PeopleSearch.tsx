import '@/styles/social-shared.css';
import './PeopleSearch.css';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { SearchPill } from '@/components/search/SearchPill';
import { UserAvatar } from '@/components/profile/UserAvatar';
import { FollowButton } from '../social/FollowButton';
import { Button } from '../shared/Button';
import { EmptyState } from '../shared/EmptyState';
import { Surface } from '../shared/Surface';
import {
  acceptRequest,
  searchUsers,
  sendFriendRequest,
  type Friend,
  type FriendRequest,
  type FriendStatus,
  type FriendUser,
} from '@/lib/social/friends-client';
import { searchBrewers, type BrewerCard } from '@/lib/social/brewers-client';
import { formatIdentity } from '@/lib/social/display-name';
import { useDebouncedValue } from '@/lib/util/use-debounced-value';
import { userMessage } from '@/lib/util/user-error';
import { toast } from '@/store/toasts';

const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;
/** What `GET /api/users/search` accepts; anything else (a space in a display
 *  name) would 400, so those queries go to the brewer directory only. */
const HANDLE_QUERY = /^[a-z0-9_-]{1,32}$/;

interface Person {
  username: string;
  displayName: string | null;
  avatarImageUrl: string | null;
  /** From the brewer directory: has at least one live public deck. */
  brewer: BrewerCard | null;
  /** The account's own answer, when the handle search returned it. */
  serverStatus: FriendStatus | null;
}

type Loaded = { key: string; people?: Person[]; error?: string };
type StringSet = ReadonlySet<string>;

interface Props {
  friends: Friend[] | null;
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  /** Usernames the viewer already follows. */
  following: StringSet;
  /** A friendship changed: reload friends and requests. */
  onChanged: () => void;
}

function mergePeople(users: FriendUser[], brewers: BrewerCard[]): Person[] {
  const byName = new Map<string, Person>();
  for (const u of users) {
    byName.set(u.username, {
      username: u.username,
      displayName: u.displayName,
      avatarImageUrl: null,
      brewer: null,
      serverStatus: u.friendStatus,
    });
  }
  for (const b of brewers) {
    const have = byName.get(b.username);
    byName.set(b.username, {
      username: b.username,
      displayName: b.displayName,
      avatarImageUrl: b.avatarImageUrl,
      brewer: b,
      serverStatus: have?.serverStatus ?? null,
    });
  }
  return [...byName.values()];
}

function toggled(set: StringSet, value: string, on: boolean): StringSet {
  const next = new Set(set);
  if (on) next.add(value);
  else next.delete(value);
  return next;
}

/**
 * Find people: one box for both ways in. As you type (300ms, two characters)
 * it asks the account directory by handle (works for anyone, deck or no deck)
 * and the brewer directory by name or handle (only accounts with a live
 * public deck), and merges the two by handle into one list. Enter searches
 * at once, even for one character. Each row is a link to the profile, with
 * Add friend for anyone and Follow for brewers (Follow is the row's one filled
 * button when both show). The friendship state comes
 * from the lists this page already holds, so a friend reads "Friends" without
 * a second answer; the handle search's own answer is the fallback while those
 * load. A brewer-directory failure never blocks the handle search, and the
 * reverse.
 */
export function PeopleSearch({ friends, incoming, outgoing, following, onChanged }: Props) {
  const [text, setText] = useState('');
  const [forced, setForced] = useState<string | null>(null);
  const query = text.trim();
  const debounced = useDebouncedValue(query, DEBOUNCE_MS);
  const term = forced ?? debounced;
  const active = forced !== null ? forced.length > 0 : query.length >= MIN_QUERY;
  const [tick, setTick] = useState(0);
  const [result, setResult] = useState<Loaded | null>(null);
  const [sent, setSent] = useState<StringSet>(new Set());
  const [busy, setBusy] = useState<StringSet>(new Set());
  const key = `${term}#${tick}`;

  useEffect(() => {
    if (term.length === 0 || (forced === null && term.length < MIN_QUERY)) return;
    let cancelled = false;
    Promise.allSettled([
      HANDLE_QUERY.test(term.toLowerCase()) ? searchUsers(term) : Promise.resolve<FriendUser[]>([]),
      // The brewer directory answers nothing under two characters.
      term.length < MIN_QUERY ? Promise.resolve<BrewerCard[]>([]) : searchBrewers(term),
    ]).then(([users, brewers]) => {
      if (cancelled) return;
      if (users.status === 'rejected' && brewers.status === 'rejected') {
        setResult({
          key,
          error: userMessage(users.reason, "Couldn't run that search. Try again."),
        });
        return;
      }
      setResult({
        key,
        people: mergePeople(
          users.status === 'fulfilled' ? users.value : [],
          brewers.status === 'fulfilled' ? brewers.value : []
        ),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [term, forced, key]);

  // The debounce lags the box: until it catches up (or the answer lands) the
  // area is loading, never showing the previous term's answer.
  const loading = active && (term !== (forced ?? query) || result?.key !== key);

  function statusOf(p: Person): FriendStatus {
    if (friends?.some((f) => f.username === p.username)) return 'friends';
    if (incoming.some((r) => r.requesterUsername === p.username)) return 'request_received';
    if (sent.has(p.username) || outgoing.some((r) => r.addresseeUsername === p.username)) {
      return 'request_sent';
    }
    return friends === null ? (p.serverStatus ?? 'none') : 'none';
  }

  async function act(p: Person, status: FriendStatus) {
    const who = formatIdentity(p).primary;
    setBusy((s) => toggled(s, p.username, true));
    try {
      if (status === 'request_received') {
        const req = incoming.find((r) => r.requesterUsername === p.username);
        if (!req) return;
        await acceptRequest(req.requesterId);
        toast.show({ message: `You and ${who} are now friends.`, tone: 'success' });
      } else {
        await sendFriendRequest(p.username);
        setSent((s) => toggled(s, p.username, true));
        toast.show({ message: `Friend request sent to ${who}.`, tone: 'success' });
      }
      onChanged();
    } catch (err) {
      toast.show({
        message: userMessage(err, "That didn't go through. Try again."),
        tone: 'error',
      });
    } finally {
      setBusy((s) => toggled(s, p.username, false));
    }
  }

  let body = null;
  if (active) {
    if (loading) {
      body = (
        <>
          <p role="status" className="sr-only">
            Searching…
          </p>
          <ul className="people-results" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="people-row people-row--skeleton">
                <span className="people-skel-avatar" />
                <span className="people-skel-bar" />
              </li>
            ))}
          </ul>
        </>
      );
    } else if (result?.error) {
      body = (
        <div className="friends-error" role="alert">
          <span>{result.error}</span>
          <Button onClick={() => setTick((t) => t + 1)} className="friends-error-retry">
            Retry
          </Button>
        </div>
      );
    } else if (!result?.people?.length) {
      body = (
        <EmptyState
          status
          tagline={`No one found for “${term}”.`}
          hint="Try a full username, or part of a name."
        />
      );
    } else {
      body = (
        <>
          <p role="status" className="sr-only">
            {result.people.length} {result.people.length === 1 ? 'person' : 'people'} found
          </p>
          <ul className="people-results" aria-label="Search results">
            {result.people.map((p) => {
              const { primary, secondary } = formatIdentity(p);
              const status = statusOf(p);
              const isBusy = busy.has(p.username);
              const accepting = status === 'request_received';
              return (
                <Surface as="li" variant="sleeve" key={p.username} className="people-row">
                  <Link to={`/u/${p.username}`} className="people-row-link">
                    <UserAvatar imageUrl={p.avatarImageUrl} name={primary} size={40} />
                    <span className="people-row-body">
                      <span className="people-row-name">{primary}</span>
                      {secondary && <span className="people-row-handle">{secondary}</span>}
                    </span>
                  </Link>
                  <span className="people-row-actions">
                    {status === 'friends' ? (
                      <span className="people-row-state">Friends</span>
                    ) : status === 'request_sent' ? (
                      <span className="people-row-state">Request sent</span>
                    ) : (
                      <Button
                        placement="row"
                        variant={p.brewer ? 'secondary' : 'primary'}
                        disabled={isBusy}
                        aria-label={
                          accepting
                            ? `Accept friend request from ${primary}`
                            : `Add ${primary} as a friend`
                        }
                        onClick={() => void act(p, status)}
                      >
                        {isBusy
                          ? accepting
                            ? 'Accepting…'
                            : 'Adding…'
                          : accepting
                            ? 'Accept'
                            : 'Add friend'}
                      </Button>
                    )}
                    {p.brewer && (
                      <FollowButton
                        username={p.username}
                        initialFollowing={following.has(p.username)}
                      />
                    )}
                  </span>
                </Surface>
              );
            })}
          </ul>
        </>
      );
    }
  }

  return (
    <section aria-label="Find people" className="people-search">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setForced(query);
        }}
      >
        <SearchPill
          placeholder="Find people by name or username…"
          value={text}
          onChange={(next) => {
            setText(next);
            setForced(null);
            if (!next) setResult(null);
          }}
          ariaLabel="Find people by name or username"
          inputProps={{
            autoComplete: 'off',
            autoCapitalize: 'none',
            spellCheck: false,
            enterKeyHint: 'search',
          }}
        />
      </form>
      <Button
        variant="link"
        to="/decks/discover/brewers"
        icon={<Compass width={14} height={14} strokeWidth={1.8} />}
        className="people-search-browse"
      >
        Find brewers to follow
      </Button>
      {body}
    </section>
  );
}
