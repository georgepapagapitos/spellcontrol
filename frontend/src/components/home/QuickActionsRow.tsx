import './QuickActionsRow.css';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, Plus, CalendarPlus, Users } from 'lucide-react';
import { AddCardsSheet } from '../AddCardsSheet';
import { useActivity } from '../../lib/use-activity';

/**
 * Home's page-hero-tier action row: four pill CTAs for the fastest paths into
 * the app. "Import cards" opens the same portable AddCardsSheet used by the
 * Collection page's own "Add cards" action, inline — no page hop.
 *
 * "Friends" is the phone's front door to the social cluster (/friends and,
 * one tap on, its badged Trades and Pods doors). The mobile tab bar cannot
 * carry a 6th cell at 320px, and the activity badge on the Home tab already
 * points here — so the door belongs on the surface that badge lands on rather
 * than buried on /you, where #1474 explicitly took friends OUT of. Desktop,
 * which has header room, gets a real nav link instead (Header.tsx); this pill
 * stays at every width so the two never disagree about whether Friends is a
 * top-level thing.
 *
 * Lives inside the hero band (HomeHero.tsx) — labels stay visible at every
 * width (the icon-only ≤600px density cut shipped and failed on device: three
 * bare glyphs read as meaningless); ≤600px swaps to a short label instead.
 * Each aria-label matches its long label so the accessible name always
 * contains the visible text at either width.
 */
export function QuickActionsRow() {
  const [addOpen, setAddOpen] = useState(false);
  // Same bucket as the tab bar's badge, so the pill can never claim a
  // different number of waiting asks than the tab that led here. The
  // action-required subset only (friend requests + trade offers) — a deck
  // like isn't answered on /friends. Mirrors FriendsPage's own Trades door.
  const { actionRequired } = useActivity();

  return (
    <div className="home-quick-actions">
      <button
        type="button"
        className="pill-btn home-quick-action"
        aria-haspopup="dialog"
        aria-label="Import cards"
        onClick={() => setAddOpen(true)}
      >
        <Upload width={14} height={14} strokeWidth={1.8} aria-hidden />
        <span className="home-qa-label">Import cards</span>
        <span className="home-qa-label-short" aria-hidden="true">
          Import
        </span>
      </button>
      <Link to="/decks/new" className="pill-btn home-quick-action" aria-label="New deck">
        <Plus width={14} height={14} strokeWidth={1.8} aria-hidden />
        <span className="home-qa-label">New deck</span>
        <span className="home-qa-label-short" aria-hidden="true">
          New deck
        </span>
      </Link>
      <Link
        to="/play?tab=nights"
        className="pill-btn home-quick-action"
        aria-label="Plan a game night"
      >
        <CalendarPlus width={14} height={14} strokeWidth={1.8} aria-hidden />
        <span className="home-qa-label">Plan a game night</span>
        <span className="home-qa-label-short" aria-hidden="true">
          Game night
        </span>
      </Link>
      <Link
        to="/friends"
        className="pill-btn home-quick-action"
        aria-label={
          actionRequired.length > 0 ? `Friends, ${actionRequired.length} waiting on you` : 'Friends'
        }
      >
        <Users width={14} height={14} strokeWidth={1.8} aria-hidden />
        <span className="home-qa-label">Friends</span>
        <span className="home-qa-label-short" aria-hidden="true">
          Friends
        </span>
        {actionRequired.length > 0 && (
          <span className="friends-nav-link-badge" aria-hidden="true">
            {actionRequired.length}
          </span>
        )}
      </Link>
      {addOpen && <AddCardsSheet onClose={() => setAddOpen(false)} />}
    </div>
  );
}
