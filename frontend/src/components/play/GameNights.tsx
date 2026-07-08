import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  cancelGameNight,
  createGameNight,
  deleteGameNight,
  endGameNightSeries,
  gameNightSeriesUrl,
  gameNightUrl,
  listGameNights,
  lockGameNight,
  openGameNightPoll,
  removeGameNightInvite,
  removeGameNightRsvp,
  rsvpGameNight,
  suggestGameNightOption,
  unblockGameNightUser,
  updateGameNight,
  voteGameNight,
  type GameNight,
  type NightOption,
  type NightRsvp,
  type RsvpStatus,
} from '../../lib/game-nights-api';
import { CalendarPlus, ChevronDown, ChevronRight } from 'lucide-react';
import { downloadIcs, googleCalendarUrl, type CalendarEvent } from '../../lib/calendar-links';
import { mapsSearchUrl, searchPlaces } from '../../lib/place-search';
import { listFriends, sendFriendRequest, type Friend } from '../../lib/friends-client';
import { FORMAT_OPTIONS, MAX_LOCAL_PLAYERS, gameFormatLabel } from '../../lib/game-formats';
import { useAuth } from '../../store/auth';
import { usePlayStore } from '../../store/play';
import { toast } from '../../store/toasts';
import { Modal } from '../Modal';
import { OverflowMenu } from '../OverflowMenu';
import { ConfirmDialog } from '../ConfirmDialog';
import { NightPoll, formatSlot } from '../NightPoll';
import './GameNights.css';

const STATUS_LABELS: Array<{ status: RsvpStatus; label: string }> = [
  { status: 'going', label: 'Going' },
  { status: 'maybe', label: 'Maybe' },
  { status: 'declined', label: "Can't make it" },
];

/** Nights needing the caller's reply — surfaced as the tab's count badge. */
export function pendingInviteCount(nights: GameNight[]): number {
  return nights.filter((n) => !n.isHost && n.myStatus === null && n.cancelledAt === null).length;
}

