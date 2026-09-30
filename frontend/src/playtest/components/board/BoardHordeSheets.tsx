import type { ComponentProps, ReactNode, RefObject } from 'react';
import type { PlaytestAction } from '@/lib/playtest';
import { HordeEndSheet } from '@/components/play/horde/HordeEndSheet';
import { HordeRevealSheet } from '@/components/play/horde/HordeRevealSheet';
import type { OnlineHordeResult } from '../../hooks/use-online-horde';
import type { OnlineTable } from '../../hooks/use-online-table';
import type { SoloHordeState } from '../../lib/horde-solo';
import type { Rect } from '../../lib/auto-place';
import { measureHordeRect } from '../../lib/horde-view';
import { HordeOverlays } from '../horde/HordeOverlays';
import { HordeSetupSheet } from '../horde/HordeSetupSheet';
import type { deriveOnlineHorde } from './board-derive';

type OnlineHordeDerived = ReturnType<typeof deriveOnlineHorde>;

interface BoardHordeSheetsProps {
  onlineTable: OnlineTable | null;
  onlineHorde: OnlineHordeResult | null;
  onlineHordeView: OnlineHordeDerived['onlineHordeView'];
  onlineHordeOutcome: OnlineHordeDerived['onlineHordeOutcome'];
  onlineHordePendingReveal: OnlineHordeDerived['onlineHordePendingReveal'];
  /** Solo Horde — null when none is armed, and always null at a table. */
  horde: SoloHordeState | null;
  hordeLoad: ComponentProps<typeof HordeSetupSheet>['hordeLoad'];
  hordeDeckCardNames: string[];
  hordeFeltRef: RefObject<HTMLDivElement | null>;
  showHordeSetup: boolean;
  resistanceOn: boolean;
  hordeCardMenuId: string | null;
  hordeDamageOpen: boolean;
  turn: number;
  dispatch: (action: PlaytestAction) => void;
  disarmHorde: () => void;
  confirmHordeReveal: (rect: Rect | null) => void;
  leaveTable: () => Promise<void>;
  /** Wraps a node in the online horde's action provider. */
  withHordeActions: (node: ReactNode) => ReactNode;
  onCloseSetup: () => void;
  onCloseCardMenu: () => void;
  onCloseDamage: () => void;
}

/** The horde's own sheets: setup, the reveal, the end-of-fight result and the
 *  card-menu / damage overlays, solo or at an online table. */
export function BoardHordeSheets({
  onlineTable,
  onlineHorde,
  onlineHordeView,
  onlineHordeOutcome,
  onlineHordePendingReveal,
  horde,
  hordeLoad,
  hordeDeckCardNames,
  hordeFeltRef,
  showHordeSetup,
  resistanceOn,
  hordeCardMenuId,
  hordeDamageOpen,
  turn,
  dispatch,
  disarmHorde,
  confirmHordeReveal,
  leaveTable,
  withHordeActions,
  onCloseSetup,
  onCloseCardMenu,
  onCloseDamage,
}: BoardHordeSheetsProps) {
  return (
    <>
      {!onlineTable && showHordeSetup && (
        <HordeSetupSheet
          horde={horde}
          hordeLoad={hordeLoad}
          cardNames={hordeDeckCardNames}
          resistanceOn={resistanceOn}
          onClose={onCloseSetup}
        />
      )}

      {onlineTable
        ? onlineHorde &&
          onlineHordeView?.phase === 'reveal' && (
            <HordeRevealSheet
              revealed={onlineHordePendingReveal?.revealed ?? []}
              toResolveIds={new Set(onlineHordePendingReveal?.toResolve.map((c) => c.id) ?? [])}
              waveEndId={onlineHordePendingReveal?.waveEndId ?? null}
              onConfirm={() =>
                onlineHorde.actions.confirmReveal(
                  hordeFeltRef.current ? measureHordeRect(hordeFeltRef.current) : null
                )
              }
            />
          )
        : horde?.phase === 'reveal' &&
          horde.pendingReveal && (
            <HordeRevealSheet
              revealed={horde.pendingReveal.revealed}
              toResolveIds={new Set(horde.pendingReveal.toResolve.map((c) => c.id))}
              waveEndId={horde.pendingReveal.waveEndId}
              onConfirm={() =>
                confirmHordeReveal(
                  hordeFeltRef.current ? measureHordeRect(hordeFeltRef.current) : null
                )
              }
            />
          )}

      {onlineTable
        ? onlineHordeOutcome &&
          onlineHordeView && (
            <HordeEndSheet
              outcome={onlineHordeOutcome}
              hordeId={onlineHordeView.config.hordeId}
              hordeTurns={onlineHordeView.hordeTurn}
              damageTaken={onlineHordeView.damageTaken}
              cardsMilledByDamage={onlineHordeView.cardsMilledByDamage}
              bossesBeaten={
                onlineHordeView.board.zones.graveyard.filter((c) => c.id.startsWith('horde-boss-'))
                  .length
              }
              playAgainLabel="Rematch"
              doneLabel="Leave table"
              onPlayAgain={
                onlineTable.isHost
                  ? () => onlineTable.dispatch({ type: 'reset', id: crypto.randomUUID() })
                  : undefined
              }
              playAgainHint={onlineTable.isHost ? undefined : 'The host can start a rematch.'}
              onDone={() => void leaveTable()}
            />
          )
        : horde?.outcome && (
            <HordeEndSheet
              outcome={horde.outcome}
              hordeId={horde.config.hordeId}
              hordeTurns={horde.hordeTurn}
              damageTaken={horde.damageTaken}
              cardsMilledByDamage={horde.cardsMilledByDamage}
              bossesBeaten={
                horde.board.zones.graveyard.filter((c) => c.id.startsWith('horde-boss-')).length
              }
              hideRecord
              endedOnTurn={turn}
              onPlayAgain={() => dispatch({ type: 'RESET' })}
              onDone={disarmHorde}
            />
          )}

      {onlineTable
        ? onlineHorde &&
          onlineHordeView &&
          withHordeActions(
            <HordeOverlays
              horde={{ ...onlineHordeView, lastDamageResult: onlineHorde.damageResult }}
              cardMenuId={hordeCardMenuId}
              onCloseCardMenu={onCloseCardMenu}
              damageOpen={hordeDamageOpen}
              onCloseDamage={onCloseDamage}
              feltRef={hordeFeltRef}
            />
          )
        : horde && (
            <HordeOverlays
              horde={horde}
              cardMenuId={hordeCardMenuId}
              onCloseCardMenu={onCloseCardMenu}
              damageOpen={hordeDamageOpen}
              onCloseDamage={onCloseDamage}
              feltRef={hordeFeltRef}
            />
          )}
    </>
  );
}
