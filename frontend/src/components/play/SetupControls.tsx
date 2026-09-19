import { SelectMenu } from '../SelectMenu';
import { deckPickerLabels } from '../../lib/deck-picker-labels';
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

const DECK_PICKER_NONE = '__none__';

export function DeckPicker({
  decks,
  value,
  onChange,
}: {
  decks: Deck[];
  value: string | null;
  onChange: (deck: Deck | null) => void;
}) {
  // Same-named decks behind the same commander are the common case for
  // generated decks — the labels are made distinct in deckPickerLabels.
  const labels = deckPickerLabels(decks);
  return (
    <SelectMenu<string>
      ariaLabel="Deck"
      value={value ?? DECK_PICKER_NONE}
      onChange={(next) =>
        onChange(next === DECK_PICKER_NONE ? null : (decks.find((d) => d.id === next) ?? null))
      }
      options={[
        { value: DECK_PICKER_NONE, label: 'None' },
        ...decks.map((d, i) => ({ value: d.id, label: labels[i] })),
      ]}
    />
  );
}
