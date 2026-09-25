import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import type { PlaytestCard } from '@/lib/playtest';
import './horde-sheets.css';

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
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose);
  useLockBodyScroll();
  useEscapeKey(() => beginClose());

  function act(to: 'graveyard' | 'exile' | 'library') {
    onMove(to);
    beginClose();
  }

  return (
    <div className="card-picker-root">
      <div className="card-picker-backdrop" role="presentation" onClick={() => beginClose()} />
      <div
        className={`card-picker-sheet horde-card-menu${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={card.name}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">{card.name}</h2>
        </div>
        <div className="card-picker-list horde-card-menu-body">
          <button type="button" className="btn" onClick={() => act('graveyard')}>
            Destroyed
          </button>
          <button type="button" className="btn" onClick={() => act('exile')}>
            Exiled
          </button>
          <button type="button" className="btn" onClick={() => act('library')}>
            Returned to the library
          </button>
        </div>
        <div className="card-picker-footer">
          <button type="button" className="btn" onClick={() => beginClose()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