export function useGameNights(enabled: boolean) {
  const [nights, setNights] = useState<GameNight[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  // setState only inside promise callbacks (never synchronously) so the
  // react-hooks/set-state-in-effect lint holds — same shape as use-inbox.
  const refresh = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve();
    return listGameNights()
      .then((next) => {
        setNights(next);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Couldn't load game nights.");
      })
      .finally(() => setLoading(false));
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { nights, loading, error, refresh };
}

interface GameNightsTabProps {
  isGuest: boolean;
  nights: GameNight[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function GameNightsTab({ isGuest, nights, loading, error, refresh }: GameNightsTabProps) {
  const [dialog, setDialog] = useState<'closed' | 'create' | GameNight>('closed');
  const [pendingCancel, setPendingCancel] = useState<GameNight | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GameNight | null>(null);

  if (isGuest) {
    return (
      <div className="empty-state">
        <p className="empty-state-tagline">Game nights need an account</p>
        <p className="empty-state-hint">
          Sign in to plan a night and invite friends. Anyone you send the link to can RSVP without
          an account.
        </p>
        <div className="empty-state-actions">
          <Link to="/auth" className="btn btn-primary">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="game-nights-skeleton" aria-hidden="true" />;
  }

  if (error) {
    return (
      <div className="empty-state">
        <p className="empty-state-tagline">Couldn't load game nights</p>
        <p className="empty-state-hint">{error}</p>
        <div className="empty-state-actions">
          <button
            type="button"
            className="btn game-nights-retry-btn"
            onClick={() => void refresh()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="game-nights">
      {nights.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-tagline">No game nights planned.</p>
          <p className="empty-state-hint">
            Pick a date — or let the group vote on one — invite friends, and share the link. Anyone
            can RSVP, no account needed.
          </p>
          <div className="empty-state-actions">
            <button type="button" className="btn btn-primary" onClick={() => setDialog('create')}>
              Plan a game night
            </button>
          </div>
        </div>
      ) : (
        <>
          <header className="play-setup-header game-nights-header">
            <div>
              <h2 className="play-setup-title">Game nights</h2>
              <p className="play-setup-help">
                Share a night's link with anyone — RSVPs don't need an account.
              </p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setDialog('create')}>
              Plan a game night
            </button>
          </header>
          <ul className="game-nights-list">
            {nights.map((night) => (
              <NightCard
                key={night.id}
                night={night}
                onEdit={() => setDialog(night)}
                onCancel={() => setPendingCancel(night)}
                onDelete={() => setPendingDelete(night)}
                refresh={refresh}
              />
            ))}
          </ul>
        </>
      )}

      {dialog !== 'closed' && (
        <NightDialog
          night={dialog === 'create' ? null : dialog}
          onClose={() => setDialog('closed')}
          onSaved={() => {
            setDialog('closed');
            void refresh();
          }}
          onPeopleChanged={() => void refresh()}
        />
      )}

      {pendingCancel && (
        <ConfirmDialog
          title={
            pendingCancel.series && pendingCancel.series.endedAt === null
              ? `Skip "${pendingCancel.title}"?`
              : `Cancel "${pendingCancel.title}"?`
          }
          body={
            pendingCancel.series && pendingCancel.series.endedAt === null
              ? "This week is skipped — anyone opening the link sees it as cancelled, and next week's night takes its place."
              : "Everyone opening the link will see it as cancelled. This can't be undone."
          }
          confirmLabel={
            pendingCancel.series && pendingCancel.series.endedAt === null
              ? 'Skip night'
              : 'Cancel night'
          }
          danger
          onConfirm={() => {
            const night = pendingCancel;
            const skipped = night.series !== null && night.series.endedAt === null;
            setPendingCancel(null);
            cancelGameNight(night.id)
              .then(refresh)
              .then(() =>
                toast.show({
                  message: skipped ? 'Night skipped — see you next week.' : 'Game night cancelled.',
                })
              )
              .catch((err) =>
                toast.show({
                  message: err instanceof Error ? err.message : "Couldn't cancel the game night.",
                  tone: 'error',
                })
              );
          }}
          onCancel={() => setPendingCancel(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.title}"?`}
          body="This removes the night for everyone and the link stops working. This can't be undone."
          confirmLabel="Delete night"
          danger
          onConfirm={() => {
            const night = pendingDelete;
            setPendingDelete(null);
            deleteGameNight(night.id)
              .then(refresh)
              .then(() => toast.show({ message: 'Game night deleted.' }))
              .catch((err) =>
                toast.show({
                  message: err instanceof Error ? err.message : "Couldn't delete the game night.",
                  tone: 'error',
                })
              );
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function NightCard({
  night,
  onEdit,
  onCancel,
  onDelete,
  refresh,
}: {
  night: GameNight;
  onEdit: () => void;
  onCancel: () => void;
  onDelete: () => void;
  refresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const seedGameSetup = usePlayStore((s) => s.seedGameSetup);
  const [busy, setBusy] = useState<RsvpStatus | null>(null);
  const [pendingLock, setPendingLock] = useState<NightOption | null>(null);
  const [pendingStopRepeat, setPendingStopRepeat] = useState(false);
  const [pollDialogOpen, setPollDialogOpen] = useState(false);
  const [attendeeSheetOpen, setAttendeeSheetOpen] = useState(false);
  const cancelled = night.cancelledAt !== null;
  const polling = night.options.length > 0;
  const weekly = night.series !== null && night.series.endedAt === null;
  const formatLabel = gameFormatLabel(night.format);
  const when = new Date(night.startsAt).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const going = night.rsvps.filter((r) => r.status === 'going').length;
  const maybe = night.rsvps.filter((r) => r.status === 'maybe').length;
  const tally = [`${going} going`, maybe > 0 ? `${maybe} maybe` : null].filter(Boolean).join(' · ');

  // Host payoff: seed the local setup with the going roster + this night's
  // format, then jump to Play → Local to review and start. Caps the roster at
  // the local setup's player limit — a game night can outgrow it.
  function startGame() {
    const names = night.rsvps.filter((r) => r.status === 'going').map((r) => r.displayName);
    const seeded = names.slice(0, MAX_LOCAL_PLAYERS);
    seedGameSetup(seeded, night.format);
    if (names.length > seeded.length) {
      toast.show({
        message: `Added the first ${MAX_LOCAL_PLAYERS} players — add the rest from the seat list.`,
      });
    }
    navigate('/play?tab=local');
  }

  async function reply(status: RsvpStatus) {
    if (busy) return;
    setBusy(status);
    try {
      await rsvpGameNight(night.token, { status });
      await refresh();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't save your RSVP.",
        tone: 'error',
      });
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    try {
      // An active series shares its stable link — pin it once, it always
      // opens the upcoming night.
      if (weekly) {
        await navigator.clipboard.writeText(gameNightSeriesUrl(night.series!.token));
        toast.show({ message: 'Series link copied — it always opens the next night.' });
      } else {
        await navigator.clipboard.writeText(gameNightUrl(night.token));
        toast.show({
          message: night.inviteOnly
            ? 'Link copied — only people you invited can reply.'
            : 'Link copied — anyone with it can RSVP.',
        });
      }
    } catch {
      toast.show({ message: "Couldn't copy the link.", tone: 'error' });
    }
  }

  const calendarEvent: CalendarEvent = {
    title: night.title,
    startsAt: night.startsAt,
    location: night.location,
    description: night.notes,
    url: gameNightUrl(night.token),
  };

  // A live weekly occurrence can't be hard-deleted (the next read would just
  // re-materialize the slot) — Skip / Stop repeating cover it.
  const hostItems = !night.isHost
    ? []
    : cancelled
      ? weekly
        ? []
        : [{ label: 'Delete night', onClick: onDelete, danger: true }]
      : [
          { label: 'Edit night', onClick: onEdit },
          ...(!polling
            ? [{ label: 'Vote on a new date', onClick: () => setPollDialogOpen(true) }]
            : []),
          ...(weekly
            ? [{ label: 'Stop repeating', onClick: () => setPendingStopRepeat(true) }]
            : []),
          {
            label: weekly ? 'Skip this night' : 'Cancel night',
            onClick: onCancel,
            danger: true,
          },
          ...(!weekly ? [{ label: 'Delete night', onClick: onDelete, danger: true }] : []),
        ];

  return (
    <li className={`game-night-card${cancelled ? ' is-cancelled' : ''}`}>
      <div className="game-night-card-head">
        <h3 className="game-night-card-title">{night.title}</h3>
        {formatLabel && <span className="game-night-format-pill">{formatLabel}</span>}
        {weekly && <span className="game-night-weekly-pill">Weekly</span>}
        {night.inviteOnly && <span className="game-night-invite-pill">Invite only</span>}
        {cancelled && <span className="game-night-cancelled-pill">Cancelled</span>}
        {hostItems.length > 0 && (
          <OverflowMenu
            className="game-night-card-menu"
            ariaLabel={`Manage ${night.title}`}
            items={hostItems}
          />
        )}
      </div>
      <p className="game-night-card-when">
        {polling ? `Date up for vote · ${night.options.length} times proposed` : when}
      </p>
      <p className="game-night-card-meta">
        {night.isHost ? 'Hosted by you' : `Hosted by ${night.hostUsername}`}
        {night.location && (
          <>
            {' · '}
            <a
              className="game-night-map-link"
              href={mapsSearchUrl(night.location)}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open "${night.location}" in Google Maps`}
            >
              {night.location}
            </a>
          </>
        )}
      </p>
      {night.notes && <p className="game-night-card-notes">{night.notes}</p>}
      {!polling && (
        <button
          type="button"
          className="game-night-card-tally-btn"
          onClick={() => setAttendeeSheetOpen(true)}
          aria-haspopup="dialog"
          aria-label={`See who's in for ${night.title}`}
        >
          <span>
            {tally}
            {night.isHost && night.awaiting.length > 0 && (
              <span className="game-night-card-awaiting">
                {' '}
                · waiting on {night.awaiting.join(', ')}
              </span>
            )}
            {" — see who's in"}
          </span>
          <ChevronRight
            width={16}
            height={16}
            strokeWidth={2}
            aria-hidden
            className="game-night-card-tally-chevron"
          />
        </button>
      )}

      {!cancelled && polling && (
        <NightPoll
          options={night.options}
          onVote={async (optionIds) => {
            await voteGameNight(night.token, { optionIds });
            await refresh();
          }}
          onSuggest={async (startsAt) => {
            await suggestGameNightOption(night.token, { startsAt });
            await refresh();
          }}
          onLock={night.isHost ? setPendingLock : undefined}
        />
      )}

      {!cancelled && !polling && (
        <div className="game-night-card-reply" role="group" aria-label={`RSVP to ${night.title}`}>
          {STATUS_LABELS.map(({ status, label }) => (
            <button
              key={status}
              type="button"
              className={`btn game-night-status-btn${night.myStatus === status ? ' is-selected' : ''}`}
              aria-pressed={night.myStatus === status}
              disabled={busy !== null}
              onClick={() => void reply(status)}
            >
              {busy === status ? 'Saving…' : label}
            </button>
          ))}
        </div>
      )}

      <div className="game-night-card-actions">
        <button type="button" className="btn" onClick={() => void copyLink()}>
          Copy link
        </button>
        {!cancelled && !polling && (
          <OverflowMenu
            ariaLabel={`Add ${night.title} to your calendar`}
            triggerClassName="btn game-night-cal-trigger"
            align="left"
            trigger={
              <>
                <CalendarPlus width={15} height={15} strokeWidth={1.7} aria-hidden />
                Add to calendar
                <ChevronDown width={14} height={14} strokeWidth={2} aria-hidden />
              </>
            }
            items={[
              {
                label: 'Google Calendar',
                onClick: () => window.open(googleCalendarUrl(calendarEvent), '_blank', 'noopener'),
              },
              {
                label: 'Apple / Outlook (.ics)',
                onClick: () =>
                  downloadIcs(calendarEvent, `${night.token}@spellcontrol.com`, 'game-night.ics'),
              },
            ]}
          />
        )}
        {night.isHost && !cancelled && !polling && (
          <button
            type="button"
            className="btn btn-primary"
            aria-label={`Start a game for ${night.title}`}
            onClick={startGame}
          >
            Start game
          </button>
        )}
      </div>

      {pollDialogOpen && (
        <PollDialog
          night={night}
          onClose={() => setPollDialogOpen(false)}
          onSaved={() => {
            setPollDialogOpen(false);
            void refresh();
          }}
        />
      )}

      {pendingStopRepeat && (
        <ConfirmDialog
          title={`Stop repeating "${night.title}"?`}
          body="This night stays on the calendar, but no new weeks will be scheduled. The series link keeps opening the last night."
          confirmLabel="Stop repeating"
          onConfirm={() => {
            setPendingStopRepeat(false);
            endGameNightSeries(night.series!.id)
              .then(refresh)
              .then(() => toast.show({ message: 'Series stopped — no more weekly nights.' }))
              .catch((err) =>
                toast.show({
                  message: err instanceof Error ? err.message : "Couldn't stop the series.",
                  tone: 'error',
                })
              );
          }}
          onCancel={() => setPendingStopRepeat(false)}
        />
      )}

      {pendingLock && (
        <ConfirmDialog
          title={`Lock in ${formatSlot(pendingLock.startsAt)}?`}
          body="Voting closes and everyone with the link sees this date."
          confirmLabel="Lock it in"
          onConfirm={() => {
            const option = pendingLock;
            setPendingLock(null);
            lockGameNight(night.id, option.id)
              .then(refresh)
              .then(() => toast.show({ message: 'Date locked in.' }))
              .catch((err) =>
                toast.show({
                  message: err instanceof Error ? err.message : "Couldn't lock the date in.",
                  tone: 'error',
                })
              );
          }}
          onCancel={() => setPendingLock(null)}
        />
      )}

      {attendeeSheetOpen && (
        <AttendeeSheet night={night} onClose={() => setAttendeeSheetOpen(false)} />
      )}
    </li>
  );
}

/**
 * "Who's in" sheet, opened from the tally line — lists rsvps grouped by
 * status (host and attendees see the same thing), plus awaiting invitees
 * when the viewer is the host. Account-backed rows carry a `username`
 * (E123+ authed-viewer exposure); anyone else's, still-unfriended attendee
 * gets an inline "Add friend" action.
 */
function AttendeeSheet({ night, onClose }: { night: GameNight; onClose: () => void }) {
  const signedInUsername = useAuth((s) => s.user?.username ?? null);
  const [friendsFetch, setFriendsFetch] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ready'; usernames: Set<string> }
  >({ status: 'loading' });
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    listFriends()
      .then((friends) => {
        if (!cancelled) {
          setFriendsFetch({ status: 'ready', usernames: new Set(friends.map((f) => f.username)) });
        }
      })
      .catch(() => {
        if (!cancelled) setFriendsFetch({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function addFriend(username: string, displayName: string) {
    if (busy.has(username) || requested.has(username)) return;
    setBusy((prev) => new Set(prev).add(username));
    try {
      await sendFriendRequest(username);
      setRequested((prev) => new Set(prev).add(username));
      toast.show({ message: `Friend request sent to ${displayName}.`, tone: 'success' });
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't send the friend request.",
        tone: 'error',
      });
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(username);
        return next;
      });
    }
  }

  function renderRow(r: NightRsvp, key: string) {
    const canAddFriend =
      friendsFetch.status === 'ready' &&
      r.username !== undefined &&
      r.username !== signedInUsername &&
      !friendsFetch.usernames.has(r.username);
    return (
      <li key={key} className="game-night-attendee-row">
        <span className="game-night-person-name">
          {r.displayName}
          {r.isHost && <span className="game-night-host-pill">Host</span>}
        </span>
        {canAddFriend && r.username !== undefined && (
          <button
            type="button"
            className="btn game-night-attendee-add-friend"
            disabled={busy.has(r.username) || requested.has(r.username)}
            aria-label={
              requested.has(r.username)
                ? `Friend request sent to ${r.displayName}`
                : `Add ${r.displayName} as a friend`
            }
            onClick={() => void addFriend(r.username!, r.displayName)}
          >
            {requested.has(r.username)
              ? 'Requested'
              : busy.has(r.username)
                ? 'Sending…'
                : 'Add friend'}
          </button>
        )}
      </li>
    );
  }

  const titleId = `game-night-attendee-sheet-title-${night.id}`;

  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <div className="game-night-dialog">
        <h2 id={titleId} className="game-night-dialog-title">
          Who's in — {night.title}
        </h2>
        {friendsFetch.status !== 'ready' && (
          <p className="game-night-dialog-hint">
            {friendsFetch.status === 'loading'
              ? "Checking who you're already friends with…"
              : "Couldn't check friend status — add-friend isn't available right now."}
          </p>
        )}
        {night.rsvps.length === 0 && <p className="game-night-dialog-hint">No replies yet.</p>}
        {STATUS_LABELS.map(({ status, label }) => {
          const group = night.rsvps.filter((r) => r.status === status);
          if (group.length === 0) return null;
          return (
            <section key={status} className="game-night-attendee-group">
              <h3 className="game-night-attendee-group-title">
                {label} <span className="game-night-count">{group.length}</span>
              </h3>
              <ul className="game-night-attendee-sheet-list">
                {group.map((r, i) => renderRow(r, r.id ?? `${status}-${i}-${r.displayName}`))}
              </ul>
            </section>
          );
        })}
        {night.isHost && night.awaiting.length > 0 && (
          <section className="game-night-attendee-group">
            <h3 className="game-night-attendee-group-title">
              Hasn't replied yet <span className="game-night-count">{night.awaiting.length}</span>
            </h3>
            <ul className="game-night-attendee-sheet-list">
              {night.awaiting.map((username) => (
                <li key={username} className="game-night-attendee-row">
                  <span className="game-night-person-name">{username}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="game-night-dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Host tool: open a date vote on an existing night — "should we move this
 * one?". The current date is pre-filled as the first candidate; voting,
 * suggestions, and lock-in are the same poll everyone already knows.
 */
function PollDialog({
  night,
  onClose,
  onSaved,
}: {
  night: GameNight;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [optionInputs, setOptionInputs] = useState<string[]>([epochToInput(night.startsAt), '']);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function save() {
    const slots = optionInputs.map((v) => (v ? new Date(v).getTime() : NaN));
    if (slots.some((t) => !Number.isFinite(t))) {
      setFormError('Fill in every candidate time.');
      return;
    }
    if (new Set(slots).size !== slots.length) {
      setFormError('Candidate times must be different.');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      await openGameNightPoll(night.id, slots);
      toast.show({ message: 'Date vote opened — attendees can vote now.' });
      onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't open the date vote.");
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="game-night-poll-dialog-title" dismissable={!saving}>
      <form
        className="game-night-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="game-night-poll-dialog-title" className="game-night-dialog-title">
          Vote on a new date
        </h2>
        <p className="game-night-dialog-hint">
          Attendees vote on which times they can make; you lock one in from the night's card. The
          current time is the first option.
        </p>
        <fieldset className="game-night-dialog-options">
          <legend>Times to vote on (2–5)</legend>
          {optionInputs.map((value, i) => (
            <div key={i} className="game-night-dialog-option-row">
              <input
                type="datetime-local"
                value={value}
                aria-label={`Candidate time ${i + 1}`}
                onChange={(e) =>
                  setOptionInputs(optionInputs.map((v, j) => (j === i ? e.target.value : v)))
                }
              />
              {optionInputs.length > 2 && (
                <button
                  type="button"
                  className="btn"
                  aria-label={`Remove candidate time ${i + 1}`}
                  onClick={() => setOptionInputs(optionInputs.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {optionInputs.length < 5 && (
            <button
              type="button"
              className="btn game-night-dialog-add-option"
              onClick={() => setOptionInputs([...optionInputs, ''])}
            >
              Add another time
            </button>
          )}
        </fieldset>
        {formError && (
          <p className="game-night-form-error" role="alert">
            {formError}
          </p>
        )}
        <div className="game-night-dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Close
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Opening…' : 'Start the vote'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function epochToInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Create/edit dialog. `night` null = create. */
function NightDialog({
  night,
  onClose,
  onSaved,
  onPeopleChanged,
}: {
  night: GameNight | null;
  onClose: () => void;
  onSaved: () => void;
  /** A removal happened (people list changed) — parent should refresh. */
  onPeopleChanged: () => void;
}) {
  const [title, setTitle] = useState(night?.title ?? '');
  const [whenInput, setWhenInput] = useState(night ? epochToInput(night.startsAt) : '');
  // A 3-way single-select modeled as a radio group — "fixed date" (default),
  // "vote on a date", or "repeat weekly" are mutually exclusive by construction.
  const [dateMode, setDateMode] = useState<'fixed' | 'poll' | 'weekly'>('fixed');
  const pollMode = dateMode === 'poll';
  const repeatWeekly = dateMode === 'weekly';
  const [inviteOnly, setInviteOnly] = useState(night?.inviteOnly ?? false);
  const [optionInputs, setOptionInputs] = useState<string[]>(['', '']);
  const [format, setFormat] = useState(night?.format ?? '');
  const [location, setLocation] = useState(night?.location ?? '');
  const [placeOptions, setPlaceOptions] = useState<string[]>([]);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [placeHighlight, setPlaceHighlight] = useState(0);
  const placeWrapRef = useRef<HTMLLabelElement>(null);
  const placeListboxId = useId();
  const [notes, setNotes] = useState(night?.notes ?? '');
  const [friendsFetch, setFriendsFetch] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ready'; friends: Friend[] }
  >({ status: 'loading' });
  const [invited, setInvited] = useState<Set<string>>(new Set());
  // The dialog holds a snapshot of the night; removals/blocks are tracked
  // locally so the list updates in place while the parent list refreshes
  // behind it.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<string | null>(null);
  const [pendingBlock, setPendingBlock] = useState<{
    rsvpId: string;
    displayName: string;
    username: string;
  } | null>(null);
  const [blockedLocally, setBlockedLocally] = useState<Set<string>>(new Set());
  const [unblockedLocally, setUnblockedLocally] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFriends()
      .then((friends) => {
        if (!cancelled) setFriendsFetch({ status: 'ready', friends });
      })
      .catch(() => {
        // No friends list ≠ no dialog — link-sharing still works.
        if (!cancelled) setFriendsFetch({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced place suggestions for the Where combobox. Best-effort only:
  // aborted/failed lookups leave the typed text standing as the location.
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      if (location.trim().length < 3) {
        setPlaceOptions([]);
        return;
      }
      searchPlaces(location, ctrl.signal)
        .then((opts) => {
          setPlaceOptions(opts);
          setPlaceHighlight(0);
        })
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [location]);

  // Close the suggestion list on outside taps (SetFilterPicker pattern).
  useEffect(() => {
    if (!placeOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (placeWrapRef.current && !placeWrapRef.current.contains(e.target as Node)) {
        setPlaceOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [placeOpen]);

  function pickPlace(label: string) {
    setLocation(label);
    setPlaceOpen(false);
    setPlaceOptions([]); // the refetch for the picked text repopulates silently
  }

  function onPlaceKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (!placeOpen || placeOptions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setPlaceHighlight((h) => Math.min(h + 1, placeOptions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setPlaceHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      // Pick instead of submitting the dialog while the list is open.
      e.preventDefault();
      const pick = placeOptions[Math.min(placeHighlight, placeOptions.length - 1)];
      if (pick) pickPlace(pick);
    } else if (e.key === 'Escape') {
      // Close just the list — don't let the Modal's Esc handler dismiss the dialog.
      e.preventDefault();
      e.stopPropagation();
      setPlaceOpen(false);
    }
  }

  // Friends already invited or replied can't be re-invited (authed reply names
  // are usernames, so this matches the common case).
  const alreadyIn = new Set([
    ...(night?.awaiting ?? []),
    ...(night?.rsvps.map((r) => r.displayName) ?? []),
  ]);

  // Editable people list (host's view carries rsvp ids as removal handles).
  const people = night?.rsvps.filter((r) => r.id !== undefined && !removed.has(r.id)) ?? [];
  const awaitingLeft = night?.awaiting.filter((u) => !removed.has(`invite:${u}`)) ?? [];
  const blockedList = Array.from(
    new Set([...(night?.blocked.filter((u) => !unblockedLocally.has(u)) ?? []), ...blockedLocally])
  ).sort((a, b) => a.localeCompare(b));

  async function removeRsvp(rsvpId: string, displayName: string) {
    if (!night || removing) return;
    setRemoving(rsvpId);
    try {
      await removeGameNightRsvp(night.id, rsvpId);
      setRemoved((prev) => new Set(prev).add(rsvpId));
      toast.show({ message: `${displayName} removed from the night.` });
      onPeopleChanged();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't remove them from the night.",
        tone: 'error',
      });
    } finally {
      setRemoving(null);
    }
  }

  async function blockRsvp(rsvpId: string, displayName: string, username: string) {
    if (!night || removing) return;
    setRemoving(rsvpId);
    try {
      await removeGameNightRsvp(night.id, rsvpId, { block: true });
      setRemoved((prev) => new Set(prev).add(rsvpId));
      setBlockedLocally((prev) => new Set(prev).add(username));
      toast.show({ message: `${displayName} removed and blocked from the night.` });
      onPeopleChanged();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't block them.",
        tone: 'error',
      });
    } finally {
      setRemoving(null);
    }
  }

  async function unblockUser(username: string) {
    if (!night || removing) return;
    setRemoving(`unblock:${username}`);
    try {
      await unblockGameNightUser(night.id, username);
      setUnblockedLocally((prev) => new Set(prev).add(username));
      toast.show({ message: `${username} unblocked.` });
      onPeopleChanged();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't unblock them.",
        tone: 'error',
      });
    } finally {
      setRemoving(null);
    }
  }

  async function removeInvite(username: string) {
    if (!night || removing) return;
    setRemoving(`invite:${username}`);
    try {
      await removeGameNightInvite(night.id, username);
      setRemoved((prev) => new Set(prev).add(`invite:${username}`));
      toast.show({ message: `Invite to ${username} removed.` });
      onPeopleChanged();
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't remove the invite.",
        tone: 'error',
      });
    } finally {
      setRemoving(null);
    }
  }

  function toggleInvite(id: string) {
    setInvited((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // While a night polls, its date belongs to the poll — edits leave it alone.
  const pollingEdit = night !== null && night.options.length > 0;
  const pollCreate = night === null && pollMode;

  async function save() {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setFormError('Give the night a name.');
      return;
    }
    let startsAt: number | undefined;
    if (!pollingEdit && !pollCreate) {
      startsAt = whenInput ? new Date(whenInput).getTime() : NaN;
      if (!Number.isFinite(startsAt)) {
        setFormError('Pick a date and time.');
        return;
      }
    }
    let options: number[] | undefined;
    if (pollCreate) {
      const slots = optionInputs.map((v) => (v ? new Date(v).getTime() : NaN));
      if (slots.some((t) => !Number.isFinite(t))) {
        setFormError('Fill in every candidate time.');
        return;
      }
      if (new Set(slots).size !== slots.length) {
        setFormError('Candidate times must be different.');
        return;
      }
      options = slots;
    }
    setFormError(null);
    setSaving(true);
    try {
      const inviteIds = [...invited];
      if (night) {
        await updateGameNight(night.id, {
          title: trimmed,
          ...(pollingEdit ? {} : { startsAt }),
          location: location.trim(),
          notes: notes.trim(),
          format,
          inviteOnly,
          addInviteUserIds: inviteIds,
        });
        toast.show({ message: 'Game night updated.' });
      } else {
        const created = await createGameNight({
          title: trimmed,
          ...(options ? { options } : { startsAt }),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          location: location.trim() || undefined,
          notes: notes.trim() || undefined,
          format: format || undefined,
          inviteUserIds: inviteIds,
          inviteOnly,
          ...(repeatWeekly ? { repeatsWeekly: true } : {}),
        });
        try {
          // A weekly night copies its stable series link — the one to pin.
          if (created.series) {
            await navigator.clipboard.writeText(gameNightSeriesUrl(created.series.token));
            toast.show({ message: 'Weekly night created — series link copied.' });
          } else {
            await navigator.clipboard.writeText(gameNightUrl(created.token));
            toast.show({ message: 'Game night created — link copied.' });
          }
        } catch {
          toast.show({ message: 'Game night created.' });
        }
      }
      onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't save the game night.");
      setSaving(false);
    }
  }

  return (
    <>
      <Modal onClose={onClose} labelledBy="game-night-dialog-title" dismissable={!saving}>
        <form
          className="game-night-dialog"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2 id="game-night-dialog-title" className="game-night-dialog-title">
            {night ? 'Edit game night' : 'Plan a game night'}
          </h2>

          <label className="game-night-dialog-field">
            <span>Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="e.g. Friday commander"
              autoFocus
            />
          </label>

          {night === null && (
            <>
              <fieldset className="game-night-dialog-datemode">
                <legend>Date</legend>
                <label className="game-night-dialog-pollmode">
                  <input
                    type="radio"
                    name="game-night-date-mode"
                    checked={dateMode === 'fixed'}
                    onChange={() => setDateMode('fixed')}
                  />
                  <span>Fixed date</span>
                </label>
                <label className="game-night-dialog-pollmode">
                  <input
                    type="radio"
                    name="game-night-date-mode"
                    checked={dateMode === 'poll'}
                    onChange={() => setDateMode('poll')}
                  />
                  <span>Vote on a date</span>
                </label>
                <label className="game-night-dialog-pollmode">
                  <input
                    type="radio"
                    name="game-night-date-mode"
                    checked={dateMode === 'weekly'}
                    onChange={() => setDateMode('weekly')}
                  />
                  <span>Repeat weekly</span>
                </label>
              </fieldset>
              {repeatWeekly && (
                <p className="game-night-dialog-hint">
                  Same time every week. You'll get one stable link that always opens the next night
                  — perfect for pinning in the group chat.
                </p>
              )}
            </>
          )}
          {night !== null && night.series !== null && night.series.endedAt === null && (
            <p className="game-night-dialog-hint">
              This night repeats weekly — your changes carry forward to future weeks.
            </p>
          )}

          {pollingEdit ? (
            <p className="game-night-dialog-hint">
              The date is being voted on — lock one in from the night's card.
            </p>
          ) : pollCreate ? (
            <fieldset className="game-night-dialog-options">
              <legend>Times to vote on (2–5)</legend>
              {optionInputs.map((value, i) => (
                <div key={i} className="game-night-dialog-option-row">
                  <input
                    type="datetime-local"
                    value={value}
                    aria-label={`Candidate time ${i + 1}`}
                    onChange={(e) =>
                      setOptionInputs(optionInputs.map((v, j) => (j === i ? e.target.value : v)))
                    }
                  />
                  {optionInputs.length > 2 && (
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Remove candidate time ${i + 1}`}
                      onClick={() => setOptionInputs(optionInputs.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {optionInputs.length < 5 && (
                <button
                  type="button"
                  className="btn game-night-dialog-add-option"
                  onClick={() => setOptionInputs([...optionInputs, ''])}
                >
                  Add another time
                </button>
              )}
            </fieldset>
          ) : (
            <label className="game-night-dialog-field">
              <span>When</span>
              <input
                type="datetime-local"
                value={whenInput}
                onChange={(e) => setWhenInput(e.target.value)}
              />
            </label>
          )}

          <label className="game-night-dialog-field">
            <span>Format (optional)</span>
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="">Undecided</option>
              {FORMAT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          {/* Combobox (SetFilterPicker pattern): typed text ALWAYS stands as-is;
            suggestions are real places from the geocoder, shown exactly as
            returned — no browser substring filtering hiding fuzzy matches. */}
          <label className="game-night-dialog-field game-night-place-field" ref={placeWrapRef}>
            <span>Where (optional)</span>
            <input
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                setPlaceOpen(true);
              }}
              onFocus={() => setPlaceOpen(true)}
              onKeyDown={onPlaceKeyDown}
              maxLength={120}
              placeholder="e.g. Sam's place, or search an address"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={placeOpen && placeOptions.length > 0}
              aria-controls={placeListboxId}
              aria-activedescendant={
                placeOpen && placeOptions.length > 0
                  ? `${placeListboxId}-option-${Math.min(placeHighlight, placeOptions.length - 1)}`
                  : undefined
              }
            />
            {placeOpen && placeOptions.length > 0 && (
              <ul
                id={placeListboxId}
                className="game-night-place-results"
                role="listbox"
                aria-label="Place suggestions"
              >
                {placeOptions.map((p, i) => (
                  <li
                    key={p}
                    id={`${placeListboxId}-option-${i}`}
                    role="option"
                    aria-selected={i === placeHighlight}
                    className={`game-night-place-result${i === placeHighlight ? ' is-highlight' : ''}`}
                    onMouseEnter={() => setPlaceHighlight(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickPlace(p);
                    }}
                  >
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </label>

          <label className="game-night-dialog-field">
            <span>Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="e.g. bracket 2 decks, snacks covered"
            />
          </label>

          <label className="game-night-dialog-pollmode">
            <input
              type="checkbox"
              checked={inviteOnly}
              onChange={(e) => setInviteOnly(e.target.checked)}
            />
            <span>Invite only</span>
          </label>
          {inviteOnly && (
            <p className="game-night-dialog-hint">
              Anyone with the link can see the night, but only people you invite — or who already
              replied — can RSVP.
            </p>
          )}

          {night !== null && (people.length > 0 || awaitingLeft.length > 0) && (
            <fieldset className="game-night-dialog-people">
              <legend>Who's in</legend>
              <ul className="game-night-dialog-people-list">
                {people.map((r) => (
                  <li key={r.id}>
                    <span className="game-night-person-name">
                      {r.displayName}
                      {r.isHost ? ' (you)' : ''}
                    </span>
                    <span className="game-night-person-status">
                      {STATUS_LABELS.find((s) => s.status === r.status)?.label}
                    </span>
                    {!r.isHost && (
                      <div className="game-night-person-actions">
                        <button
                          type="button"
                          className="btn"
                          disabled={removing !== null || saving}
                          aria-label={`Remove ${r.displayName} from the night`}
                          onClick={() => void removeRsvp(r.id!, r.displayName)}
                        >
                          {removing === r.id ? 'Removing…' : 'Remove'}
                        </button>
                        {r.username !== undefined && (
                          <button
                            type="button"
                            className="btn btn-danger"
                            disabled={removing !== null || saving}
                            aria-label={`Block ${r.displayName} from rejoining the night`}
                            onClick={() =>
                              setPendingBlock({
                                rsvpId: r.id!,
                                displayName: r.displayName,
                                username: r.username!,
                              })
                            }
                          >
                            Block
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
                {awaitingLeft.map((username) => (
                  <li key={`invite:${username}`}>
                    <span className="game-night-person-name">{username}</span>
                    <span className="game-night-person-status">Invited — hasn't replied</span>
                    <button
                      type="button"
                      className="btn"
                      disabled={removing !== null || saving}
                      aria-label={`Remove the invite to ${username}`}
                      onClick={() => void removeInvite(username)}
                    >
                      {removing === `invite:${username}` ? 'Removing…' : 'Remove'}
                    </button>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          {night !== null && blockedList.length > 0 && (
            <fieldset className="game-night-dialog-people">
              <legend>Blocked</legend>
              <ul className="game-night-dialog-people-list">
                {blockedList.map((username) => (
                  <li key={`blocked:${username}`}>
                    <span className="game-night-person-name">{username}</span>
                    <span className="game-night-person-status">Can't rejoin from the link</span>
                    <button
                      type="button"
                      className="btn"
                      disabled={removing !== null || saving}
                      aria-label={`Unblock ${username}`}
                      onClick={() => void unblockUser(username)}
                    >
                      {removing === `unblock:${username}` ? 'Unblocking…' : 'Unblock'}
                    </button>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          <fieldset className="game-night-dialog-invites">
            <legend>Invite friends</legend>
            {friendsFetch.status === 'loading' ? (
              <p className="game-night-dialog-hint">Loading friends…</p>
            ) : friendsFetch.status === 'error' ? (
              <p className="game-night-dialog-hint">
                Couldn't load your friends list — share the link instead; it works without an
                account.
              </p>
            ) : friendsFetch.friends.length === 0 ? (
              <p className="game-night-dialog-hint">
                No friends yet — share the link instead; it works without an account.
              </p>
            ) : (
              <ul className="game-night-dialog-friend-list">
                {friendsFetch.friends.map((f) => {
                  const already = alreadyIn.has(f.username);
                  return (
                    <li key={f.id}>
                      <label className={already ? 'is-disabled' : undefined}>
                        <input
                          type="checkbox"
                          checked={already || invited.has(f.id)}
                          disabled={already || saving}
                          onChange={() => toggleInvite(f.id)}
                        />
                        <span>{f.username}</span>
                        {already && <span className="game-night-dialog-hint">already invited</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>

          {formError && (
            <p className="game-night-form-error" role="alert">
              {formError}
            </p>
          )}

          <div className="game-night-dialog-actions">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>
              Close
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving
                ? 'Saving…'
                : night
                  ? 'Save changes'
                  : pollMode
                    ? 'Start the vote'
                    : repeatWeekly
                      ? 'Start weekly night'
                      : 'Create night'}
            </button>
          </div>
        </form>
      </Modal>
      {pendingBlock && (
        <ConfirmDialog
          title={`Block ${pendingBlock.displayName}?`}
          body="They're removed from the night and can't rejoin from the link. You can unblock them here later."
          confirmLabel="Remove & block"
          danger
          onConfirm={() => {
            const { rsvpId, displayName, username } = pendingBlock;
            setPendingBlock(null);
            void blockRsvp(rsvpId, displayName, username);
          }}
          onCancel={() => setPendingBlock(null)}
        />
      )}
    </>
  );
}
