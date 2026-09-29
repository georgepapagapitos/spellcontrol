import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarPlus, ChevronDown } from 'lucide-react';
import {
  fetchPublicGameNight,
  GameNightNotFoundError,
  gameNightUrl,
  rsvpGameNight,
  suggestGameNightOption,
  voteGameNight,
  type NightRsvp,
  type PublicGameNight,
  type RsvpStatus,
} from '@/lib/play/game-nights-api';
import { downloadIcs, googleCalendarUrl, type CalendarEvent } from '@/lib/play/calendar-links';
import { gameFormatLabel } from '@/lib/play/game-formats';
import { mapsSearchUrl } from '@/lib/play/place-search';
import { useAuth } from '../store/auth';
import { ErrorView, LoadingView, NotFoundView, SharedShell } from '../components/share/SharedShell';
import { NightPoll } from '../components/NightPoll';
import { OverflowMenu } from '../components/OverflowMenu';
import './GameNightView.css';

import { userMessage } from '@/lib/util/user-error';
import { Button, buttonClass } from '@/components/shared/Button';
import { Chip } from '@/components/shared/Chip';
/** Mirrors the server's GRACE_MS (routes/game-nights.ts): a night takes
 *  replies until a day after it starts, then every write is refused with
 *  "This game night has already happened." The page used to keep offering
 *  Going / Maybe / Can't and a calendar entry for a night three days gone,
 *  and only the 400 after the tap said so (playtest batch 11). */
const REPLY_GRACE_MS = 24 * 60 * 60 * 1000;

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
      <SharedShell ctaLabel="Plan your own game nights">
        <NotFoundView message="This game night link is invalid or no longer exists." />
      </SharedShell>
    );
  }
  return <GameNightViewInner key={token} token={token} />;
}

