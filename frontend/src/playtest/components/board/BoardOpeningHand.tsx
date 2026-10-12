import { useNavigate } from 'react-router-dom';
import { cardsToBottom } from '@spellcontrol/game-core';
import type { ScryfallCard } from '@/deck-builder/types';
import type { PlaytestState } from '@/lib/playtest';
import type { OnlineTable } from '../../hooks/use-online-table';
import { MULLIGAN_TABLE_NOTE } from '../../lib/board-support';
import { hordeLevelLabel, hordeStatusText } from '../../lib/horde-view';
import type { SoloHordeState } from '../../lib/horde-solo';
import { effectiveMulliganType, usePlaytestStore } from '../../store';
import { OpeningHandSheet } from '../OpeningHandSheet';
import type { useOpeningHand } from './use-opening-hand';

type OpeningHandStatus = ReturnType<typeof useOpeningHand>;

interface BoardOpeningHandProps extends Pick<
  OpeningHandStatus,
  'phase' | 'mulliganCount' | 'onlineMulliganType' | 'openingOnline'
> {
  state: PlaytestState;
  onlineTable: OnlineTable | null;
  horde: SoloHordeState | null;
  cardLookup: Map<string, ScryfallCard> | undefined;
  deckName: string | undefined;
  playtestDeckId: string | null | undefined;
  backLabel: string | undefined;
  onBack: (() => void) | undefined;
  onOpenHordeSetup: () => void;
}

/** The opening-hand takeover: keep, mulligan, bottom, and the pre-game
 *  choices (play or draw, free mulligan, fight a horde). */
export function BoardOpeningHand({
  phase,
  mulliganCount,
  onlineMulliganType,
  openingOnline,
  state,
  onlineTable,
  horde,
  cardLookup,
  deckName,
  playtestDeckId,
  backLabel,
  onBack,
  onOpenHordeSetup,
}: BoardOpeningHandProps) {
  const navigate = useNavigate();
  const keepOpeningHand = usePlaytestStore((s) => s.keepOpeningHand);
  const mulliganOpeningHand = usePlaytestStore((s) => s.mulliganOpeningHand);
  const finalizeBottom = usePlaytestStore((s) => s.finalizeBottom);
  const freeMulligan = usePlaytestStore((s) => s.freeMulligan);
  const setFreeMulligan = usePlaytestStore((s) => s.setFreeMulligan);
  const tableMulliganType = usePlaytestStore((s) => s.tableMulliganType);
  const onDraw = usePlaytestStore((s) => s.onDraw);
  const setOnDraw = usePlaytestStore((s) => s.setOnDraw);
  if (phase === 'playing' && !openingOnline) return null;
  return (
    <OpeningHandSheet
      phase={phase}
      online={openingOnline}
      horde={
        onlineTable
          ? undefined
          : {
              label: horde
                ? `Horde: ${horde.config.hordeName}, ${hordeLevelLabel(horde.config.level)}`
                : 'Fight a horde',
              desc: horde
                ? `${horde.config.hordeName}, ${hordeLevelLabel(horde.config.level)}. ${hordeStatusText(horde, state.turn)}.`
                : 'A deck that plays itself attacks you every turn.',
              onOpen: onOpenHordeSetup,
            }
      }
      hand={state.zones.hand}
      mulliganCount={mulliganCount}
      cardsOwedToBottom={cardsToBottom(
        effectiveMulliganType(freeMulligan, tableMulliganType),
        mulliganCount
      )}
      tableMulligan={onlineMulliganType ? MULLIGAN_TABLE_NOTE[onlineMulliganType] : undefined}
      cardLookup={cardLookup}
      deckName={deckName}
      freeMulligan={freeMulligan}
      onFreeMulliganChange={setFreeMulligan}
      onDraw={onDraw}
      onOnDrawChange={setOnDraw}
      exitLabel={backLabel}
      onExit={onBack ?? (() => navigate(playtestDeckId ? `/decks/${playtestDeckId}` : '/decks'))}
      onKeep={keepOpeningHand}
      onMulligan={mulliganOpeningHand}
      onConfirmBottom={finalizeBottom}
    />
  );
}
