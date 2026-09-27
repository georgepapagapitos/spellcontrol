import { Coins, Minus, Plus, Target } from 'lucide-react';
import { useId, useState } from 'react';
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
import { Button, IconButton } from '@/components/shared/Button';
import { BoardSheet, SheetSection } from './BoardSheets';

type Result =
  | { kind: 'coin'; side: CoinSide }
  | { kind: 'dice'; text: string; rolls: number[]; total: number }
  | { kind: 'first'; name: string };

const MIN_COUNT = 1;
const MAX_COUNT = 20;
const MIN_SIDES = 2;
const MAX_SIDES = 1000;

/**
 * The Dice sheet (board T155): one control for dice instead of three. A count
 * stepper and die keys whose labels say exactly what a tap rolls (`3d6`), so
 * the common case stays one tap; Other… opens a sides field and the sheet's
 * one primary, Roll. The result slot is always there, and before the first
 * roll it says so. Coin and first player land in the same slot.
 *
 * Every result also goes to the game log as a `note`, so it shows in History
 * and survives sync with no reducer action of its own. First player is the
 * quiet pick, kept apart from the High roll ceremony on purpose (STYLE_GUIDE
 * § the hub ring and its table moments).
 */
export function DiceSheet({
  game,
  dispatch,
  onClose,
}: {
  game: GameState;
  dispatch: (a: GameAction) => void;
  onClose: () => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  // Bumped on every result to replay the reveal via a key remount.
  const [spin, setSpin] = useState(0);
  const [count, setCount] = useState(1);
  const [otherOpen, setOtherOpen] = useState(false);
  // Raw text so the field can be cleared and retyped; it's read at Roll.
  const [sidesText, setSidesText] = useState('100');
  const sidesId = useId();
  const otherId = useId();
  const sidesHintId = useId();
  const sides = Number(sidesText);
  const sidesValid = Number.isInteger(sides) && sides >= MIN_SIDES && sides <= MAX_SIDES;
  const live = game.status !== 'finished';

  const announce = (message: string) => dispatch({ type: 'note', actorSeat: null, message });
  const reveal = (r: Result) => {
    setResult(r);
    setSpin((n) => n + 1);
    haptics.tap();
  };

  const roll = (dieSides: number) => {
    const r = rollDice(dieSides, count);
    reveal({ kind: 'dice', text: `${r.count}d${r.sides}`, rolls: r.rolls, total: r.total });
    announce(describeRoll(r));
  };

  const onCoin = () => {
    const side = flipCoin();
    reveal({ kind: 'coin', side });
    announce(`Coin flip: ${side}`);
  };

  const onFirstPlayer = () => {
    const pick = pickFirstPlayer(game.players);
    if (!pick) return;
    reveal({ kind: 'first', name: pick.name });
    announce(`First player: ${pick.name}`);
    // Who went first is a fact the on-the-play stat aggregates, so it lands
    // in state as well as the log, and the turn marker moves there: "on the
    // play" and "whose turn is it" are the same fact on turn one.
    dispatch({ type: 'settings', patch: { startingSeat: pick.seat } });
    dispatch({ type: 'pass-turn', actorSeat: null, toSeat: pick.seat });
  };

  return (
    <BoardSheet title="Dice" onClose={onClose} className="dice-sheet">
      <div>
        <div className="dice-slot" aria-live="polite" aria-atomic="true">
          {result ? (
            <div key={spin} className="dice-slot-result">
              {result.kind === 'dice' && (
                <>
                  {result.rolls.length > 1 && (
                    <span className="dice-slot-faces">
                      {result.rolls.map((n, i) => (
                        <span key={i} className="dice-slot-face">
                          {n}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="dice-slot-big">{result.total}</span>
                  <span className="dice-slot-cap">
                    {result.rolls.length > 1 ? `${result.text} · total` : result.text}
                  </span>
                </>
              )}
              {result.kind === 'coin' && (
                <>
                  <span className="dice-slot-big is-word">{result.side}</span>
                  <span className="dice-slot-cap">Coin flip</span>
                </>
              )}
              {result.kind === 'first' && (
                <>
                  <span className="dice-slot-big is-word">{result.name}</span>
                  <span className="dice-slot-cap">goes first</span>
                </>
              )}
            </div>
          ) : (
            <div className="dice-slot-result">
              <span className="dice-slot-big is-empty" aria-hidden="true">
                —
              </span>
              <span className="dice-slot-cap">No roll yet</span>
            </div>
          )}
        </div>
        <p className="board-sheet-hint dice-slot-hint">Every roll and flip goes in the game log.</p>
      </div>

      <SheetSection title="Roll">
        <div className="dice-count" role="group" aria-label="Dice per roll">
          <div className="dice-stepper">
            <IconButton
              className="dice-stepper-btn"
              label="Fewer dice"
              icon={<Minus width={18} height={18} strokeWidth={2} />}
              disabled={count <= MIN_COUNT}
              onClick={() => setCount((n) => Math.max(MIN_COUNT, n - 1))}
            />
            <span className="dice-stepper-value" aria-live="polite">
              {count}
            </span>
            <IconButton
              className="dice-stepper-btn"
              label="More dice"
              icon={<Plus width={18} height={18} strokeWidth={2} />}
              disabled={count >= MAX_COUNT}
              onClick={() => setCount((n) => Math.min(MAX_COUNT, n + 1))}
            />
          </div>
          <span className="board-sheet-hint dice-count-label">
            {count === 1 ? 'die per roll' : 'dice per roll'}
          </span>
        </div>

        <div className="dice-keys">
          {DIE_PRESETS.map((d, i) => (
            <Button
              key={d}
              className="dice-key"
              onClick={() => roll(d)}
              aria-label={`Roll ${count}d${d}`}
              data-autofocus={i === 0 || undefined}
            >
              {`${count}d${d}`}
            </Button>
          ))}
          <Button
            className={`dice-key dice-key-other${otherOpen ? ' is-open' : ''}`}
            aria-expanded={otherOpen}
            aria-controls={otherOpen ? otherId : undefined}
            onClick={() => setOtherOpen((v) => !v)}
          >
            Other…
          </Button>
        </div>

        {otherOpen && (
          <form
            id={otherId}
            className="dice-other"
            onSubmit={(e) => {
              e.preventDefault();
              if (sidesValid) roll(sides);
            }}
          >
            <label className="dice-other-field" htmlFor={sidesId}>
              <span>Sides</span>
              <input
                id={sidesId}
                type="number"
                inputMode="numeric"
                min={MIN_SIDES}
                max={MAX_SIDES}
                value={sidesText}
                aria-invalid={!sidesValid}
                aria-describedby={sidesValid ? undefined : sidesHintId}
                onChange={(e) => setSidesText(e.target.value)}
              />
            </label>
            <Button type="submit" variant="primary" disabled={!sidesValid}>
              {sidesValid ? `Roll ${count}d${sides}` : 'Roll'}
            </Button>
            {!sidesValid && (
              <p id={sidesHintId} className="board-sheet-hint dice-other-error">
                A die has 2 to 1000 sides.
              </p>
            )}
          </form>
        )}
      </SheetSection>

      <SheetSection title={live ? 'Coin and first player' : 'Coin'}>
        <div className="dice-pair">
          <Button icon={<Coins width={17} height={17} strokeWidth={2} />} onClick={onCoin}>
            Flip a coin
          </Button>
          {live && (
            <Button
              icon={<Target width={17} height={17} strokeWidth={2} />}
              onClick={onFirstPlayer}
            >
              Pick first player
            </Button>
          )}
        </div>
        {live && <p className="board-sheet-hint">Picking a first player also starts their turn.</p>}
      </SheetSection>
    </BoardSheet>
  );
}
