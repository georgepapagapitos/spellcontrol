import { useId, useState, type JSX } from 'react';
import { ChevronDown } from 'lucide-react';
import './WhyBreakdown.css';
import type { WhyFactor } from '@/lib/why-factors';

export interface WhyBreakdownProps {
  /** The grounded reasoning bullets. Empty → renders nothing. */
  factors: WhyFactor[];
  /**
   * Toggle copy when collapsed. Defaults to "Why this?". Pass a contextual
   * prompt like "Why swap this in?" so the affordance reads in place.
   */
  label?: string;
}

/**
 * A tappable "why" disclosure for a cut/swap suggestion: a quiet toggle that
 * expands to the engine's grounded, tone-tagged reasoning. The differentiation
 * moat made legible — turns an opaque one-liner ("Overlapping role") into the
 * knowledgeable-partner explanation behind it.
 *
 * Presentational + theme-token driven, so it inherits the white-alpha remap on
 * the always-dark card-preview panel as well as the light Tune lanes. Collapsed
 * by default (the row stays scannable); the heavy reasoning is opt-in.
 */
export function WhyBreakdown({
  factors,
  label = 'Why this?',
}: WhyBreakdownProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (factors.length === 0) return null;

  return (
    <div className="why-breakdown">
      <button
        type="button"
        className="why-breakdown-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown
          className="why-breakdown-chevron"
          data-open={open}
          aria-hidden
          width={13}
          height={13}
        />
        {open ? 'Hide reasoning' : label}
      </button>
      {open && (
        <ul id={listId} className="why-breakdown-list">
          {factors.map((f, i) => (
            <li key={i} className="why-breakdown-item" data-tone={f.tone}>
              <span className="why-breakdown-dot" aria-hidden />
              <span className="why-breakdown-text">{f.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
