import type { RefObject } from 'react';
// `HordeDamageSheet` reuses the Local setup form's `.play-stepper` shell
// around its own input — an explicit import so the playtest page chunks
// that mount this actually load that stylesheet too (see
// css-chunk-ownership.test.ts).
import '@/styles/play-setup.css';
import { HordeCardMenu } from '@/components/play/horde/HordeCardMenu';
import { HordeDamageSheet } from '@/components/play/horde/HordeDamageSheet';
import { usePlaytestStore } from '@/playtest/store';
import type { SoloHordeState } from '@/playtest/lib/horde-solo';
import { measureHordeRect } from '@/playtest/lib/horde-view';

interface Props {
  horde: SoloHordeState;
  cardMenuId: string | null;
  onCloseCardMenu(): void;
  damageOpen: boolean;
  onCloseDamage(): void;
  /** The mounted felt (half or band strip) to measure for `autoPlace` when a
   *  boss enters — `null` (e.g. a folded phone band) falls back to
   *  `damageHorde`'s own default rect. */
  feltRef: RefObject<HTMLElement | null>;
}

/**
 * The horde's card menu and damage sheet, mounted at board level — never as
 * a descendant of `.horde-half`/`.horde-band__field`. Both of those carry
 * (or have carried) properties like `filter` that make an element the
 * containing block for a `position: fixed` descendant; an overlay mounted
 * inside one then clips to that box instead of the viewport, with no way to
 * reach its own Done/Close button (E387 PR 5 follow-up — see
 * `horde-containing-block.test.ts`). `HordeHalf`/`HordeBand` only request
 * these via callbacks; this is the one place either actually renders.
 */
export function HordeOverlays({
  horde,
  cardMenuId,
  onCloseCardMenu,
  damageOpen,
  onCloseDamage,
  feltRef,
}: Props) {
  const moveHordeCard = usePlaytestStore((s) => s.moveHordeCard);
  const damageHorde = usePlaytestStore((s) => s.damageHorde);
  const clearHordeDamageResult = usePlaytestStore((s) => s.clearHordeDamageResult);

  const menuCard = cardMenuId
    ? (horde.board.battlefield.find((b) => b.card.id === cardMenuId)?.card ?? null)
    : null;

  return (
    <>
      {menuCard && (
        <HordeCardMenu
          card={menuCard}
          onMove={(to) => moveHordeCard(menuCard.id, to)}
          onClose={onCloseCardMenu}
        />
      )}
      {damageOpen && (
        <HordeDamageSheet
          libraryCount={horde.board.zones.library.length}
          result={horde.lastDamageResult}
          onConfirm={(amount) =>
            damageHorde(amount, feltRef.current ? measureHordeRect(feltRef.current) : null)
          }
          onDone={() => {
            clearHordeDamageResult();
            onCloseDamage();
          }}
          onClose={onCloseDamage}
        />
      )}
    </>
  );
}
