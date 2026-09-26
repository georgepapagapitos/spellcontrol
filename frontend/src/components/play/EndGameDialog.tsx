import { useState } from 'react';
import './EndGameDialog.css';
import { Modal } from '../Modal';
import type { GamePlayer } from '../../lib/game-state';
import { Button } from '@/components/shared/Button';

/**
 * End-game dialog with a real winner picker. If exactly one player is alive
 * it's pre-selected; the user can still pick "No winner" or override. The
 * picker is rendered on top of the game-board overlay (the body:has(.game-board)
 * z-index rule in play-setup.css handles the layering).
 *
 * Shared between `/play`'s End button and the playtest board's game menu,
 * where a host ends the table everyone is seated at.
 */
export function EndGameDialog({
  game,
  onConfirm,
  onCancel,
}: {
  game: { players: GamePlayer[] } | null;
  onConfirm: (winnerSeat: number | null) => void;
  onCancel: () => void;
}) {
  const alive = game?.players.filter((p) => !p.eliminated) ?? [];
  const defaultWinner = alive.length === 1 ? alive[0].seat : null;
  const [winnerSeat, setWinnerSeat] = useState<number | null>(defaultWinner);

  if (!game) return null;
  return (
    <Modal onClose={onCancel} label="End game">
      <h2 className="choice-dialog-title">End the game?</h2>
      <p className="choice-dialog-body">Pick the winner, or end without one.</p>
      {/* Already native radios — the wrapper just needed to be a real fieldset
          instead of a div carrying role="radiogroup". */}
      <fieldset className="play-end-winners" aria-label="Winner">
        {game.players.map((p) => (
          <label
            key={p.seat}
            className={`play-end-winner ${winnerSeat === p.seat ? 'is-selected' : ''}`}
          >
            <input
              type="radio"
              name="winner"
              checked={winnerSeat === p.seat}
              onChange={() => setWinnerSeat(p.seat)}
            />
            <span>{p.name}</span>
          </label>
        ))}
        <label className={`play-end-winner ${winnerSeat === null ? 'is-selected' : ''}`}>
          <input
            type="radio"
            name="winner"
            checked={winnerSeat === null}
            onChange={() => setWinnerSeat(null)}
          />
          <span>No winner</span>
        </label>
      </fieldset>
      <div className="choice-dialog-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={() => onConfirm(winnerSeat)} autoFocus>
          Save
        </Button>
      </div>
    </Modal>
  );
}
