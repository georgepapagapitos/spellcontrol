import { Modal } from '../Modal';
import { haptics } from '../../lib/haptics';

interface Props {
  cardName: string;
  /** Set name of the printing being pulled in (the one the user picked). */
  chosenSetName: string;
  /** Name of the deck or cube that currently holds the copy. */
  donorName: string;
  donorKind: 'deck' | 'cube';
  /**
   * When set, this deck holds a reciprocal owned copy that can be handed back so
   * the donor isn't left short — enables the Swap option. Only offered for a
   * mainboard deck donor (a cube can't cleanly take a card back).
   */
  swap: { returnSetName: string } | null;
  onMove: () => void;
  onSwap: () => void;
  onCancel: () => void;
}

/**
 * Confirm for pulling an owned-but-committed copy into the current deck from the
 * edit-printing picker. The picked printing has no free copy, so bringing it
 * here means either leaving the donor short (Move) or trading your other copy
 * back to it (Swap). Nothing moves until the explicit choice — mirrors the
 * physical-copy reallocation feature's "nothing moves silently" contract.
 */
export function MovePrintingPrompt({
  cardName,
  chosenSetName,
  donorName,
  donorKind,
  swap,
  onMove,
  onSwap,
  onCancel,
}: Props) {
  const consequence =
    donorKind === 'cube'
      ? `Your ${chosenSetName} copy will be released from ${donorName}.`
      : `Your ${chosenSetName} copy is in ${donorName}, which will be left short a copy.`;
  return (
    <Modal onClose={onCancel} labelledBy="move-printing-title">
      <h2 id="move-printing-title" className="choice-dialog-title">
        Use your {cardName} here?
      </h2>
      <p className="choice-dialog-body">
        {consequence}
        {swap && ` Or swap — send your ${swap.returnSetName} copy back so nothing goes short.`}
      </p>
      <div className="choice-dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        {swap && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              haptics.tap();
              onSwap();
            }}
          >
            Swap
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            haptics.tap();
            onMove();
          }}
          autoFocus
        >
          Move here
        </button>
      </div>
    </Modal>
  );
}
