import type { PlaytestCard, Zone } from '@/lib/playtest';
import { Button } from '@/components/shared/Button';
import { Modal } from '@/components/overlays/Modal';
import { PlaytestCardFace } from '../PlaytestCardFace';

export interface PeekState {
  card: PlaytestCard;
  where: 'top' | 'bottom' | 'random';
  zone: Zone;
}

interface PeekModalProps {
  peek: PeekState;
  onClose: () => void;
  /** Where a randomly selected card goes; the modal has already closed. */
  onMoveTo: (card: PlaytestCard, to: 'hand' | 'battlefield' | 'graveyard' | 'exile') => void;
}

/** One card off an end of a pile, looked at without moving it. */
export function PeekModal({ peek, onClose, onMoveTo }: PeekModalProps) {
  return (
    <Modal onClose={onClose} labelledBy="playtest-peek-title" className="playtest-peek">
      <h2 id="playtest-peek-title" className="playtest-peek__title">
        {peek.where === 'top'
          ? 'Top of library'
          : peek.where === 'bottom'
            ? 'Bottom of library'
            : 'Random card selected'}
      </h2>
      {/* Looking at an end of the library moves nothing — that is the
              whole point of this over the scry sheet. A RANDOM card is a
              different job: the effects that pick one (a discard, an exile)
              then do something to it, so that one offers somewhere to put
              it and "Put back" as the way out. */}
      <PlaytestCardFace card={peek.card} size="lg" />
      <p className="playtest-peek__name">{peek.card.name}</p>
      {peek.where === 'random' ? (
        <div className="playtest-peek__moves">
          <span className="playtest-peek__moves-label" id="playtest-peek-moves">
            Move to
          </span>
          <div
            className="playtest-peek__moves-row"
            role="group"
            aria-labelledby="playtest-peek-moves"
          >
            {(['hand', 'battlefield', 'graveyard', 'exile'] as const).map((to) => (
              <Button
                key={to}
                onClick={() => {
                  onClose();
                  onMoveTo(peek.card, to);
                }}
              >
                {to === 'hand'
                  ? 'Hand'
                  : to === 'battlefield'
                    ? 'Battlefield'
                    : to === 'graveyard'
                      ? 'Graveyard'
                      : 'Exile'}
              </Button>
            ))}
          </div>
          <Button onClick={() => onClose()}>
            {/* Nothing moved to undo — the card never left its pile. */}
            {peek.zone === 'library' ? 'Put back' : 'Leave it'}
          </Button>
        </div>
      ) : (
        <Button onClick={() => onClose()}>Done</Button>
      )}
    </Modal>
  );
}
