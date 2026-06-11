import { useEffect, useState } from 'react';

interface Props {
  playerName: string;
  currentLife: number;
  onConfirm: (value: number) => void;
  onClose: () => void;
}

/**
 * Numeric keypad for adjusting a player's life. Two modes:
 *
 * **Set mode (default):** typing digits then pressing "Set life" applies the
 * number as an absolute value — "Set to 27" means life becomes 27.
 *
 * **Delta mode:** pressing "−" or "+" beneath the digit grid treats the buffer
 * as a *change* — "I took 13" → type 13 → tap "−13" → life drops by 13.
 * Both delta buttons resolve to an absolute value and call `onConfirm` with
 * `currentLife ± buffer`, keeping the caller interface unchanged (one
 * `set-life` reducer action per confirm).
 *
 * Rendered *inside* the rotated `.player-panel` (not a portal'd modal) so it
 * expands over that seat and is oriented exactly like the seat's life total —
 * upright for that player on any layout, including 90°/270° sideways seats.
 * Same cover pattern as the counters / seat menu.
 *
 * Pressing a digit starts a fresh buffer (the shown life acts as a hint
 * replaced on first keypress); backspace/clear edit the buffer in place.
 */
export function LifeKeypad({ playerName, currentLife, onConfirm, onClose }: Props) {
  const [buffer, setBuffer] = useState<string>('');
  // 'set' = absolute set-life; 'delta' = apply ± typed amount
  const [mode, setMode] = useState<'set' | 'delta'>('set');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Enter') confirmSet();
      else if (e.key === 'Backspace') setBuffer((b) => b.slice(0, -1));
      else if (/^[0-9]$/.test(e.key)) setBuffer((b) => (b + e.key).slice(0, 4));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function press(d: string) {
    setBuffer((b) => (b + d).slice(0, 4));
  }

  /** Absolute set — used by the "Set life" button and keyboard Enter. */
  function confirmSet() {
    const raw = buffer === '' ? currentLife : Number(buffer);
    if (!Number.isFinite(raw)) return;
    onConfirm(raw);
  }

  /** Apply buffer as a delta in the given direction. */
  function confirmDelta(sign: 1 | -1) {
    const amount = buffer === '' ? 0 : Number(buffer);
    if (!Number.isFinite(amount)) return;
    onConfirm(currentLife + sign * amount);
  }

  const bufferNum = buffer === '' ? currentLife : Number(buffer);
  const displayValue = buffer === '' ? String(currentLife) : buffer;

  // Delta preview labels shown on the ± apply buttons
  const deltaLabel = (sign: '+' | '−') => {
    if (buffer === '') return sign;
    const amount = Number(buffer);
    if (!Number.isFinite(amount)) return sign;
    const result = sign === '+' ? currentLife + amount : currentLife - amount;
    return `${sign}${buffer} → ${result}`;
  };

  return (
    <div
      className="life-keypad"
      role="dialog"
      aria-label={`Set life for ${playerName}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="life-keypad-head">
        <span className="life-keypad-title">
          {mode === 'set' ? `Set life · ${playerName}` : `Change life · ${playerName}`}
        </span>
        <button type="button" className="life-keypad-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="life-keypad-display" aria-live="polite">
        {mode === 'set' ? displayValue : buffer === '' ? String(currentLife) : String(bufferNum)}
      </div>
      <div className="life-keypad-grid">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="life-keypad-btn" onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button
          type="button"
          className="life-keypad-btn is-action"
          onClick={() => {
            if (buffer === '') return;
            setBuffer((b) => b.slice(0, -1));
          }}
          aria-label="Clear last digit"
        >
          ⌫
        </button>
        <button type="button" className="life-keypad-btn" onClick={() => press('0')}>
          0
        </button>
        <button
          type="button"
          className="life-keypad-btn is-action"
          onClick={() => setMode((m) => (m === 'set' ? 'delta' : 'set'))}
          aria-label={mode === 'set' ? 'Switch to change mode' : 'Switch to set mode'}
          aria-pressed={mode === 'delta'}
          title={
            mode === 'set' ? 'Type a number then − or + to apply a change' : 'Back to set-life mode'
          }
        >
          {mode === 'set' ? '±Δ' : 'set'}
        </button>
      </div>

      {mode === 'set' ? (
        <button type="button" className="life-keypad-confirm" onClick={confirmSet}>
          Set life
        </button>
      ) : (
        <div className="life-keypad-delta-row">
          <button
            type="button"
            className="life-keypad-confirm life-keypad-confirm--delta life-keypad-confirm--minus"
            onClick={() => confirmDelta(-1)}
            aria-label={`Subtract ${buffer || '0'} from life`}
          >
            {deltaLabel('−')}
          </button>
          <button
            type="button"
            className="life-keypad-confirm life-keypad-confirm--delta life-keypad-confirm--plus"
            onClick={() => confirmDelta(1)}
            aria-label={`Add ${buffer || '0'} to life`}
          >
            {deltaLabel('+')}
          </button>
        </div>
      )}
    </div>
  );
}
