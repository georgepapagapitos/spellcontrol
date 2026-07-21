import './HomePage.css';
import { QuickActionsRow } from '../components/home/QuickActionsRow';
import { ActivityStripCard } from '../components/home/ActivityStripCard';
import { NewFromFriendsCard } from '../components/home/NewFromFriendsCard';
import { DiscoverCard } from '../components/home/DiscoverCard';
import { RecentDecksCard } from '../components/home/RecentDecksCard';
import { GameNightCard } from '../components/home/GameNightCard';
import { ValueMoversCard } from '../components/home/ValueMoversCard';
import { NewArrivalsCard } from '../components/home/NewArrivalsCard';
import { BinderReviewCard } from '../components/home/BinderReviewCard';

/**
 * The /home dashboard (social program W3). Reachable by direct URL only for
 * now — not yet the default landing (that flip is w3-nav-activation). Quick
 * Actions render immediately; the bento grid holds the three social cards
 * (activity/friends/discover) plus the five signal cards (decks/game
 * nights/value/arrivals/binder review) — each card reads state the app
 * already computes elsewhere, never a re-capture.
 */
export function HomePage() {
  return (
    <div className="home-page">
      <h1 className="binder-hero-name">Home</h1>
      <QuickActionsRow />
      <div className="deck-bento home-bento">
        <ActivityStripCard />
        <NewFromFriendsCard />
        <DiscoverCard />
        <RecentDecksCard />
        <GameNightCard />
        <ValueMoversCard />
        <NewArrivalsCard />
        <BinderReviewCard />
      </div>
    </div>
  );
}
