import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  fetchPublicGameNight,
  GameNightNotFoundError,
  gameNightUrl,
  rsvpGameNight,
  type NightRsvp,
  type PublicGameNight,
  type RsvpStatus,
} from '../lib/game-nights-api';
import { downloadIcs, googleCalendarUrl, type CalendarEvent } from '../lib/calendar-links';
import { useAuth } from '../store/auth';
import { SharedShell } from '../components/shared/SharedShell';
import { BrandMark } from '../components/shared/BrandMark';
import './GameNightView.css';

const STATUS_LABELS: Array<{ status: RsvpStatus; label: string }> = [
  { status: 'going', label: 'Going' },
  { status: 'maybe', label: 'Maybe' },
  { status: 'declined', label: "Can't make it" },
];

/** Guest RSVP credential, per token. Survives revisits so "change my reply" works. */
function guestStorageKey(token: string): string {
  return `gn-rsvp:${token}`;
}

function loadGuestRsvp(token: string): { id: string; name: string } | null {
  try {
    const raw = localStorage.getItem(guestStorageKey(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown };
    if (typeof parsed.id === 'string' && typeof parsed.name === 'string') {
      return { id: parsed.id, name: parsed.name };
    }
  } catch {
    // Storage unavailable (private mode) — RSVP still works, just not editable later.
  }
  return null;
}

function saveGuestRsvp(token: string, id: string, name: string): void {
  try {
    localStorage.setItem(guestStorageKey(token), JSON.stringify({ id, name }));
  } catch {
    /* best-effort */
  }
}

/**
 * Public RSVP page for /gn/:token — a game night's landing for anyone with
 * the link, account or not. Mirrors SharedView's shell/state contract:
 * brand-complete loading/notFound/error states, no zustand writes.
 */
export function GameNightView() {
  const { token } = useParams<{ token: string }>();
  if (!token) {
    return (
      <SharedShell>
        <NotFoundView />
      </SharedShell>
    );
  }
  return <GameNightViewInner key={token} token={token} />;
}

function NotFoundView() {
  return (
    <main className="shared-view shared-view--missing">
      <h1>Link not found</h1>
      <p>This game night link is invalid or no longer exists.</p>
      <Link to="/" className="btn btn-primary shared-copy-btn">
        Go to SpellControl
      </Link>
    </main>
  );
}

function GameNightViewInner({ token }: { token: string }) {
  const user = useAuth((s) => s.user);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'notFound' }
    | { status: 'error'; message: string }
    | { status: 'ready'; payload: PublicGameNight }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const stored = loadGuestRsvp(token);
    fetchPublicGameNight(token, stored?.id)
      .then((payload) => {
        if (!cancelled) setState({ status: 'ready', payload });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof GameNightNotFoundError) {
          setState({ status: 'notFound' });
        } else {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : "Couldn't load the game night.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.status === 'loading') {
    return (
      <SharedShell>
        <main className="shared-view shared-view--loading" aria-busy="true">
          <BrandMark size={64} motion="busy" aria-hidden />
          <p>Loading…</p>
        </main>
      </SharedShell>
    );
  }
  if (state.status === 'notFound') {
    return (
      <SharedShell>
        <NotFoundView />
      </SharedShell>
    );
  }
  if (state.status === 'error') {
    return (
      <SharedShell>
        <main className="shared-view shared-view--error">
          <h1>Something went wrong</h1>
          <p>{state.message}</p>
          <Link to="/" className="btn btn-primary shared-copy-btn">
            Go to SpellControl
          </Link>
        </main>
      </SharedShell>
    );
  }

  return (
    <SharedShell>
      <NightBody
        token={token}
        payload={state.payload}
        username={user?.username ?? null}
        onPayload={(payload) => setState({ status: 'ready', payload })}
      />
    </SharedShell>
  );
}

function NightBody({
  token,
  payload,
  username,
  onPayload,
}: {
  token: string;
  payload: PublicGameNight;
  username: string | null;
  onPayload: (p: PublicGameNight) => void;
}) {
  const { night, rsvps, myRsvp } = payload;
  const cancelled = night.cancelledAt !== null;
  const when = useMemo(
    () =>
      new Date(night.startsAt).toLocaleString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    [night.startsAt]
  );

  const [name, setName] = useState(() => myRsvp?.displayName ?? loadGuestRsvp(token)?.name ?? '');
  const [busy, setBusy] = useState<RsvpStatus | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const needsName = username === null && myRsvp === null;

  async function reply(status: RsvpStatus) {
    if (busy) return;
    const trimmed = name.trim();
    if (needsName && trimmed.length === 0) {
      setFormError('Enter your name so the host knows who replied.');
      return;
    }
    setFormError(null);
    setBusy(status);
    try {
      const stored = loadGuestRsvp(token);
      const rsvp = await rsvpGameNight(token, {
        status,
        // Signed-in users default to their username server-side.
        displayName: trimmed.length > 0 ? trimmed : undefined,
        rsvpId: username === null ? (myRsvp?.id ?? stored?.id) : undefined,
      });
      if (username === null) saveGuestRsvp(token, rsvp.id, rsvp.displayName);
      // Re-fetch so the attendee list reflects the change without a reload.
      onPayload(await fetchPublicGameNight(token, username === null ? rsvp.id : undefined));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't save your RSVP.");
    } finally {
      setBusy(null);
    }
  }

  const calendarEvent: CalendarEvent = {
    title: night.title,
    startsAt: night.startsAt,
    location: night.location,
    description: night.notes,
    url: gameNightUrl(token),
  };

  return (
    <main className="shared-view game-night-view">
      <header className="shared-view-header">
        <p className="shared-view-owner">Game night hosted by {night.hostUsername}</p>
        <h1 className="shared-view-title">{night.title}</h1>
        {cancelled && (
          <p className="game-night-cancelled" role="status">
            This game night was cancelled.
          </p>
        )}
      </header>

      <dl className="game-night-facts">
        <div className="game-night-fact">
          <dt>When</dt>
          <dd>{when}</dd>
        </div>
        {night.location && (
          <div className="game-night-fact">
            <dt>Where</dt>
            <dd>{night.location}</dd>
          </div>
        )}
        {night.notes && (
          <div className="game-night-fact">
            <dt>Notes</dt>
            <dd>{night.notes}</dd>
          </div>
        )}
      </dl>

      {!cancelled && (
        <section className="game-night-reply" aria-label="Your reply">
          <h2 className="game-night-section-title">
            {myRsvp ? 'Your reply — change it any time' : 'Can you make it?'}
          </h2>
          {username !== null ? (
            <p className="game-night-reply-as">Replying as {username}</p>
          ) : (
            <label className="game-night-name-field">
              <span>Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder="e.g. Pat"
                autoComplete="name"
              />
            </label>
          )}
          <div className="game-night-status-btns" role="group" aria-label="RSVP">
            {STATUS_LABELS.map(({ status, label }) => (
              <button
                key={status}
                type="button"
                className={`btn game-night-status-btn${myRsvp?.status === status ? ' is-selected' : ''}`}
                aria-pressed={myRsvp?.status === status}
                disabled={busy !== null}
                onClick={() => void reply(status)}
              >
                {busy === status ? 'Saving…' : label}
              </button>
            ))}
          </div>
          {formError && (
            <p className="game-night-form-error" role="alert">
              {formError}
            </p>
          )}
        </section>
      )}

      {!cancelled && (
        <section className="game-night-calendar" aria-label="Add to calendar">
          <h2 className="game-night-section-title">Add it to your calendar</h2>
          <div className="game-night-calendar-btns">
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
                downloadIcs(calendarEvent, `${token}@spellcontrol.com`, 'game-night.ics')
              }
            >
              Download .ics
            </button>
          </div>
        </section>
      )}

      <AttendeeList rsvps={rsvps} />
    </main>
  );
}

function AttendeeList({ rsvps }: { rsvps: NightRsvp[] }) {
  return (
    <section className="game-night-attendees" aria-label="Replies">
      {STATUS_LABELS.map(({ status, label }) => {
        const group = rsvps.filter((r) => r.status === status);
        if (group.length === 0) return null;
        return (
          <div key={status} className="game-night-attendee-group">
            <h2 className="game-night-section-title">
              {label} <span className="game-night-count">{group.length}</span>
            </h2>
            <ul className="game-night-attendee-list">
              {group.map((r, i) => (
                <li key={`${r.displayName}-${i}`}>
                  {r.displayName}
                  {r.isHost && <span className="game-night-host-pill">Host</span>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {rsvps.length === 0 && <p className="game-night-no-replies">No replies yet.</p>}
    </section>
  );
}
