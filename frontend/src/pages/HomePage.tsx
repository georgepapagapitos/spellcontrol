import './HomePage.css';
import { QuickActionsRow } from '../components/home/QuickActionsRow';
import { ActivityStripCard } from '../components/home/ActivityStripCard';
import { NewFromFriendsCard } from '../components/home/NewFromFriendsCard';
import { DiscoverCard } from '../components/home/DiscoverCard';

/**
 * The /home dashboard (social program W3). Reachable by direct URL only for
 * now — not yet the default landing (that flip is w3-nav-activation). Quick
 * Actions render immediately; the bento grid holds the three social cards
 * (this PR) — the signal cards land alongside as their own sibling PR adds
 * its own <XCard/> lines to the same grid.
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
      </div>
    </div>
  );
}
