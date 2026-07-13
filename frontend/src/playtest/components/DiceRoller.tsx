import { useRef, useState } from 'react';
import './DiceRoller.css';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';

interface Props {
  onClose(): void;
}

interface Roll {
  id: number;
  label: string;
  result: string;
}

const DICE = [4, 6, 8, 10, 12, 20];
const MAX_HISTORY = 5;

export function DiceRoller({ onClose }: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  useLockBodyScroll();
  useEscapeKey(beginClose);
  const [history, setHistory] = useState<Roll[]>([]);
  const nextId = useRef(0);

  function roll(label: string, result: string) {
    const entry: Roll = { id: nextId.current++, label, result };
    setHistory((h) => [entry, ...h].slice(0, MAX_HISTORY));
  }

  const latest = history[0];

  return (
    <div className="card-picker-root" role="presentation" onClick={() => beginClose()}>
      <div className="card-picker-backdrop" />
      <div
        className={`card-picker-sheet playtest-dice-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Roll dice"
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">Roll</h2>
        </div>
        <div className="playtest-dice-grid">
          <button
            type="button"
            onClick={() => roll('Coin', Math.random() < 0.5 ? 'Heads' : 'Tails')}
          >
            Coin flip
          </button>
          {DICE.map((sides) => (
            <button
              key={sides}
              type="button"
              onClick={() => roll(`d${sides}`, String(Math.floor(Math.random() * sides) + 1))}
            >
              d{sides}
            </button>
          ))}
        </div>
        <div className="playtest-dice-result" role="status">
          {latest ? `${latest.label}: ${latest.result}` : 'Tap a die or the coin to roll.'}
        </div>
        {history.length > 1 && (
          <ul className="playtest-dice-history">
            {history.slice(1).map((h) => (
              <li key={h.id}>
                {h.label}: {h.result}
              </li>
            ))}
          </ul>
        )}
        <div className="card-picker-footer">
          <button type="button" className="btn" onClick={() => beginClose()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
