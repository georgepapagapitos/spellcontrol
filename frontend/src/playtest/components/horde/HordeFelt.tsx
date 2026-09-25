import { DndContext } from '@dnd-kit/core';
import type { PlaytestState } from '@/lib/playtest';
import { Battlefield } from '@/playtest/components/Battlefield';

const EMPTY_SET: ReadonlySet<string> = new Set();

interface Props {
  board: PlaytestState;
  attackingIds: readonly string[];
  /** A card was tapped/long-pressed/right-clicked — the caller owns which
   *  card menu is open and where it renders. Never rendered here: this felt
   *  sits inside `.horde-half`/`.horde-band__field`, whose own CSS review
   *  turned up a `filter` that quietly made the felt the containing block
   *  for any `position: fixed` overlay mounted inside it — the sheet then
   *  clipped to the felt's own box instead of the viewport (E387 PR 5
   *  follow-up). Rendering no overlay here at all is the fix that survives
   *  the next such property, not just this one. */
  onCardMenu(cardId: string): void;
}

/**
 * The horde's own real `Battlefield` — shared by the desktop half and the
 * phone band's open strip, which render identical cards (see STYLE_GUIDE
 * "Horde table": "A horde permanent's death is recorded by hand"). Purely
 * presentational; the card menu it requests is mounted at board level.
 */
export function HordeFelt({ board, attackingIds, onCardMenu }: Props) {
  return (
    <DndContext>
      <Battlefield
        cards={board.battlefield}
        selectedIds={EMPTY_SET}
        stackIds={EMPTY_SET}
        attackingIds={new Set(attackingIds)}
        dropId="horde-battlefield"
        cardsDraggable={false}
        onBackgroundClick={() => {}}
        onCardClick={(cardId) => onCardMenu(cardId)}
        onCardContextMenu={(cardId, e) => {
          e.preventDefault();
          onCardMenu(cardId);
        }}
        onCardLongPress={(cardId) => onCardMenu(cardId)}
      />
    </DndContext>
  );
}
