import { useState } from 'react';
import type { GameAction, GameState } from '../../lib/game-state';
import {
  DIE_PRESETS,
  describeRoll,
  flipCoin,
  pickFirstPlayer,
  rollDice,
  type CoinSide,
} from '../../lib/game-tools';
import { haptics } from '../../lib/haptics';

interface Props {
  game: GameState;
  dispatch: (a: GameAction) => void;
}

type Result =
  | { kind: 'coin'; side: CoinSide }
  | { kind: 'dice'; text: string; rolls: number[]; total: number }
  | { kind: 'first'; name: string };

/**
 * Pre-game / table tools: coin flip, dice, and random first-player. Every
 * result is also written to the game log as a `note` event so it shows up
 * in the timeline and survives online sync — no new reducer action needed.
 */
export function GameTools({ game, dispatch }: Props) {
  const [result, setResult] = useState<Result | null>(null);
  // Bumped on every roll to re-trigger the reveal animation via key remount.
  const [spin, setSpin] = useState(0);
  const [dieSides, setDieSides] = useState(20);
  const [dieCount, setDieCount] = useState(1);

  const announce = (message: string) => dispatch({ type: 'note', actorSeat: null, message });
  const reveal = (r: Result) => {
    setResult(r);
    setSpin((n) => n + 1);
    haptics.tap();
  };

  const onCoin = () => {
    const side = flipCoin();
    reveal({ kind: 'coin', side });
    announce(`🪙 Coin flip → ${side}`);
  };

  const onRoll = (sides: number, count = 1) => {
    const r = rollDice(sides, count);
    reveal({ kind: 'dice', text: `${r.count}d${r.sides}`, rolls: r.rolls, total: r.total });
    announce(describeRoll(r));
  };

  const onFirstPlayer = () => {
    const pick = pickFirstPlayer(game.players);
    if (!pick) return;
    reveal({ kind: 'first', name: pick.name });
    announce(`🎯 First player → ${pick.name}`);
  };

  return (
    <section className="game-menu-section game-tools" aria-label="Table tools">
      <h3 className="game-tools-title">Tools</h3>

      <div className="game-tools-result-wrap" aria-live="polite">
        {result ? (
          <div key={spin} className="game-tools-result is-pop">
            {result.kind === 'coin' && (
              <>
                <span className="game-tools-result-big">{result.side === 'Heads' ? '𝗛' : '𝗧'}</span>
                <span className="game-tools-result-sub">{result.side}</span>
              </>
            )}
            {result.kind === 'dice' && (
              <>
                {result.rolls.length > 1 && (
                  <div className="game-tools-dice-faces">
                    {result.rolls.map((n, i) => (
                      <span key={i} className="game-tools-die-face">
                        {n}
                      </span>
                    ))}
                  </div>
                )}
                <span className="game-tools-result-big">{result.total}</span>
                <span className="game-tools-result-sub">
                  {result.rolls.length > 1 ? `${result.text} · total` : result.text}
                </span>
              </>
            )}
            {result.kind === 'first' && (
              <>
                <span className="game-tools-result-big game-tools-result-name">{result.name}</span>
                <span className="game-tools-result-sub">goes first</span>
              </>
            )}
          </div>
        ) : (
          <span className="game-tools-result-hint">Flip, roll, or pick a starting player.</span>
        )}
      </div>

      <div className="game-tools-actions">
        <button type="button" className="game-tools-btn" onClick={onCoin}>
          🪙 Flip coin
        </button>
        <button type="button" className="game-tools-btn" onClick={onFirstPlayer}>
          🎯 First player
        </button>
      </div>

      <div className="game-tools-dice" role="group" aria-label="Dice">
        {DIE_PRESETS.map((d) => (
          <button
            key={d}
            type="button"
            className="game-tools-die"
            aria-label={`Roll d${d}`}
            onClick={() => onRoll(d)}
          >
            d{d}
          </button>
        ))}
      </div>

      <div className="game-tools-custom">
        <label className="game-tools-custom-field">
          <span>Count</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            value={dieCount}
            onChange={(e) => setDieCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          />
        </label>
        <span className="game-tools-custom-x" aria-hidden="true">
          d
        </span>
        <label className="game-tools-custom-field">
          <span>Sides</span>
          <input
            type="number"
            inputMode="numeric"
            min={2}
            max={1000}
            value={dieSides}
            onChange={(e) => setDieSides(Math.max(2, Math.min(1000, Number(e.target.value) || 6)))}
          />
        </label>
        <button
          type="button"
          className="game-tools-btn game-tools-custom-roll"
          onClick={() => onRoll(dieSides, dieCount)}
        >
          Roll
        </button>
      </div>
    </section>
  );
}