function GameNightViewInner({ token }: { token: string }) {
  const user = useAuth((s) => s.user);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'notFound' }
    | { status: 'error'; message: string }
    | { status: 'ready'; payload: PublicGameNight }
  >({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

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
            message: userMessage(err, "Couldn't load the game night."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  if (state.status === 'loading') {
    return (
      <SharedShell ctaLabel="Plan your own game nights">
        <LoadingView />
      </SharedShell>
    );
  }
  if (state.status === 'notFound') {
    return (
      <SharedShell ctaLabel="Plan your own game nights">
        <NotFoundView message="This game night link is invalid or no longer exists." />
      </SharedShell>
    );
  }
  if (state.status === 'error') {
    return (
      <SharedShell ctaLabel="Plan your own game nights">
        <ErrorView
          message={state.message}
          onRetry={() => {
            setState({ status: 'loading' });
            setAttempt((n) => n + 1);
          }}
        />
      </SharedShell>
    );
  }

  return (
    <SharedShell ctaLabel="Plan your own game nights">
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
  const { night, rsvps, myRsvp, options, canRsvp } = payload;
  const cancelled = night.cancelledAt !== null;
  // Read the clock once, on mount: whether the night is over is decided when
  // the page opens (a reply that then crosses the line is refused server-side).
  const [openedAt] = useState(() => Date.now());
  const over = !cancelled && night.startsAt < openedAt - REPLY_GRACE_MS;
  // No replies, votes or calendar entries once the night is cancelled or over.
  const closed = cancelled || over;
  const polling = options.length > 0;
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

  /**
   * Shared identity plumbing for poll writes (vote / suggest): guests need a
   * name unless they already hold a credential; the returned rsvp credential
   * is stored and the payload re-fetched so tallies update in place.
   */
  async function pollWrite(
    fn: (identity: {
      displayName?: string;
      rsvpId?: string;
    }) => Promise<{ id: string; displayName: string }>
  ) {
    const trimmed = name.trim();
    const rsvpId = username === null ? (myRsvp?.id ?? loadGuestRsvp(token)?.id) : undefined;
    if (username === null && rsvpId === undefined && trimmed.length === 0) {
      throw new Error('Enter your name.');
    }
    const rsvp = await fn({
      displayName: trimmed.length > 0 ? trimmed : undefined,
      rsvpId,
    });
    if (username === null) saveGuestRsvp(token, rsvp.id, rsvp.displayName);
    onPayload(await fetchPublicGameNight(token, username === null ? rsvp.id : undefined));
  }

  async function reply(status: RsvpStatus) {
    if (busy) return;
    const trimmed = name.trim();
    if (needsName && trimmed.length === 0) {
      setFormError('Enter your name.');
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
      setFormError(userMessage(err, "Couldn't save your RSVP."));
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
    <div className="shared-view game-night-view">
      <header className="shared-view-header">
        <p className="shared-view-owner">Game night hosted by {night.hostUsername}</p>
        <h1 className={`shared-view-title${cancelled ? ' is-cancelled' : ''}`}>{night.title}</h1>
        {cancelled && (
          <p className="game-night-cancelled" role="status">
            <Chip className="game-night-cancelled-badge" tone="err">
              Cancelled
            </Chip>
            This game night was cancelled.
          </p>
        )}
        {over && (
          <p className="game-night-cancelled" role="status">
            <Chip className="game-night-cancelled-badge" tone="err">
              Over
            </Chip>
            This game night has already happened.
          </p>
        )}
      </header>

      <dl className="game-night-facts">
        <div className="game-night-fact">
          <dt>When</dt>
          <dd>{polling ? `Being decided · ${options.length} times proposed` : when}</dd>
        </div>
        {night.series !== null && night.series.endedAt === null && (
          <div className="game-night-fact">
            <dt>Repeats</dt>
            <dd>Weekly</dd>
          </div>
        )}
        {night.format && (
          <div className="game-night-fact">
            <dt>Format</dt>
            <dd>{gameFormatLabel(night.format)}</dd>
          </div>
        )}
        {night.venue === 'online' && (
          <div className="game-night-fact">
            <dt>Played</dt>
            <dd>Online, with a join code from the host.</dd>
          </div>
        )}
        {night.location && (
          <div className="game-night-fact">
            <dt>Where</dt>
            <dd>
              <a
                className="game-night-map-link"
                href={mapsSearchUrl(night.location)}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open "${night.location}" in Google Maps`}
              >
                {night.location}
              </a>
            </dd>
          </div>
        )}
        {night.notes && (
          <div className="game-night-fact">
            <dt>Notes</dt>
            <dd>{night.notes}</dd>
          </div>
        )}
      </dl>

      {!closed && !canRsvp && (
        <section
          className="game-night-reply"
          aria-label={night.inviteOnly ? 'Invite only' : "Can't reply"}
        >
          <h2 className="game-night-section-title">
            {polling ? 'Which times can you make?' : 'Can you make it?'}
          </h2>
          <p className="game-night-invite-only-note" role="status">
            {night.inviteOnly
              ? `This night is invite-only. Ask ${night.hostUsername} for an invite link.`
              : "You can't reply to this game night."}
          </p>
          {polling && <NightPoll options={options} />}
        </section>
      )}

      {!closed && canRsvp && polling && (
        <section className="game-night-reply" aria-label="Vote on a date">
          <h2 className="game-night-section-title">
            {myRsvp ? 'Your votes' : 'Which times can you make?'}
          </h2>
          {username !== null ? (
            <p className="game-night-reply-as">Voting as {username}</p>
          ) : (
            <GuestNameField value={name} onChange={setName} />
          )}
          <NightPoll
            options={options}
            onVote={(optionIds) =>
              pollWrite((identity) => voteGameNight(token, { optionIds, ...identity }))
            }
            onSuggest={(startsAt) =>
              pollWrite((identity) => suggestGameNightOption(token, { startsAt, ...identity }))
            }
          />
        </section>
      )}

      {!closed && canRsvp && !polling && (
        <section className="game-night-reply" aria-label="Your reply">
          <h2 className="game-night-section-title">{myRsvp ? 'Your reply' : 'Can you make it?'}</h2>
          {username !== null ? (
            <p className="game-night-reply-as">Replying as {username}</p>
          ) : (
            <GuestNameField value={name} onChange={setName} />
          )}
          <div className="game-night-status-btns" role="group" aria-label="RSVP">
            {STATUS_LABELS.map(({ status, label }) => (
              <Button
                key={status}
                className={`game-night-status-btn${myRsvp?.status === status ? ' is-selected' : ''}`}
                aria-pressed={myRsvp?.status === status}
                disabled={busy !== null}
                onClick={() => void reply(status)}
              >
                {busy === status ? 'Saving…' : label}
              </Button>
            ))}
          </div>
          {formError && (
            <p className="game-night-form-error" role="alert">
              {formError}
            </p>
          )}
        </section>
      )}

      {!closed && !polling && (
        <section className="game-night-calendar" aria-label="Add to calendar">
          <h2 className="game-night-section-title">Add it to your calendar</h2>
          <div className="game-night-calendar-btns">
            <OverflowMenu
              ariaLabel="Add this game night to your calendar"
              triggerClassName={`${buttonClass()} game-night-cal-trigger`}
              align="left"
              trigger={
                <>
                  <CalendarPlus width={16} height={16} strokeWidth={2} aria-hidden />
                  Add to calendar
                  <ChevronDown width={14} height={14} strokeWidth={1.8} aria-hidden />
                </>
              }
              items={[
                {
                  label: 'Google Calendar',
                  onClick: () =>
                    window.open(googleCalendarUrl(calendarEvent), '_blank', 'noopener,noreferrer'),
                },
                {
                  label: 'Apple / Outlook (.ics)',
                  onClick: () =>
                    downloadIcs(calendarEvent, `${token}@spellcontrol.com`, 'game-night.ics'),
                },
              ]}
            />
          </div>
        </section>
      )}

      {!polling && <AttendeeList rsvps={rsvps} />}
    </div>
  );
}

function GuestNameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="game-night-name-field">
      <span>Your name</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={40}
        placeholder="Pat"
        autoComplete="name"
      />
    </label>
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
                  {r.isHost && (
                    <Chip className="game-night-host-pill" tone="neutral">
                      Host
                    </Chip>
                  )}
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
