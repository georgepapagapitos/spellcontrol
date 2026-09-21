import { useId, useState } from 'react';
import { Modal } from '../Modal';
import { DeckPicker, SeatPips } from './SetupControls';
import type { PickedDeck } from './DeckPickerDialog';
import type { GameResultEdit } from '../../lib/game-results-client';
import type { GameRecord } from '../../lib/game-state';
import type { Deck } from '../../store/decks';
import './GameResultEditDialog.css';

/**
 * Correct the attribution on a finished game: who won, and which deck sat
 * where. Those two are what a person enters by hand at the table, so they are
 * what a person can get wrong. Everything else the row carries (life totals,
 * elimination, how long it ran) is what the app watched happen, and stays
 * read-only here rather than becoming a form field.
 *
 * A seat whose deck was not touched is left out of the saved edit entirely,
 * so saving cannot quietly blank the colors or the commander the server holds
 * for seats this dialog never showed in full.
 */
export function GameResultEditDialog({
  record,
  decks,
  onCancel,
  onSave,
}: {
  record: GameRecord;
  decks: Deck[];
  onCancel: () => void;
  onSave: (edit: GameResultEdit) => void;
}) {
  const titleId = useId();
  const winnerGroupId = useId();
  const [winnerSeat, setWinnerSeat] = useState<number | null>(record.winnerSeat);
  const [picked, setPicked] = useState<Map<number, PickedDeck | null>>(new Map());

  const deckFor = (seat: number) => {
    const p = record.players.find((x) => x.seat === seat);
    if (!picked.has(seat)) return { id: p?.deckId ?? null, name: p?.deckName ?? null, ci: [] };
    const chosen = picked.get(seat) ?? null;
    return {
      id: chosen?.id ?? null,
      name: chosen?.name ?? null,
      ci: chosen?.colorIdentity ?? [],
    };
  };

  const save = () => {
    onSave({
      winnerSeat,
      // Only the seats actually re-picked travel: an untouched seat keeps
      // every field the record already holds for it.
      decks: [...picked.entries()].map(([seat, p]) => ({
        seat,
        deckId: p?.id ?? null,
        deckName: p?.name ?? null,
        commander: p?.commander ?? null,
        colorIdentity: p?.colorIdentity ?? [],
      })),
    });
  };

  return (
    <Modal onClose={onCancel} className="modal game-edit-dialog" labelledBy={titleId}>
      <div className="modal-header">
        <h2 id={titleId}>Correct this game</h2>
      </div>
      <p className="game-edit-note">
        {new Date(record.endedAt).toLocaleString()} · {record.format}
      </p>

      <fieldset className="game-edit-field">
        <legend className="game-edit-legend">Winner</legend>
        <ul className="game-edit-winners">
          {record.players.map((p) => (
            <li key={p.seat}>
              <label className={p.eliminated ? 'game-edit-winner is-out' : 'game-edit-winner'}>
                <input
                  type="radio"
                  name={winnerGroupId}
                  checked={winnerSeat === p.seat}
                  disabled={p.eliminated}
                  onChange={() => setWinnerSeat(p.seat)}
                />
                <span className="game-edit-winner-name">{p.name}</span>
                {p.eliminated && <span className="game-edit-winner-out">eliminated</span>}
              </label>
            </li>
          ))}
          <li>
            <label className="game-edit-winner">
              <input
                type="radio"
                name={winnerGroupId}
                checked={winnerSeat === null}
                onChange={() => setWinnerSeat(null)}
              />
              <span className="game-edit-winner-name">No winner</span>
            </label>
          </li>
        </ul>
      </fieldset>

      <fieldset className="game-edit-field">
        <legend className="game-edit-legend">Decks</legend>
        <ul className="game-edit-seats">
          {record.players.map((p) => {
            const deck = deckFor(p.seat);
            return (
              <li key={p.seat} className="game-edit-seat">
                <span className="game-edit-seat-name">{p.name}</span>
                <SeatPips ci={deck.ci} />
                <DeckPicker
                  decks={decks}
                  value={deck.id}
                  valueName={deck.name}
                  onChange={(next) => setPicked((m) => new Map(m).set(p.seat, next))}
                />
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="choice-dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}
