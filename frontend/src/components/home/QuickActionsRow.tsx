import './QuickActionsRow.css';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, Plus, CalendarPlus } from 'lucide-react';
import { AddCardsSheet } from '../AddCardsSheet';

/**
 * Home's page-hero-tier action row: three pill CTAs for the three fastest
 * paths into the app. "Import cards" opens the same portable AddCardsSheet
 * used by the Collection page's own "Add cards" action, inline — no page hop.
 *
 * Lives inside the hero band (HomeHero.tsx) — labels stay visible at every
 * width (the icon-only ≤600px density cut shipped and failed on device: three
 * bare glyphs read as meaningless); ≤600px swaps to a short label instead.
 * Each aria-label matches its long label so the accessible name always
 * contains the visible text at either width.
 */
export function QuickActionsRow() {
  const [addOpen, setAddOpen] = useState(false);

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
      {addOpen && <AddCardsSheet onClose={() => setAddOpen(false)} />}
    </div>
  );
}
