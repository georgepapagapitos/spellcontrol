interface Props {
  turn: number;
  libraryCount: number;
  onDraw(): void;
  onShuffle(): void;
  onMulligan(): void;
  onUntapAll(): void;
  onNextTurn(): void;
  onUndo(): void;
  onReset(): void;
  onScry(): void;
  onCreateToken(): void;
  canUndo: boolean;
}

export function ActionBar({
  turn,
  libraryCount,
  onDraw,
  onShuffle,
  onMulligan,
  onUntapAll,
  onNextTurn,
  onUndo,
  onReset,
  onScry,
  onCreateToken,
  canUndo,
}: Props) {
  return (
    <div className="playtest-actionbar" role="toolbar" aria-label="Playtest actions">
      <span className="playtest-actionbar__turn">Turn {turn}</span>
      <button type="button" onClick={onDraw} disabled={libraryCount === 0}>
        Draw
      </button>
      <button type="button" onClick={onShuffle}>
        Shuffle
      </button>
      <button type="button" onClick={onMulligan}>
        Mulligan
      </button>
      <button type="button" onClick={onScry} disabled={libraryCount === 0}>
        Scry
      </button>
      <button type="button" onClick={onUntapAll}>
        Untap all
      </button>
      <button type="button" onClick={onNextTurn}>
        Next turn
      </button>
      <button type="button" onClick={onCreateToken}>
        Create token
      </button>
      <button type="button" onClick={onUndo} disabled={!canUndo}>
        Undo
      </button>
      <button type="button" onClick={onReset} className="playtest-actionbar__reset">
        Reset
      </button>
    </div>
  );
}
