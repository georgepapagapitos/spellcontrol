import { useRef } from 'react';
import { Sheet, type SheetHandle } from '@/components/overlays/Sheet';
import type { PlaytestCard } from '@/lib/playtest';
import './horde-sheets.css';
import { Button } from '@/components/shared/Button';

interface Props {
  card: PlaytestCard;
  onMove(to: 'graveyard' | 'exile' | 'library'): void;
  onClose(): void;
}

/**
 * The one card menu the horde's battlefield needs: this app never simulates
 * the survivors' side of combat, so a horde permanent's death (killed in
 * real combat, removal, a bounce spell) is recorded by hand here — the only
 * way a boss that entered play can ever leave it, which is what lets
 * `hordeOutcome` reach "won" once the library empties.
 */
export function HordeCardMenu({ card, onMove, onClose }: Props) {
  const sheetRef = useRef<SheetHandle>(null);

  function act(to: 'graveyard' | 'exile' | 'library') {
    onMove(to);
    sheetRef.current?.close();
  }

  return (
    <Sheet
      ref={sheetRef}
      inPlace
      onClose={onClose}
      className="horde-card-menu"
      title={card.name}
      footer={(close) => <Button onClick={() => close()}>Close</Button>}
    >
      <div className="card-picker-list horde-card-menu-body">
        <Button onClick={() => act('graveyard')}>Destroyed</Button>
        <Button onClick={() => act('exile')}>Exiled</Button>
        <Button onClick={() => act('library')}>Returned to the library</Button>
      </div>
    </Sheet>
  );
}
