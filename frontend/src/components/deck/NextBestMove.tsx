import type { JSX } from 'react';
import './NextBestMove.css';
import { ArrowRight, Loader2, Sparkles } from 'lucide-react';
import type { NextBestMove } from '@/deck-builder/services/deckBuilder/nextBestMove';
import type { DeckView } from './DeckDisplay';

/** Human-readable destination names for the navigate button's aria-label. */
const VIEW_LABELS: Record<DeckView, string> = {
  deck: 'Deck',
  stats: 'Stats',
  power: 'Power',
  tune: 'Tune',
};

export interface NextBestMoveProps {
  moves: NextBestMove[];
  /** Deep-link to an analysis view; `focus` optionally targets a panel within it. */
  onNavigate?: (view: DeckView, focus?: NextBestMove['focus']) => void;
  /** Near-miss combos load async (server round-trip), so the "Complete a combo"
   *  move arrives a beat after the rest. While that's in flight, hold a slot
   *  with a placeholder so the suggestion doesn't pop in unannounced. */
  combosLoading?: boolean;
}

/**
 * Presentational list of the top deck-improvement moves (max 3). Each row gets
 * a tier-tinted rank chip, title, detail, and — when the move deep-links to an
 * analysis view — a navigate button. Renders a compact healthy state when
 * there's nothing to suggest. All copy/numbers come from `moves`.
 */
export function NextBestMove({ moves, onNavigate, combosLoading }: NextBestMoveProps): JSX.Element {
  const shown = moves.slice(0, 3);
  // Hold a slot for a still-loading combo suggestion — but only when there's
  // room (the list caps at 3) and no combo move is already shown.
  const showComboLoading =
    !!combosLoading && shown.length < 3 && !shown.some((m) => m.focus === 'combos');

  if (moves.length === 0 && !showComboLoading) {
    return (
      <section className="next-best-move is-clear" aria-label="Next best move">
        <Sparkles className="next-best-move-clear-icon" aria-hidden="true" />
        <p className="next-best-move-clear-text">Looks dialed in — no changes to suggest.</p>
      </section>
    );
  }

  return (
    <section className="next-best-move" aria-label="Next best move">
      <header className="next-best-move-header">
        <Sparkles className="next-best-move-header-icon" aria-hidden="true" />
        <span className="next-best-move-header-label">Next best move</span>
      </header>
      <ol className="next-best-move-list">
        {shown.map((move, i) => (
          <li
            key={move.id}
            className={`next-best-move-row is-tier-${move.tier}${i === 0 ? ' is-primary' : ''}`}
          >
            <span className="next-best-move-rank" aria-hidden="true">
              {i + 1}
            </span>
            <div className="next-best-move-body">
              <p className="next-best-move-title">{move.title}</p>
              <p className="next-best-move-detail">{move.detail}</p>
            </div>
            {move.navigateTo && onNavigate && (
              <button
                type="button"
                className="next-best-move-nav"
                onClick={() => onNavigate(move.navigateTo!, move.focus)}
                aria-label={`Go to ${VIEW_LABELS[move.navigateTo]}`}
              >
                <span className="next-best-move-nav-label">{VIEW_LABELS[move.navigateTo]}</span>
                <ArrowRight className="next-best-move-nav-icon" aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
        {showComboLoading && (
          <li className="next-best-move-row is-tier-3 is-loading" aria-live="polite">
            <span className="next-best-move-rank" aria-hidden="true">
              <Loader2 className="next-best-move-spinner" aria-hidden="true" />
            </span>
            <div className="next-best-move-body">
              <p className="next-best-move-title">Checking for combos…</p>
              <p className="next-best-move-detail">Scanning your deck for near-miss combos.</p>
            </div>
          </li>
        )}
      </ol>
    </section>
  );
}
