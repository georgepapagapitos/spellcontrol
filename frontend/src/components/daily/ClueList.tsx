import { Lock } from 'lucide-react';
import { MagicText } from '@/components/deck/MagicText';
import type { DailyClue } from '@/lib/daily/daily-client';

/**
 * The clues the server has handed out, then one locked row per clue still to
 * earn. A locked row shows only its number: the server never sends what a
 * locked clue is, so it can't leak.
 */
export function ClueList({
  clues,
  total,
  playing,
}: {
  clues: readonly DailyClue[];
  total: number;
  /** The newest clue is marked only while the puzzle is in play. */
  playing: boolean;
}) {
  const locked = Math.max(0, total - clues.length);
  return (
    <ol className="daily-clues" aria-label="Clues">
      {clues.map((c, i) => {
        const newest = playing && i === clues.length - 1 && i > 0;
        return (
          <li key={c.label} className={`daily-clue${newest ? ' is-new' : ''}`}>
            <span className="daily-clue-n" aria-hidden="true">
              {i + 1}
            </span>
            <span className="daily-clue-label">{c.label}</span>
            <span className={`daily-clue-value${c.prose ? ' is-prose' : ''}`}>
              <MagicText text={c.value} />
            </span>
          </li>
        );
      })}
      {Array.from({ length: locked }, (_, j) => {
        const n = clues.length + j + 1;
        return (
          <li key={`locked-${n}`} className="daily-clue is-locked">
            <span className="daily-clue-n" aria-hidden="true">
              {n}
            </span>
            <span className="daily-clue-label">Clue {n}</span>
            <span className="daily-clue-value is-locked">
              <Lock width={12} height={12} strokeWidth={2} aria-hidden="true" />
              Opens after a miss
            </span>
          </li>
        );
      })}
    </ol>
  );
}
