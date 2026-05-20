import { useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import type { PlaytestCard } from '@/lib/playtest';
import type { PlaytestPhase } from '../store';

interface Props {
  phase: Extract<PlaytestPhase, 'opening' | 'mulligan-bottom'>;
  hand: PlaytestCard[];
  mulliganCount: number;
  onKeep(): void;
  onMulligan(): void;
  onConfirmBottom(cardIds: string[]): void;
}

const MAX_MULLIGANS = 6;

export function OpeningHandSheet({
  phase,
  hand,
  mulliganCount,
  onKeep,
  onMulligan,
  onConfirmBottom,
}: Props) {
  useLockBodyScroll();
  const [selected, setSelected] = useState<string[]>([]);

  const isMulliganBottom = phase === 'mulligan-bottom';
  const requiredBottom = isMulliganBottom ? mulliganCount : 0;
  const canConfirm = isMulliganBottom && selected.length === requiredBottom;

  function toggleSelect(cardId: string) {
    if (!isMulliganBottom) return;
    setSelected((cur) => {
      if (cur.includes(cardId)) return cur.filter((id) => id !== cardId);
      if (cur.length >= requiredBottom) return cur;
      return [...cur, cardId];
    });
  }

  function bottomIndex(cardId: string): number | null {
    if (!isMulliganBottom) return null;
    const i = selected.indexOf(cardId);
    return i === -1 ? null : i + 1;
  }

  return (
    <div className="card-picker-root playtest-opening-root" role="presentation">
      <div className="card-picker-backdrop" />
      <div
        className="card-picker-sheet playtest-opening-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playtest-opening-title"
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <div className="playtest-opening-titleRow">
            <h2 id="playtest-opening-title" className="card-picker-title">
              {isMulliganBottom ? 'Bottom of library' : 'Opening hand'}
            </h2>
            {mulliganCount > 0 && (
              <span className="playtest-opening-badge">Mulligan {mulliganCount}</span>
            )}
          </div>
          {isMulliganBottom && (
            <p className="playtest-opening-hint">
              Choose {requiredBottom} card{requiredBottom === 1 ? '' : 's'} to send to the bottom of
              your library, in the order you tap them.{' '}
              <strong>
                {selected.length}/{requiredBottom} selected
              </strong>
            </p>
          )}
        </div>

        <div className="playtest-opening-cards" role="list">
          {hand.map((c, i) => {
            const idx = bottomIndex(c.id);
            const isSel = idx !== null;
            return (
              <button
                key={c.id}
                type="button"
                role="listitem"
                className={`playtest-opening-card${isSel ? ' is-selected' : ''}`}
                style={{ zIndex: i }}
                onClick={() => toggleSelect(c.id)}
                aria-pressed={isMulliganBottom ? isSel : undefined}
                aria-label={`${c.name}${isSel ? ` — selected, position ${idx}` : ''}`}
                disabled={!isMulliganBottom}
              >
                {c.imageUrl ? (
                  <img src={c.imageUrl} alt="" draggable={false} />
                ) : (
                  <span className="playtest-opening-cardName">{c.name}</span>
                )}
                {idx != null && (
                  <span className="playtest-opening-cardBadge" aria-hidden>
                    {idx}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="card-picker-footer playtest-opening-footer">
          {isMulliganBottom ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canConfirm}
              onClick={() => onConfirmBottom(selected)}
            >
              Send {selected.length}/{requiredBottom} to bottom
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                onClick={onMulligan}
                disabled={mulliganCount >= MAX_MULLIGANS}
              >
                Mulligan
              </button>
              <button type="button" className="btn btn-primary" onClick={onKeep}>
                Keep this hand
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
