import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  cancelGameNight,
  createGameNight,
  gameNightUrl,
  listGameNights,
  rsvpGameNight,
  updateGameNight,
  type GameNight,
  type RsvpStatus,
} from '../../lib/game-nights-api';
import { downloadIcs, googleCalendarUrl, type CalendarEvent } from '../../lib/calendar-links';
import { listFriends, type Friend } from '../../lib/friends-client';
import { toast } from '../../store/toasts';
import { Modal } from '../Modal';
import { ConfirmDialog } from '../ConfirmDialog';
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
          <button type="button" className="btn" onClick={() => void refresh()}>
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
            Pick a date, invite friends, and share the link — anyone can RSVP, no account needed.
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
        />
      )}

      {pendingCancel && (
        <ConfirmDialog
          title={`Cancel "${pendingCancel.title}"?`}
          body="Everyone opening the link will see it as cancelled. This can't be undone."
          confirmLabel="Cancel night"
          danger
          onConfirm={() => {
            const night = pendingCancel;
            setPendingCancel(null);
            cancelGameNight(night.id)
              .then(refresh)
              .then(() => toast.show({ message: 'Game night cancelled.' }))
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
    </div>
  );
}

function NightCard({
  night,
  onEdit,
  onCancel,
  refresh,
}: {
  night: GameNight;
  onEdit: () => void;
  onCancel: () => void;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<RsvpStatus | null>(null);
  const cancelled = night.cancelledAt !== null;
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
      await navigator.clipboard.writeText(gameNightUrl(night.token));
      toast.show({ message: 'Link copied — anyone with it can RSVP.' });
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

  return (
    <li className={`game-night-card${cancelled ? ' is-cancelled' : ''}`}>
      <div className="game-night-card-head">
        <h3 className="game-night-card-title">{night.title}</h3>
        {cancelled && <span className="game-night-cancelled-pill">Cancelled</span>}
      </div>
      <p className="game-night-card-when">{when}</p>
      <p className="game-night-card-meta">
        {night.isHost ? 'Hosted by you' : `Hosted by ${night.hostUsername}`}
        {night.location ? ` · ${night.location}` : ''}
      </p>
      {night.notes && <p className="game-night-card-notes">{night.notes}</p>}
      <p className="game-night-card-tally">
        {tally}
        {night.isHost && night.awaiting.length > 0 && (
          <span className="game-night-card-awaiting">
            {' '}
            · waiting on {night.awaiting.join(', ')}
          </span>
        )}
      </p>

      {!cancelled && (
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
        {!cancelled && (
          <>
            <a
              className="btn"
              href={googleCalendarUrl(calendarEvent)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Calendar
            </a>
            <button
              type="button"
              className="btn"
              onClick={() =>
                downloadIcs(calendarEvent, `${night.token}@spellcontrol.com`, 'game-night.ics')
              }
            >
              Download .ics
            </button>
          </>
        )}
        {night.isHost && !cancelled && (
          <>
            <button type="button" className="btn" onClick={onEdit}>
              Edit
            </button>
            <button type="button" className="btn btn-danger" onClick={onCancel}>
              Cancel night
            </button>
          </>
        )}
      </div>
    </li>
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
}: {
  night: GameNight | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(night?.title ?? '');
  const [whenInput, setWhenInput] = useState(night ? epochToInput(night.startsAt) : '');
  const [location, setLocation] = useState(night?.location ?? '');
  const [notes, setNotes] = useState(night?.notes ?? '');
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    listFriends()
      .then(setFriends)
      .catch(() => setFriends([])); // No friends list ≠ no dialog — link-sharing still works.
  }, []);

  // Friends already invited or replied can't be re-invited (authed reply names
  // are usernames, so this matches the common case).
  const alreadyIn = new Set([
    ...(night?.awaiting ?? []),
    ...(night?.rsvps.map((r) => r.displayName) ?? []),
  ]);

  function toggleInvite(id: string) {
    setInvited((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setFormError('Give the night a name.');
      return;
    }
    const startsAt = whenInput ? new Date(whenInput).getTime() : NaN;
    if (!Number.isFinite(startsAt)) {
      setFormError('Pick a date and time.');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const inviteIds = [...invited];
      if (night) {
        await updateGameNight(night.id, {
          title: trimmed,
          startsAt,
          location: location.trim(),
          notes: notes.trim(),
          addInviteUserIds: inviteIds,
        });
        toast.show({ message: 'Game night updated.' });
      } else {
        const created = await createGameNight({
          title: trimmed,
          startsAt,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          location: location.trim() || undefined,
          notes: notes.trim() || undefined,
          inviteUserIds: inviteIds,
        });
        try {
          await navigator.clipboard.writeText(gameNightUrl(created.token));
          toast.show({ message: 'Game night created — link copied.' });
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

        <label className="game-night-dialog-field">
          <span>When</span>
          <input
            type="datetime-local"
            value={whenInput}
            onChange={(e) => setWhenInput(e.target.value)}
          />
        </label>

        <label className="game-night-dialog-field">
          <span>Where (optional)</span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={120}
            placeholder="e.g. Sam's place"
          />
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

        <fieldset className="game-night-dialog-invites">
          <legend>Invite friends</legend>
          {friends === null ? (
            <p className="game-night-dialog-hint">Loading friends…</p>
          ) : friends.length === 0 ? (
            <p className="game-night-dialog-hint">
              No friends yet — share the link instead; it works without an account.
            </p>
          ) : (
            <ul className="game-night-dialog-friend-list">
              {friends.map((f) => {
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
            {saving ? 'Saving…' : night ? 'Save changes' : 'Create night'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
