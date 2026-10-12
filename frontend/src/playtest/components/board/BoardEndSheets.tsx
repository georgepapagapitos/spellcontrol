import { useNavigate } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '@/store/decks';
import type { PlaytestState } from '@/lib/playtest';
import type { GameLogEntry } from '@/lib/playtest/game-log';
import { EndGameDialog } from '@/components/play/EndGameDialog';
import type { OnlineTable } from '../../hooks/use-online-table';
import { GameMenuSheet, type GameMenuSection } from '../GameMenuSheet';
import { PlaytestLogSheet } from '../PlaytestLogSheet';
import { PlaytestStatsSheet } from '../PlaytestStatsSheet';
import { tickerSeatName } from '../TableTicker';
import { usePlayStore } from '@/store/play';

interface BoardEndSheetsProps {
  state: PlaytestState;
  deck: Deck | undefined;
  cardLookup: Map<string, ScryfallCard> | undefined;
  mulliganCount: number;
  onlineTable: OnlineTable | null;
  isNarrow: boolean;
  gameLog: GameLogEntry[];
  showStats: boolean;
  setShowStats: (open: boolean) => void;
  showGameMenu: boolean;
  setShowGameMenu: (open: boolean) => void;
  gameMenuSections: GameMenuSection[];
  gameMenuFooter: GameMenuSection;
  endingTable: boolean;
  setEndingTable: (open: boolean) => void;
  showLog: boolean;
  setShowLog: (open: boolean) => void;
}

/** The sheets that read the game back or end it: stats, the game menu, the
 *  host's end-of-table winner picker, and the narrow tier's log sheet. */
export function BoardEndSheets({
  state,
  deck,
  cardLookup,
  mulliganCount,
  onlineTable,
  isNarrow,
  gameLog,
  showStats,
  setShowStats,
  showGameMenu,
  setShowGameMenu,
  gameMenuSections,
  gameMenuFooter,
  endingTable,
  setEndingTable,
  showLog,
  setShowLog,
}: BoardEndSheetsProps) {
  const navigate = useNavigate();
  const onlineTicker = usePlayStore((s) => s.onlineTicker);
  return (
    <>
      {showStats && (
        <PlaytestStatsSheet
          state={state}
          deck={deck}
          cardLookup={cardLookup}
          mulliganCount={mulliganCount}
          onClose={() => setShowStats(false)}
        />
      )}

      {showGameMenu && (
        <GameMenuSheet
          sections={gameMenuSections}
          footer={gameMenuFooter}
          onClose={() => setShowGameMenu(false)}
        />
      )}

      {/* Ending the table is the host saying the game is over, so it records a
          result: the same winner picker /play ends a game with. */}
      {endingTable && onlineTable && (
        <EndGameDialog
          game={{ players: onlineTable.players }}
          onCancel={() => setEndingTable(false)}
          onConfirm={(winnerSeat) => {
            setEndingTable(false);
            onlineTable.dispatch({ type: 'end', winnerSeat });
            navigate('/play');
          }}
        />
      )}

      {showLog && isNarrow && (
        <PlaytestLogSheet
          log={gameLog}
          table={
            onlineTable
              ? {
                  items: onlineTicker,
                  nameFor: (seat) => tickerSeatName(onlineTable, seat),
                }
              : undefined
          }
          onClose={() => setShowLog(false)}
        />
      )}
    </>
  );
}
