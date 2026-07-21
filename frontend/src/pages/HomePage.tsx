import './HomePage.css';
import { QuickActionsRow } from '../components/home/QuickActionsRow';

/**
 * The /home dashboard (social program W3). Reachable by direct URL only for
 * now — not yet the default landing (that flip is w3-nav-activation). Quick
 * Actions render immediately; the bento grid is genuinely empty until the
 * signal/social card PRs each add one <XCard/> line to it.
 */
export function HomePage() {
  return (
    <div className="home-page">
      <h1 className="binder-hero-name">Home</h1>
      <QuickActionsRow />
      <div className="deck-bento home-bento" />
    </div>
  );
}
