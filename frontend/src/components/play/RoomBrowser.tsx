import './RoomBrowser.css';
import { useCallback, useEffect, useState } from 'react';
import { EmptyStateMark } from '../shared/EmptyStateMark';
import { listGames, type GameListing } from '../../lib/games-api';
import { gameFormatLabel } from '../../lib/game-formats';
import { userMessage } from '../../lib/user-error';

interface Props {
  /** Claim a seat at this code — routed through the same `joinOnline` the
   *  code-entry Join form already uses (see PlayPage's OnlineSetup). */
  onJoin: (code: string) => void;
  /** Watch this code without a seat — the same `watchOnline` the code-entry
   *  form's "Watch without a seat" button already uses. */
  onWatch: (code: string) => void;
  /** The empty state's one next step: switch to the Host form. */
  onHostInstead: () => void;
}

/**
 * Board E367 — a browser for public games, so spectating and joining are
 * reachable without someone handing you a code. Lives as a third mode of
 * `OnlineSetup` (Host / Join / Browse), reusing its existing `onJoin`/
 * `onWatch` transport — this component only lists rows and dispatches to
 * them, it never talks to the game-session API beyond `GET /api/games`.
 */
export function RoomBrowser({ onJoin, onWatch, onHostInstead }: Props) {
  const [games, setGames] = useState<GameListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // setState only inside promise callbacks, never synchronously in the body
  // (react-hooks/set-state-in-effect) — same shape as useGameNights
  // (components/play/GameNights.tsx). `loading` starts true and only the
  // mount effect's call to this ever sees it; a later Retry re-fetches
  // straight into the error/list swap without a second loading flash.
  const refresh = useCallback((): Promise<void> => {
    return listGames()
      .then((rows) => {
        setGames(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(userMessage(err, "Couldn't load public games."));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return <p className="room-browser-status">Loading public games…</p>;
  }

  if (error) {
    return (
      <div className="discover-decks-error" role="alert">
        <span>{error}</span>
        <button type="button" className="discover-decks-error-retry" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="empty-state">
        <EmptyStateMark />
        <p className="empty-state-tagline">No public games right now.</p>
        <p className="empty-state-hint">
          Host a table and set it to public, or ask the host for a join code.
        </p>
        <div className="empty-state-actions">
          <button type="button" className="btn btn-primary" onClick={onHostInstead}>
            Host a table
          </button>
        </div>
      </div>
    );
  }

  return (
    <ul className="room-browser-list" aria-label="Public games">
      {games.map((g) => (
        <li key={g.code} className="room-browser-row">
          <div className="room-browser-row-main">
            <span className="room-browser-row-name">{g.name}</span>
            <span className="room-browser-row-meta">
              {gameFormatLabel(g.format)} · {g.seated}/{g.max} seated
              {/* Board E370: computed from the seated decks, not the host's
                  word — see GameListing.bracket's doc. Absent (no seated
                  deck has a known one yet) renders nothing, never a guess. */}
              {g.bracket && (
                <span className="room-browser-bracket">
                  Bracket{' '}
                  {g.bracket.min === g.bracket.max
                    ? g.bracket.min
                    : `${g.bracket.min}-${g.bracket.max}`}
                </span>
              )}
              {g.status === 'active' && <span className="room-browser-live">Game started</span>}
            </span>
          </div>
          {g.status === 'active' ? (
            <button
              type="button"
              className="btn room-browser-action"
              onClick={() => onWatch(g.code)}
            >
              Spectate
            </button>
          ) : g.joinable ? (
            <button
              type="button"
              className="btn btn-primary room-browser-action"
              onClick={() => onJoin(g.code)}
            >
              Join
            </button>
          ) : (
            <button type="button" className="btn room-browser-action" disabled>
              Full
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
