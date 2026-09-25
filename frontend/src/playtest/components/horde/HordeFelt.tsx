import { useState } from 'react';
import { DndContext } from '@dnd-kit/core';
import type { PlaytestState } from '@/lib/playtest';
import { Battlefield } from '@/playtest/components/Battlefield';
import { HordeCardMenu } from '@/components/play/horde/HordeCardMenu';
import { usePlaytestStore } from '@/playtest/store';

const EMPTY_SET: ReadonlySet<string> = new Set();

interface Props {
  board: PlaytestState;
  attackingIds: readonly string[];
}

/**
 * The horde's own real `Battlefield` plus its one card menu (Destroyed /
 * Exiled / Returned to the library) — shared by the desktop half and the
 * phone band's open strip, which render identical cards (see STYLE_GUIDE
 * "Horde table": "A horde permanent's death is recorded by hand").
 */
export function HordeFelt({ board, attackingIds }: Props) {
  const moveHordeCard = usePlaytestStore((s) => s.moveHordeCard);
  const [cardMenuId, setCardMenuId] = useState<string | null>(null);
  const menuCard = cardMenuId
    ? (board.battlefield.find((b) => b.card.id === cardMenuId)?.card ?? null)
    : null;

  return (
    <>
      <DndContext>
        <Battlefield
          cards={board.battlefield}
          selectedIds={EMPTY_SET}
          stackIds={EMPTY_SET}
          attackingIds={new Set(attackingIds)}
          dropId="horde-battlefield"
          cardsDraggable={false}
          onBackgroundClick={() => {}}
          onCardClick={(cardId) => setCardMenuId(cardId)}
          onCardContextMenu={(cardId, e) => {
            e.preventDefault();
            setCardMenuId(cardId);
          }}
          onCardLongPress={(cardId) => setCardMenuId(cardId)}
        />
      </DndContext>
      {menuCard && (
        <HordeCardMenu
          card={menuCard}
          onMove={(to) => moveHordeCard(menuCard.id, to)}
          onClose={() => setCardMenuId(null)}
        />
      )}
    </>
  );
}
