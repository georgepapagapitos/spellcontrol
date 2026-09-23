import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';

interface Props {
  /** Cards left in the library — the count can't exceed it. */
  max: number;
  /** The confirm button's whole label for a given count, so each caller
   *  names its own action ("Draw 3 cards", "Mill 3 cards"). */
  label(n: number): string;
  /** Where the counter opens. Draw starts at 2 — one card is what the row
   *  above it already does; the bulk moves start at 1. */
  initial?: number;
  onConfirm(n: number): void;
}

/**
 * A count, and a button that does the thing that many times — the library
 * menu's "Draw several" and each of its bulk moves. A stepper rather than a
 * row per number, because the count a player wants is occasionally 11 (a big
 * Blue Sun's Zenith) and a menu cannot list every number.
 */
export function CountPage({ max, label, initial = 1, onConfirm }: Props) {
  const [n, setN] = useState(initial);
  const clamp = (v: number) => Math.max(1, Math.min(v, Math.max(1, max)));
  const count = clamp(n);
  return (
    <div className="playtest-ctx-count">
      <div className="playtest-ctx-count__step">
        <button
          type="button"
          aria-label="One fewer"
          disabled={count <= 1}
          onClick={() => setN(clamp(count - 1))}
        >
          <Minus width={14} height={14} aria-hidden />
        </button>
        <input
          type="number"
          min={1}
          max={Math.max(1, max)}
          value={count}
          aria-label="How many cards"
          onChange={(e) => setN(clamp(Number(e.target.value)))}
        />
        <button
          type="button"
          aria-label="One more"
          disabled={count >= max}
          onClick={() => setN(clamp(count + 1))}
        >
          <Plus width={14} height={14} aria-hidden />
        </button>
      </div>
      <button
        type="button"
        className="playtest-ctx-action"
        disabled={max === 0}
        onClick={() => onConfirm(count)}
      >
        <span>{label(count)}</span>
      </button>
    </div>
  );
}
