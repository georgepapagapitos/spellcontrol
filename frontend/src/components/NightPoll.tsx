import { useState } from 'react';
import type { NightOption } from '../lib/game-nights-api';
import './NightPoll.css';

/** Mirrors the backend MAX_OPTIONS cap — hide the suggest form once full. */
const POLL_MAX = 8;

export function formatSlot(startsAt: number): string {
  return new Date(startsAt).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Date poll for a game night (E124): candidate slots as multi-select
 * checkmarks ("I can make this slot"), per-slot tallies with voter names,
 * a suggest-another-time form, and — for the host — a lock-in button per
 * slot. Used by both the public /gn/:token page and the Play-tab card;
 * callbacks throw with a user-facing message to surface an inline error.
 */
export function NightPoll({
  options,
  onVote,
  onSuggest,
  onLock,
}: {
  options: NightOption[];
  /** Replace the caller's full vote set. Omit for a read-only tally view
   *  (e.g. an invite-only night the viewer can't reply to). */
  onVote?: (optionIds: string[]) => Promise<void>;
  /** Propose an extra slot. Omitted together with onVote. */
  onSuggest?: (startsAt: number) => Promise<void>;
  /** Host only — parent confirms before locking. */
  onLock?: (option: NightOption) => void;
}) {
  const readOnly = onVote === undefined;
  // null = mirror the server's myVote flags; a Set = unsaved local edits.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [suggestAt, setSuggestAt] = useState('');
  const [busy, setBusy] = useState<'vote' | 'suggest' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effective = selected ?? new Set(options.filter((o) => o.myVote).map((o) => o.id));

  function toggle(id: string) {
    const next = new Set(effective);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function save() {
    if (busy || selected === null || !onVote) return;
    setBusy('vote');
    setError(null);
    try {
      await onVote([...selected]);
      setSelected(null); // back to mirroring the (refreshed) server state
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your votes.");
    } finally {
      setBusy(null);
    }
  }

  async function suggest() {
    if (busy || !onSuggest) return;
    const startsAt = suggestAt ? new Date(suggestAt).getTime() : NaN;
    if (!Number.isFinite(startsAt)) {
      setError('Pick a date and time to suggest.');
      return;
    }
    setBusy('suggest');
    setError(null);
    try {
      await onSuggest(startsAt);
      setSuggestAt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't suggest that time.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="night-poll">
      <ul className="night-poll-options">
        {options.map((o) => (
          <li key={o.id} className="night-poll-option">
            <label className="night-poll-check">
              <input
                type="checkbox"
                checked={effective.has(o.id)}
                disabled={readOnly || busy !== null}
                onChange={() => toggle(o.id)}
              />
              <span className="night-poll-when">
                <time dateTime={new Date(o.startsAt).toISOString()}>{formatSlot(o.startsAt)}</time>
                {o.proposedBy && (
                  <span className="night-poll-proposed">suggested by {o.proposedBy}</span>
                )}
              </span>
            </label>
            <p className="night-poll-tally">
              {o.voters.length === 0
                ? 'No votes yet'
                : `${o.voters.length} can make it — ${o.voters.join(', ')}`}
            </p>
            {onLock && (
              <button
                type="button"
                className="btn night-poll-lock-btn"
                disabled={busy !== null}
                onClick={() => onLock(o)}
              >
                Lock it in
              </button>
            )}
          </li>
        ))}
      </ul>

      {!readOnly && (
        <div className="night-poll-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null || selected === null}
            onClick={() => void save()}
          >
            {busy === 'vote' ? 'Saving…' : 'Save my votes'}
          </button>
        </div>
      )}

      {!readOnly && options.length < POLL_MAX && (
        <div className="night-poll-suggest">
          <label className="night-poll-suggest-field">
            <span>Suggest another time</span>
            <input
              type="datetime-local"
              value={suggestAt}
              disabled={busy !== null}
              onChange={(e) => setSuggestAt(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy !== null || suggestAt === ''}
            onClick={() => void suggest()}
          >
            {busy === 'suggest' ? 'Adding…' : 'Add time'}
          </button>
        </div>
      )}

      {error && (
        <p className="night-poll-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
