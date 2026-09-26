import { useCallback, useEffect, useRef, useState } from 'react';
import { useOverlayDismiss } from '../../lib/use-overlay-dismiss';

interface Props {
  playerName: string;
  currentLife: number;
  onConfirm: (value: number) => void;
  onClose: () => void;
  /** Seat rotation (Lotus's model): the keypad faces the player it's for,
   *  same as their life total, even when read from across the table. */
  rotation?: 0 | 90 | 270 | 180;
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
 * A board-level overlay (rendered by `GameBoard`, not inside any one
 * `.player-panel`), Lotus's own model: it covers and dims the whole board
 * rather than just the seat that opened it, and is rotated to face that
 * seat (`rotation`) so a player across the table reads it upright — the
 * same reasoning the life numeral itself already rotates for. This replaced
 * the older in-panel cover (which shrank the keys to nothing on any seat
 * under ~300px, the default 4-player board on a phone among them): a
 * board-level dialog is never constrained by one seat's cell size.
 *
 * Pressing a digit starts a fresh buffer (the shown life acts as a hint
 * replaced on first keypress); backspace/clear edit the buffer in place.
 */
export function LifeKeypad({ playerName, currentLife, onConfirm, onClose, rotation = 0 }: Props) {
  const [buffer, setBuffer] = useState<string>('');
  // 'set' = absolute set-life; 'delta' = apply ± typed amount
  const [mode, setMode] = useState<'set' | 'delta'>('set');

  /** Absolute set — used by the "Set life" button and keyboard Enter. */
  const confirmSet = useCallback(() => {
    const raw = buffer === '' ? currentLife : Number(buffer);
    if (!Number.isFinite(raw)) return;
    onConfirm(raw);
  }, [buffer, currentLife, onConfirm]);

  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useOverlayDismiss(onClose, panelRef);
  // Initial focus on "Set life", after the overlay trap's own pick (its first
  // focusable, the ✕): the keyboard path is type the digits, press Enter, and
  // that Enter confirms once, as this button's own activation. Mount only, so
  // flipping back from delta mode doesn't pull focus off the toggle.
  useEffect(() => {
    confirmRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // confirmSet must be a dep — an empty-dep effect captured buffer==='' at
      // mount, so Enter dropped the typed total and set life to currentLife.
      if (e.key === 'Enter') {
        // A focused key activates itself: Enter on "7" types 7, Enter on
        // "Set life" confirms through its own click, Enter on ✕ closes.
        if (e.target instanceof Element && e.target.closest('button')) return;
        // preventDefault: the keypad unmounts on this confirm and focus goes
        // back to the numeral button, which the same Enter's default action
        // would otherwise click, opening the keypad again.
        e.preventDefault();
        confirmSet();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setBuffer((b) => b.slice(0, -1));
      } else if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setBuffer((b) => (b + e.key).slice(0, 4));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmSet]);

  function press(d: string) {
    setBuffer((b) => (b + d).slice(0, 4));
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
      className="life-keypad-backdrop"
      role="presentation"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        // Dismiss only on the dim board itself, never a tap that bubbled up
        // from inside the keypad (STYLE_GUIDE overlay rule).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="life-keypad"
        data-rot={rotation}
        style={{ ['--keypad-rot' as never]: `${rotation}deg` }}
        role="dialog"
        aria-modal="true"
        aria-label={`Set life for ${playerName}`}
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
              mode === 'set'
                ? 'Type a number then − or + to apply a change'
                : 'Back to set-life mode'
            }
          >
            {mode === 'set' ? '±Δ' : 'set'}
          </button>
        </div>

        {mode === 'set' ? (
          <button
            ref={confirmRef}
            type="button"
            className="life-keypad-confirm"
            onClick={confirmSet}
          >
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
    </div>
  );
}
