import { useCallback, useState } from 'react';
import { haptics } from '@/lib/util/haptics';
import { useMediaQuery } from '@/lib/util/use-media-query';
import { toast } from '@/store/toasts';
import type { OnlineTable } from '../../hooks/use-online-table';
import { NO_OPPONENTS } from '../../lib/board-support';
import { MAX_GRID_OPPONENTS, TABLE_GRID_QUERY } from '../OpponentQuadrant';

/**
 * Desktop seat grid (STYLE_GUIDE "Desktop table with opponents: 2x2, not a
 * rail"): at 1024px and up (the same "table chrome" floor `isNarrow` already
 * draws), an online table with opponents lays every seat out as an equal
 * quadrant instead of a board plus a rail — an opponent's battlefield is the
 * point of the table, and it stays a real board at any width that tier can
 * physically hold it at. Capped at three opponents — a 2x2 grid holds four
 * seats, and a fifth would have to hide one, which the rail exists precisely
 * never to do. Below 1024, on phones, and at a five-seat pod, the rail is
 * still the answer.
 */
export function useBoardLayout(
  onlineTable: OnlineTable | null,
  isNarrow: boolean,
  isOnlineHordeTable: boolean
) {
  // Seat layout: `auto` is the breakpoint's own answer (grid at the widest
  // tier, rail below it). Choosing one pins it until it is switched back —
  // a player who wants every seat equal at 1280px, or their own board big
  // at 1600px, should be able to say so.
  const [layoutPref, setLayoutPref] = useState<'auto' | 'grid' | 'rail'>('auto');
  const wideTable = useMediaQuery(TABLE_GRID_QUERY);
  const opponents = onlineTable?.opponents ?? NO_OPPONENTS;
  // A five-seat pod and the narrow tiers are still rail-only whatever the
  // preference says: the grid physically holds four seats, and forcing it
  // would hide one — which is the thing the rail exists never to do.
  // A horde table's teammates always sit in the rail (STYLE_GUIDE "Horde at
  // an online table"): the horde itself takes the grid's "opponent" role, so
  // there is no second board worth a quadrant, and the toggle degrades to
  // the same "This table only fits the rail." toast a 5-seat pod gets.
  const gridFits =
    !isOnlineHordeTable &&
    !isNarrow &&
    opponents.length > 0 &&
    opponents.length <= MAX_GRID_OPPONENTS;
  const gridMode = gridFits && (layoutPref === 'auto' ? wideTable : layoutPref === 'grid');
  const toggleLayout = useCallback(() => {
    if (!gridFits) {
      toast.show({ message: 'This table only fits the rail.', tone: 'info' });
      return;
    }
    setLayoutPref(gridMode ? 'rail' : 'grid');
    haptics.tap();
  }, [gridFits, gridMode]);

  return { opponents, gridFits, gridMode, toggleLayout };
}
