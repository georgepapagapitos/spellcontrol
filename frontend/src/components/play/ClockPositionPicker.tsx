import { useId } from 'react';
import { CLOCK_POSITION_OPTIONS, type ClockPosition } from '@/lib/play/clock-position';
import './ClockPositionPicker.css';

/**
 * The board settings' "Clock position" choice (2026-10-16): a fieldset of
 * native radios over styled rows, so arrow keys and one tab stop come for
 * free (STYLE_GUIDE: an exclusive-value picker is never ARIA-only). Each row
 * carries its one-line hint; the note under the group says the choice is
 * per device, not per table.
 */
export function ClockPositionPicker({
  value,
  onChange,
}: {
  value: ClockPosition;
  onChange: (next: ClockPosition) => void;
}) {
  const name = useId();
  return (
    <>
      <fieldset className="clock-position-group">
        <legend className="visually-hidden">Clock position</legend>
        {CLOCK_POSITION_OPTIONS.map((o) => (
          <label key={o.value} className="clock-position-option">
            <input
              className="overlay-input"
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span className="clock-position-label">{o.label}</span>
            <span className="clock-position-hint">{o.hint}</span>
            <span className="clock-position-mark" aria-hidden="true" />
          </label>
        ))}
      </fieldset>
      <p className="board-sheet-hint">Saved on this device.</p>
    </>
  );
}
