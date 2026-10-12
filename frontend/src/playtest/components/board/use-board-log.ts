import { useCallback, useState } from 'react';
import type { GameLogEntry } from '@/lib/playtest/game-log';

/**
 * The game log's open state: docked at the table tier, a sheet on the
 * narrow one, plus the unread dot that follows resistance entries.
 */
export function useBoardLog(gameLog: readonly GameLogEntry[]) {
  const [showLog, setShowLog] = useState(false);
  // Whether the log was opened from the table feed's button, which lands it
  // on the Table view rather than the last chip picked.
  const [logOnTable, setLogOnTable] = useState(false);
  // Highest resistance-entry seq seen so far — drives the ActionBar's unread
  // dot; not persisted, a soft nice-to-have that resets on remount.
  const [lastSeenLogSeq, setLastSeenLogSeq] = useState(0);

  const hasUnreadLog = gameLog.some((e) => e.kind === 'resistance' && e.seq > lastSeenLogSeq);
  const handleOpenLog = useCallback(() => {
    setLastSeenLogSeq(gameLog.at(-1)?.seq ?? 0);
    setLogOnTable(false);
    setShowLog(true);
  }, [gameLog]);
  // The table feed's button (online, table tier): opens the same log dock on
  // its Table view, or closes it if it is open, however it was opened.
  const toggleTableLog = () => {
    if (showLog) {
      setShowLog(false);
      return;
    }
    setLastSeenLogSeq(gameLog.at(-1)?.seq ?? 0);
    setLogOnTable(true);
    setShowLog(true);
  };

  return { showLog, setShowLog, logOnTable, hasUnreadLog, handleOpenLog, toggleTableLog };
}
