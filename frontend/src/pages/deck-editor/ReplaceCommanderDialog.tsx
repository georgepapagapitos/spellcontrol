import { Button } from '@/components/shared/Button';
import { Modal } from '@/components/overlays/Modal';

/**
 * Asks what happens to the current commander (or partner) when another card is
 * made one: it leaves the deck or stays in it as a card.
 */
export function ReplaceCommanderDialog({
  which,
  incoming,
  current,
  onCancel,
  onConfirm,
}: {
  which: 'commander' | 'partner';
  incoming: string;
  current: string;
  onCancel: () => void;
  onConfirm: (keepInDeck: boolean) => void;
}) {
  const titleId = `make-${which}-title`;
  return (
    <Modal onClose={onCancel} labelledBy={titleId}>
      <h2 id={titleId} className="choice-dialog-title">
        Make {incoming} the {which === 'partner' ? 'partner commander' : 'commander'}?
      </h2>
      <p className="choice-dialog-body">
        <strong>{current}</strong> is currently the {which}. What should happen to it?
      </p>
      <div className="choice-dialog-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onConfirm(false)}>Remove from deck</Button>
        <Button variant="primary" onClick={() => onConfirm(true)} autoFocus>
          Keep in deck
        </Button>
      </div>
    </Modal>
  );
}
