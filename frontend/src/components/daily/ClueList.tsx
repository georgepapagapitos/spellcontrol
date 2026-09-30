import { Lock } from 'lucide-react';
import { MagicText } from '@/components/deck/MagicText';
import { cluesFor } from '@/lib/daily/clues';
import type { DailyPuzzle } from '@/lib/daily/schedule';

/**
 * Clue 1 is free; each miss unlocks the next. A locked clue names what it will
 * show, so the next miss has a reason to be made.
 */
export function ClueList({
  puzzle,
  unlocked,
  playing,
}: {
  puzzle: DailyPuzzle;
  unlocked: number;
  /** The newest clue is marked only while the puzzle is in play. */
  playing: boolean;
}) {
  const clues = cluesFor(puzzle);
  return (
    <ol className="daily-clues" aria-label="Clues">
      {clues.map((c, i) => {
        const open = i < unlocked;
        const newest = playing && open && i === unlocked - 1 && i > 0;
        return (
          <li
            key={c.label}
            className={`daily-clue${open ? '' : ' is-locked'}${newest ? ' is-new' : ''}`}
          >
            <span className="daily-clue-n" aria-hidden="true">
              {i + 1}
            </span>
            <span className="daily-clue-label">{c.label}</span>
            {open ? (
              <span className={`daily-clue-value${c.prose ? ' is-prose' : ''}`}>
                <MagicText text={c.value} />
              </span>
            ) : (
              <span className="daily-clue-value is-locked">
                <Lock width={12} height={12} strokeWidth={2} aria-hidden="true" />
                Opens after a miss
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
