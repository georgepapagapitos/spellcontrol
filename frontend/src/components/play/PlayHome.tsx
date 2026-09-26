import './PlayHome.css';
import { CalendarDays, KeyRound, Radio, Swords, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GameNight } from '../../lib/game-nights-api';
import type { GameRecord, GameState } from '../../lib/game-state';
import { gameFormatLabel } from '../../lib/game-formats';
import { aggregateDeckRecords } from '../../store/play';
import { Button } from '@/components/shared/Button';

export type PlayHomeTarget =
  | { tab: 'local' }
  | { tab: 'online'; mode?: 'host' | 'join' | 'browse' }
  | { tab: 'nights' }
  | { tab: 'history' };

interface Props {
  local: GameState | null;
  online: GameState | null;
  history: GameRecord[];
  userId: string | null;
  isGuest: boolean;
  nights: GameNight[];
  nightsLoading: boolean;
  /** Open a section of the page. */
  go: (target: PlayHomeTarget) => void;
  /** Bring a minimized local board back and open it. */
  resumeLocal: () => void;
}

const RECENT_LIMIT = 3;

/**
 * The Play landing: what's live, the three doors, the next game night, the
 * last few games and a one-line record. Everything here is a read of state
 * the page already holds — the doors are the only thing that starts anything,
 * and they only open a section, never a game.
 */
