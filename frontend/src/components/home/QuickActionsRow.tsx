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
 * Lives inside the hero band (HomeHero.tsx) — at ≤600px the labels hide and
 * the row goes icon-only (the audit's density directive), so every action
 * carries its own `aria-label` rather than relying on the now-hidden text.
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
        <span>Import cards</span>
      </button>
      <Link to="/decks/new" className="pill-btn home-quick-action" aria-label="New deck">
        <Plus width={14} height={14} strokeWidth={1.8} aria-hidden />
        <span>New deck</span>
      </Link>
      <Link
        to="/play?tab=nights"
        className="pill-btn home-quick-action"
        aria-label="Plan a game night"
      >
        <CalendarPlus width={14} height={14} strokeWidth={1.8} aria-hidden />
        <span>Plan a game night</span>
      </Link>
      {addOpen && <AddCardsSheet onClose={() => setAddOpen(false)} />}
    </div>
  );
}
