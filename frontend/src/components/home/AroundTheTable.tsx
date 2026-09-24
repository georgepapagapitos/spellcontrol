import './AroundTheTable.css';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  CalendarPlus,
  Heart,
  Layers,
  MessageSquare,
  Share2,
  UserPlus,
  Users,
} from 'lucide-react';
import { HomeCard } from './HomeCard';
import { CalendarLeaf } from './CalendarLeaf';
import { UserAvatar } from '../UserAvatar';
import { formatSlot } from '../NightPoll';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';
import { upcomingGameNights } from '../../lib/home-signals';
import {
  rsvpGameNight,
  STATUS_LABELS,
  type GameNight,
  type RsvpStatus,
} from '../../lib/game-nights-api';
import { getFriendsActivity, type FriendActivityItem } from '../../lib/friends-client';
import type { RecentActivityItem } from '../../lib/activity-client';
import { formatIdentity } from '../../lib/display-name';
import { formatRelativeTime } from '../../lib/format-time';
import { signInPath } from '../../lib/sign-in-path';
import { userMessage } from '@/lib/user-error';

const ROW_LIMIT = 3;
const ICON = { width: 16, height: 16, strokeWidth: 1.8, 'aria-hidden': true } as const;

interface Row {
  id: string;
  to: string;
  lead: ReactNode;
  text: ReactNode;
  ariaLabel: string;
  time: string;
}

function activityRow(item: RecentActivityItem): Row {
  const time = formatRelativeTime(item.occurredAt);
  switch (item.type) {
    case 'direct_share': {
      const from = formatIdentity({
        username: item.fromUsername,
        displayName: item.fromDisplayName,
      }).primary;
      return {
        id: item.id,
        to: `/s/${item.token}`,
        lead: <Share2 {...ICON} />,
        ariaLabel: `${from} shared a ${item.kind}: ${item.label}, ${time}`,
        text: (
          <>
            <b>{from}</b> shared a {item.kind}: <b>{item.label}</b>
          </>
        ),
        time,
      };
    }
    case 'feedback':
      return {
        id: item.id,
        to: `/decks/${item.deckId}`,
        lead: <MessageSquare {...ICON} />,
        ariaLabel: `${item.authorName} left feedback on ${item.deckName}, ${time}`,
        text: (
          <>
            <b>{item.authorName}</b> left feedback on <b>{item.deckName}</b>
          </>
        ),
        time,
      };
    case 'deck_liked': {
      const who = item.count === 1 ? 'person liked' : 'people liked';
      return {
        id: item.id,
        to: `/d/${item.slug}`,
        lead: <Heart {...ICON} />,
        ariaLabel: `${item.count} ${who} ${item.deckName}, ${time}`,
        text: (
          <>
            {item.count} {who} <b>{item.deckName}</b>
          </>
        ),
        time,
      };
    }
    case 'trade_resolved': {
      const who = formatIdentity({
        username: item.withUsername,
        displayName: item.withDisplayName,
      }).primary;
      const verb = item.outcome === 'accepted' ? 'accepted' : 'declined';
      return {
        id: item.id,
        to: `/friends/${item.withUserId}`,
        lead: <ArrowLeftRight {...ICON} />,
        ariaLabel: `${who} ${verb} your trade, ${time}`,
        text: (
          <>
            <b>{who}</b> {verb} your trade
          </>
        ),
        time,
      };
    }
  }
}

function friendRow(item: FriendActivityItem): Row {
  const published = item.type === 'published_deck';
  const verb = published ? 'published' : 'shared';
  const target = published ? item.deckName : item.label;
  const Badge = published ? Layers : Share2;
  const time = formatRelativeTime(item.occurredAt);
  return {
    id: published ? `pub:${item.slug}` : `share:${item.token}`,
    to: published ? `/d/${item.slug}` : `/s/${item.token}`,
    lead: (
      <span className="home-table-avatar">
        <UserAvatar name={item.friendUsername} size={28} />
        <Badge width={11} height={11} strokeWidth={2.2} aria-hidden className="home-table-badge" />
      </span>
    ),
    ariaLabel: `${item.friendUsername} ${verb} ${target}, ${time}`,
    text: (
      <>
        <b>{item.friendUsername}</b> {verb} <b>{target}</b>
      </>
    ),
    time,
  };
}

