import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import type { ChangeOwnership } from '@/lib/coach/deck-change';
import './SuggestionSection.css';

/**
 * Open or closed, remembered per section across cards and visits. Closed by
 * default: the card preview is for reading the card, so suggestions wait until
 * asked for, and someone who keeps them open isn't made to reopen them per card.
 */
export function useRememberedOpen(storageKey: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      if (next) localStorage.setItem(storageKey, '1');
      else localStorage.removeItem(storageKey);
    } catch {
      // Private mode: the choice lasts for this card only.
    }
  };
  return [open, toggle];
}

/** "6 options · 2 in your collection": what a closed section holds. */
export function suggestionSummary(
  count: number,
  noun: [string, string],
  ownership: ChangeOwnership[]
): string {
  const inCollection = ownership.filter((o) => o && o !== 'unowned').length;
  const head = `${count} ${count === 1 ? noun[0] : noun[1]}`;
  return inCollection > 0 ? `${head} · ${inCollection} in your collection` : head;
}

/**
 * A suggestion group in the card-preview panel (Swap this card, Similar cards):
 * a heading row that states what's inside while closed, and the rows below it
 * once opened. The rows aren't mounted while closed, so their art doesn't load.
 */
export function SuggestionSection({
  className,
  label,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  /** The section's own class, for its spacing and rule. */
  className: string;
  /** Accessible name for the section landmark. */
  label: string;
  title: string;
  /** Shown while closed. */
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <section className={`suggestion-section ${className}`} aria-label={label}>
      <h4 className="suggestion-section-heading">
        <button
          type="button"
          className="suggestion-section-toggle"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={onToggle}
        >
          <span className="suggestion-section-title">{title}</span>
          {!open && <span className="suggestion-section-summary">{summary}</span>}
          <ChevronDown
            width={14}
            height={14}
            strokeWidth={1.8}
            aria-hidden
            className="suggestion-section-chevron"
          />
        </button>
      </h4>
      {open && (
        <div id={bodyId} className="suggestion-section-body">
          {children}
        </div>
      )}
    </section>
  );
}