export function PlayHome({
  local,
  online,
  history,
  userId,
  isGuest,
  nights,
  nightsLoading,
  go,
  resumeLocal,
}: Props) {
  // Read once at mount: "upcoming" is judged when the page opens, not on
  // every re-render (the purity rule), and a night doesn't slip into the past
  // while you look at it.
  const [now] = useState(() => Date.now());
  const nextNight = useMemo(() => {
    return (
      nights
        .filter((n) => n.cancelledAt === null && n.startsAt >= now && n.myStatus !== 'declined')
        .sort((a, b) => a.startsAt - b.startsAt)[0] ?? null
    );
  }, [nights, now]);

  const recent = history.slice(0, RECENT_LIMIT);
  const record = useMemo(() => summarizeRecord(history, userId), [history, userId]);

  return (
    <div className="play-home">
      {(local || online) && (
        <section className="play-home-live" aria-label="Game in progress">
          {local && (
            <LiveGameRow
              label="Local game"
              game={local}
              cta={local.status === 'finished' ? 'Open' : 'Resume'}
              onOpen={resumeLocal}
            />
          )}
          {online && (
            <LiveGameRow
              label={`Online game ${online.code}`}
              game={online}
              cta="Open"
              onOpen={() => go({ tab: 'online' })}
            />
          )}
        </section>
      )}

      <section className="play-home-doors" aria-label="Start playing">
        <button type="button" className="play-home-door" onClick={() => go({ tab: 'local' })}>
          <Swords width={20} height={20} strokeWidth={1.8} aria-hidden />
          <span className="play-home-door-title">Track a table</span>
          <span className="play-home-door-sub">One phone for every seat. No account needed.</span>
        </button>
        <button
          type="button"
          className="play-home-door"
          onClick={() => go({ tab: 'online', mode: 'host' })}
        >
          <Radio width={20} height={20} strokeWidth={1.8} aria-hidden />
          <span className="play-home-door-title">Host online</span>
          <span className="play-home-door-sub">
            {isGuest ? 'Needs an account.' : 'Everyone on their own device, with a join code.'}
          </span>
        </button>
        <button
          type="button"
          className="play-home-door"
          onClick={() => go({ tab: 'online', mode: 'join' })}
        >
          <KeyRound width={20} height={20} strokeWidth={1.8} aria-hidden />
          <span className="play-home-door-title">Join with a code</span>
          <span className="play-home-door-sub">
            {isGuest ? 'Needs an account.' : 'Take your seat at a table someone else hosts.'}
          </span>
        </button>
        <button
          type="button"
          className="play-home-door"
          onClick={() => go({ tab: 'online', mode: 'browse' })}
        >
          <Users width={20} height={20} strokeWidth={1.8} aria-hidden />
          <span className="play-home-door-title">Browse games</span>
          <span className="play-home-door-sub">
            {isGuest ? 'Needs an account.' : 'Public tables, no code needed.'}
          </span>
        </button>
      </section>

      {!isGuest && (
        <section className="play-home-card" aria-labelledby="play-home-night-title">
          <header className="play-home-card-head">
            <h2 id="play-home-night-title" className="play-home-card-title">
              <CalendarDays width={16} height={16} strokeWidth={2} aria-hidden />
              Next game night
            </h2>
            <button
              type="button"
              className="play-home-card-link"
              onClick={() => go({ tab: 'nights' })}
            >
              {nextNight ? 'All nights' : 'Plan one'}
            </button>
          </header>
          {nightsLoading && nights.length === 0 ? (
            <p className="play-home-muted">Loading…</p>
          ) : nextNight ? (
            <div className="play-home-night">
              <span className="play-home-night-title">{nextNight.title}</span>
              <span className="play-home-night-when">
                {new Date(nextNight.startsAt).toLocaleString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                {nextNight.format ? ` · ${gameFormatLabel(nextNight.format)}` : ''}
                {nextNight.venue === 'online' ? ' · Online' : ''}
                {nextNight.isHost ? ' · You host' : ` · ${nextNight.hostUsername} hosts`}
              </span>
            </div>
          ) : (
            <p className="play-home-muted">Nothing on the calendar.</p>
          )}
        </section>
      )}

      <section className="play-home-card" aria-labelledby="play-home-recent-title">
        <header className="play-home-card-head">
          <h2 id="play-home-recent-title" className="play-home-card-title">
            Recent games
          </h2>
          {history.length > 0 && (
            <button
              type="button"
              className="play-home-card-link"
              onClick={() => go({ tab: 'history' })}
            >
              All games
            </button>
          )}
        </header>
        {record && (
          <dl className="play-home-record" aria-label="Your record">
            <div>
              <dt>Games</dt>
              <dd>{record.played}</dd>
            </div>
            {record.winRate !== null && (
              <div>
                <dt>Win rate</dt>
                <dd>{Math.round(record.winRate * 100)}%</dd>
              </div>
            )}
            {record.topDeck && (
              <div>
                <dt>Most played</dt>
                <dd>{record.topDeck}</dd>
              </div>
            )}
          </dl>
        )}
        {recent.length === 0 ? (
          <p className="play-home-muted">No games yet. Pick a door above.</p>
        ) : (
          <ul className="play-home-recent">
            {recent.map((rec) => {
              const winner =
                rec.winnerSeat != null
                  ? (rec.players.find((p) => p.seat === rec.winnerSeat) ?? null)
                  : null;
              return (
                <li key={rec.id} className="play-home-recent-row">
                  <span className="play-home-recent-main">
                    {winner ? `${winner.name} won` : 'No winner'}
                    <span className="play-home-recent-format">
                      {' '}
                      · {gameFormatLabel(rec.format)} · {rec.mode}
                    </span>
                  </span>
                  <span className="play-home-recent-when">
                    {new Date(rec.endedAt).toLocaleDateString()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function LiveGameRow({
  label,
  game,
  cta,
  onOpen,
}: {
  label: string;
  game: GameState;
  cta: string;
  onOpen: () => void;
}) {
  return (
    <div className="play-home-live-row">
      <div className="play-home-live-body">
        <span className="play-home-live-label">
          {label}
          <span className="play-home-live-status"> · {game.status}</span>
        </span>
        <span className="play-home-live-players">
          {game.players.map((p) => p.name).join(' · ')}
        </span>
      </div>
      <Button variant="primary" onClick={onOpen}>
        {cta}
      </Button>
    </div>
  );
}

/**
 * One line of record for the dashboard. Signed in, wins are the seats this
 * account held; a guest's device has no "you", so it gets games tracked and
 * the most-played deck only, never a made-up win rate.
 */
function summarizeRecord(
  history: GameRecord[],
  userId: string | null
): { played: number; winRate: number | null; topDeck: string | null } | null {
  if (history.length === 0) return null;
  let winRate: number | null = null;
  if (userId) {
    let decided = 0;
    let wins = 0;
    for (const rec of history) {
      const mine = rec.players.find((p) => p.userId === userId);
      if (!mine || rec.winnerSeat === null) continue;
      decided += 1;
      if (rec.winnerSeat === mine.seat) wins += 1;
    }
    winRate = decided > 0 ? wins / decided : null;
  }
  const topDeck = aggregateDeckRecords(history, userId)[0]?.deckName ?? null;
  return { played: history.length, winRate, topDeck };
}