function RowList({ rows }: { rows: Row[] }) {
  return (
    <ul className="home-table-rows">
      {rows.map((r) => (
        <li key={r.id}>
          <Link to={r.to} className="home-table-row" aria-label={r.ariaLabel}>
            <span className="home-table-lead" aria-hidden="true">
              {r.lead}
            </span>
            <span className="home-table-text">{r.text}</span>
            <span className="home-table-time">{r.time}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ColumnError({
  message,
  onRetry,
  what,
}: {
  message: string;
  onRetry: () => void;
  what: string;
}) {
  return (
    <div className="home-card-error" role="alert">
      <span>{message}</span>
      <button
        type="button"
        className="home-card-retry"
        aria-label={`Retry loading ${what}`}
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}

/**
 * The next game night you're in, with your reply right there. Replying here
 * is the same write the Play page's night card makes (`rsvpGameNight`), with
 * the same three answers; a host sees that they're hosting, and a night
 * still voting on its date sends you to vote.
 */
function NextNight({ night, onReplied }: { night: GameNight; onReplied: () => Promise<void> }) {
  const [busy, setBusy] = useState<RsvpStatus | null>(null);
  const polling = night.options.length > 0;
  const going = night.rsvps.filter((r) => r.status === 'going').length;
  const when = polling ? 'Date up for vote' : formatSlot(night.startsAt);

  async function reply(status: RsvpStatus) {
    if (busy) return;
    setBusy(status);
    try {
      await rsvpGameNight(night.token, { status });
      await onReplied();
    } catch (err) {
      toast.show({ message: userMessage(err, "Couldn't save your RSVP."), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Link to="/play/nights" className="home-table-night">
        <CalendarLeaf at={night.startsAt} size="lg" />
        <span className="home-table-night-text">
          <span className="home-table-night-title">{night.title}</span>
          <span className="home-table-night-when">
            {when}
            {night.location ? ` · ${night.location}` : ''}
            {going > 0 ? ` · ${going} going` : ''}
          </span>
        </span>
      </Link>
      {night.isHost ? (
        <p className="home-table-note">You're hosting.</p>
      ) : polling ? (
        <Link to="/play/nights" className="home-door">
          Vote on a date
        </Link>
      ) : (
        <div className="home-table-rsvp" role="group" aria-label={`RSVP to ${night.title}`}>
          {STATUS_LABELS.map(({ status, label }) => (
            <button
              key={status}
              type="button"
              className={`btn game-night-status-btn${night.myStatus === status ? ' is-selected' : ''}`}
              aria-pressed={night.myStatus === status}
              disabled={busy !== null}
              onClick={() => void reply(status)}
            >
              {busy === status ? 'Saving…' : status === 'declined' ? "Can't" : label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

interface Props {
  nights: GameNight[];
  nightsLoading: boolean;
  nightsError: string | null;
  refreshNights: () => Promise<void>;
  recent: RecentActivityItem[];
  activityLoading: boolean;
}

/**
 * Game nights, activity on your decks and trades, and what friends have
 * published, in one card. They were three cards that were each empty for most
 * people most of the time, which left three "nothing here" rows on the page.
 *
 * With nothing in any of them it is one quiet line carrying the two ways in
 * (plan a night, find friends) — the doors the empty rows used to carry. The
 * requests and offers that need an answer are not here: they're in Waiting
 * on you, above the decks.
 */
export function AroundTheTable({
  nights,
  nightsLoading,
  nightsError,
  refreshNights,
  recent,
  activityLoading,
}: Props) {
  const guest = useAuth((s) => s.status === 'guest');
  const [friends, setFriends] = useState<FriendActivityItem[] | null>(null);
  const [friendsError, setFriendsError] = useState<string | null>(null);

  const fetchFriends = useCallback(() => {
    getFriendsActivity()
      .then(setFriends)
      .catch((err: unknown) =>
        setFriendsError(
          userMessage(err, "Couldn't load recent activity. Check your connection and try again.")
        )
      );
  }, []);

  useEffect(() => {
    if (!guest) fetchFriends();
  }, [guest, fetchFriends]);

  const retryFriends = useCallback(() => {
    setFriendsError(null);
    fetchFriends();
  }, [fetchFriends]);

  if (guest) {
    return (
      <section className="home-quiet" aria-label="Around the table">
        <Users {...ICON} />
        <b className="home-quiet-title">Around the table</b>
        <span className="home-quiet-text">
          Sign in to see game nights and what friends are building.
        </span>
        <span className="home-quiet-actions">
          <Link to={signInPath('/home')} className="btn">
            Sign in
          </Link>
        </span>
      </section>
    );
  }

  const next = upcomingGameNights(nights)[0];
  const activityRows = recent.slice(0, ROW_LIMIT).map(activityRow);
  const friendRows = (friends ?? []).slice(0, ROW_LIMIT).map(friendRow);
  const loading = nightsLoading || activityLoading || (friends === null && !friendsError);
  const quiet =
    !loading &&
    !next &&
    !nightsError &&
    activityRows.length === 0 &&
    friendRows.length === 0 &&
    !friendsError;

  if (quiet) {
    return (
      <section className="home-quiet" aria-label="Around the table">
        <Users {...ICON} />
        <b className="home-quiet-title">Around the table</b>
        <span className="home-quiet-text">No game nights planned and no friend activity yet.</span>
        <span className="home-quiet-actions">
          <Link to="/play/nights" className="btn">
            <CalendarPlus width={14} height={14} strokeWidth={1.8} aria-hidden />
            Plan a game night
          </Link>
          <Link to="/friends?tab=friends" className="btn">
            <UserPlus width={14} height={14} strokeWidth={1.8} aria-hidden />
            Find friends
          </Link>
        </span>
      </section>
    );
  }

  return (
    <HomeCard
      title="Around the table"
      icon={Users}
      loading={loading}
      viewAllHref="/friends"
      viewAllLabel="Friends"
      className="home-table-card"
    >
      <div className="home-table-cols">
        <div className="home-table-col">
          <h3 className="home-table-label">Next game night</h3>
          {nightsError ? (
            <ColumnError
              message={nightsError}
              onRetry={() => void refreshNights()}
              what="game nights"
            />
          ) : next ? (
            <NextNight night={next} onReplied={refreshNights} />
          ) : (
            <>
              <p className="home-table-note">Nothing planned.</p>
              <Link to="/play/nights" className="home-door">
                Plan a game night
              </Link>
            </>
          )}
        </div>
        {activityRows.length > 0 && (
          <div className="home-table-col">
            <h3 className="home-table-label">Activity</h3>
            <RowList rows={activityRows} />
          </div>
        )}
        {(friendRows.length > 0 || friendsError) && (
          <div className="home-table-col">
            <h3 className="home-table-label">New from friends</h3>
            {friendsError ? (
              <ColumnError message={friendsError} onRetry={retryFriends} what="friend activity" />
            ) : (
              <RowList rows={friendRows} />
            )}
          </div>
        )}
      </div>
    </HomeCard>
  );
}
