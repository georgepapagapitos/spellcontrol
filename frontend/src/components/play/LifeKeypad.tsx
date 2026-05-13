import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  playerName: string;
  currentLife: number;
  onConfirm: (value: number) => void;
  onClose: () => void;
}

/**
 * Modal numeric keypad for setting a player's life directly. Pressing a digit
 * starts a fresh buffer (so the displayed life acts as a "current value" hint
 * that's replaced on first keypress); backspace and clear edit the buffer in
 * place. Confirm dispatches the value via the parent's `set-life` handler.
 */
export function LifeKeypad({ playerName, currentLife, onConfirm, onClose }: Props) {
  const [buffer, setBuffer] = useState<string>('');
  const [negative, setNegative] = useState<boolean>(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Enter') confirm();
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

  function confirm() {
    const raw = buffer === '' ? currentLife : Number(buffer);
    if (!Number.isFinite(raw)) return;
    const value = negative ? -Math.abs(raw) : raw;
    onConfirm(value);
  }

  const displayValue = buffer === '' ? String(currentLife) : buffer;
  const display = (negative && displayValue !== '0' ? '−' : '') + displayValue;

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="life-keypad-backdrop" onClick={onClose} role="presentation">
      <div
        className="life-keypad"
        role="dialog"
        aria-label={`Set life for ${playerName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="life-keypad-head">
          <span className="life-keypad-title">Set life · {playerName}</span>
          <button type="button" className="life-keypad-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="life-keypad-display" aria-live="polite">
          {display}
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
            onClick={() => setNegative((v) => !v)}
            aria-label="Toggle negative"
            aria-pressed={negative}
          >
            ±
          </button>
          <button type="button" className="life-keypad-btn" onClick={() => press('0')}>
            0
          </button>
          <button
            type="button"
            className="life-keypad-btn is-action"
            onClick={() => {
              if (buffer === '') setNegative(false);
              setBuffer((b) => b.slice(0, -1));
            }}
            aria-label="Backspace"
          >
            ⌫
          </button>
        </div>
        <button type="button" className="life-keypad-confirm" onClick={confirm}>
          Set life
        </button>
      </div>
    </div>,
    document.body
  );
}
