import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { DeckPickerDialog, type PickedDeck } from './DeckPickerDialog';
import type { Deck } from '../../store/decks';
import { ColorPip } from '../shared/ManaSymbol';

/**
 * The three small controls the play-setup forms and the online lobby both
 * use. They live here rather than in `PlayPage` so the lobby can reuse them
 * without importing the page that renders it (see memory: push the leaf
 * down, never create an import cycle). Their styles stay in
 * `styles/play-setup.css`, which PlayPage's chunk loads.
 */
export function Stepper({
  value,
  min,
  max,
  step = 1,
  ariaLabelledBy,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  ariaLabelledBy?: string;
  onChange: (next: number) => void;
}) {
  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(Math.min(max, value + step));
  return (
    <div className="play-stepper" role="group" aria-labelledby={ariaLabelledBy}>
      <button
        type="button"
        className="play-stepper-btn"
        onClick={dec}
        aria-label="Decrease"
        disabled={value <= min}
      >
        −
      </button>
      <span className="play-stepper-value" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="play-stepper-btn"
        onClick={inc}
        aria-label="Increase"
        disabled={value >= max}
      >
        +
      </button>
    </div>
  );
}

export function RulePill({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`play-rule-pill ${on ? 'is-on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="play-rule-pill-label">{label}</span>
      <span className="play-rule-pill-hint">{hint}</span>
      <span className="play-rule-pill-state" aria-hidden="true">
        {on ? 'On' : 'Off'}
      </span>
    </button>
  );
}

// A seat's color-identity pips — the deck's colors are game information, so
// the roster shows them the moment a deck is picked. WUBRG order, always.
const WUBRG_ORDER = ['W', 'U', 'B', 'R', 'G'];

export function SeatPips({ ci }: { ci: string[] }) {
  if (ci.length === 0) return null;
  const sorted = [...ci].sort((a, b) => WUBRG_ORDER.indexOf(a) - WUBRG_ORDER.indexOf(b));
  return (
    <span className="play-seat-ci" aria-hidden="true">
      {sorted.map((c) => (
        <ColorPip key={c} color={c} />
      ))}
    </span>
  );
}

/**
 * Opens the deck picker for a seat. The control is a button rather than a
 * select because what it opens is no longer only your own decks — the
 * starter-deck catalog is searched on the server and is far too long for a
 * select, and an account with no decks needs somewhere to go.
 */
export function DeckPicker({
  decks,
  value,
  valueName,
  onChange,
}: {
  decks: Deck[];
  value: string | null;
  /** Name of the currently picked deck — a starter is not in `decks`. */
  valueName: string | null;
  onChange: (picked: PickedDeck | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="play-deck-picker-trigger"
        aria-label="Deck"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className="play-deck-picker-value">{valueName ?? 'Pick a deck'}</span>
        <ChevronDown width={14} height={14} strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <DeckPickerDialog
          decks={decks}
          value={value}
          onPick={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
