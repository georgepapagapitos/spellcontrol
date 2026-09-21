import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';

interface Props {
  /** Cards left in the library — the count can't exceed it. */
  max: number;
  onDraw(n: number): void;
}

/**
 * The library menu's "Draw several" page: a count and a button that draws
 * it. A stepper rather than a row per number, because the count a player
 * wants is occasionally 11 (a big Blue Sun's Zenith) and a menu cannot list
 * every number — and because `Draw 2` is still one press away either way.
 */
export function DrawCountPage({ max, onDraw }: Props) {
  const [n, setN] = useState(2);
  const clamp = (v: number) => Math.max(1, Math.min(v, Math.max(1, max)));
  const count = clamp(n);
  return (
    <div className="playtest-ctx-draw">
      <div className="playtest-ctx-draw__step">
        <button
          type="button"
          aria-label="One fewer card"
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
          aria-label="Cards to draw"
          onChange={(e) => setN(clamp(Number(e.target.value)))}
        />
        <button
          type="button"
          aria-label="One more card"
          disabled={count >= max}
          onClick={() => setN(clamp(count + 1))}
        >
          <Plus width={14} height={14} aria-hidden />
        </button>
      </div>
      <button
        type="button"
        className="playtest-ctx-action playtest-ctx-action--table"
        disabled={max === 0}
        onClick={() => onDraw(count)}
      >
        <span>
          Draw {count} card{count === 1 ? '' : 's'}
        </span>
      </button>
    </div>
  );
}
