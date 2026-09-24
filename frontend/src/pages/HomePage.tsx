import './HomePage.css';
import { HomeHero } from '../components/home/HomeHero';
import { WaitingOnYou } from '../components/home/WaitingOnYou';
import { YourDecks } from '../components/home/YourDecks';
import { PriceMoversCard } from '../components/home/PriceMoversCard';
import { RecentlyAddedCard } from '../components/home/RecentlyAddedCard';
import { AroundTheTable } from '../components/home/AroundTheTable';
import { DiscoverRow } from '../components/home/DiscoverRow';
import { useGameNights } from '../components/play/GameNights';
import { useActivity } from '../lib/use-activity';
import { useAuth } from '../store/auth';

/**
 * /home — the default landing for signed-in users (App.tsx routes both `/`
 * and the catch-all here for them); reachable by direct URL for guests.
 *
 * Read top to bottom it answers, in order: what needs me (Waiting on you),
 * what was I working on (Your decks), what changed (Price movers, Recently
 * added), who's around (Around the table), and what others are building
 * (Discover). The hero above them is the collection itself.
 *
 * It replaced a bento of nine equal cards, several of which said the same
 * thing twice and a quarter of which were empty rows (STYLE_GUIDE § Home).
 * Anything with nothing to show renders nothing, so the page is as long as
 * what it has to say.
 *
 * Game nights and the activity feed are read once here: two sections use
 * each, and both hooks fetch per call.
 */
export function HomePage() {
  const guest = useAuth((s) => s.status === 'guest');
  const nights = useGameNights(!guest);
  const activity = useActivity();

  return (
    <div className="home-page">
      <HomeHero />
      <WaitingOnYou
        actionRequired={activity.actionRequired}
        activityLoading={activity.loading}
        nights={nights.nights}
        nightsLoading={nights.loading}
      />
      <YourDecks />
      <div className="home-band">
        <PriceMoversCard />
        <RecentlyAddedCard />
      </div>
      <AroundTheTable
        nights={nights.nights}
        nightsLoading={nights.loading}
        nightsError={nights.error}
        refreshNights={nights.refresh}
        recent={activity.recent}
        activityLoading={activity.loading}
      />
      <DiscoverRow />
    </div>
  );
}
