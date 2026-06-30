import { useId, useState, type JSX } from 'react';
import { ChevronDown } from 'lucide-react';
import './SubstituteOptions.css';
import { DeckCardRow } from './DeckCardRow';
import type { Change } from '@/lib/deck-change';

export interface SubstituteOptionsProps {
  /** Ranked owned alternatives that fill the same missing staple as the primary. */
  alternatives: Change[];
  /** Threaded to each alternative row for the inclusion line. */
  commanderName?: string;
  /** Open the carousel on an alternative card. */
  onPreview: (name: string) => void;
  /** Apply (add) an alternative. */
  onAct: (change: Change) => void;
  /** Is this alternative's apply in flight? */
  acting: (name: string) => boolean;
}

/**
 * The "N other owned options" expander beneath an owned-substitute primary row.
 * The collection lane already shows the single best owned card per missing
 * staple; this surfaces the ranked runners-up so the user can compare and pick
 * — the multi-option half of the explainable-customization moat. Each
 * alternative is a full <DeckCardRow>, so it carries its own grounded
 * <WhyBreakdown> and applies through the same path as any other suggestion.
 *
 * Collapsed by default — the feed stays scannable; alternatives are opt-in.
 */
export function SubstituteOptions({
  alternatives,
  commanderName,
  onPreview,
  onAct,
  acting,
}: SubstituteOptionsProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (alternatives.length === 0) return null;
  const n = alternatives.length;

  return (
    <div className="substitute-options">
      <button
        type="button"
        className="substitute-options-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown
          className="substitute-options-chevron"
          data-open={open}
          aria-hidden
          width={13}
          height={13}
        />
        {open ? 'Hide other options' : `${n} other owned option${n > 1 ? 's' : ''}`}
      </button>
      {open && (
        <ul id={listId} className="substitute-options-list">
          {alternatives.map((alt) => (
            <DeckCardRow
              key={alt.id}
              change={alt}
              commanderName={commanderName}
              peekName={alt.name}
              onPreview={() => onPreview(alt.name)}
              onAct={onAct}
              acting={acting(alt.name)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
