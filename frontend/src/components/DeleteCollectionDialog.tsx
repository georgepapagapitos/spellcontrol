import { useState } from 'react';
import { useCollectionStore } from '../store/collection';
import { Modal } from './Modal';
import { Button } from './shared/Button';

/**
 * "Delete entire collection", shared by the Collection page's ⋮ menu and
 * Settings → Danger zone so both doors run the same flow.
 *
 * Two steps: the first explains the consequences and needs an intentional
 * "Continue"; the second is the final "yes, delete" gate. Splitting them stops
 * accidental deletions from muscle memory (one click on a danger item is not
 * enough). `clearCards()` shows its own "Collection cleared." toast with Undo
 * and swallows IDB errors, so there is nothing to confirm or catch here.
 */
export function DeleteCollectionDialog({ onClose }: { onClose: () => void }) {
  const clearCards = useCollectionStore((s) => s.clearCards);
  const liveCount = useCollectionStore((s) => s.cards.length);
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  // Freeze the count at open. The live count is store state that the very
  // delete this dialog describes is concurrently zeroing, so while the wipe
  // ran the still-mounted dialog re-rendered as "remove 0 cards" before it
  // closed, reading as "I confirmed and it just sat there." What the user
  // agreed to is the number they were shown.
  const [count] = useState(liveCount);
  const isFinal = step === 2;
  const noun = count === 1 ? 'card' : 'cards';

  async function handleAdvance() {
    if (!isFinal) {
      setStep(2);
      return;
    }
    setBusy(true);
    try {
      await clearCards();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      // A fresh modal per step, so the final step's danger button takes focus
      // as its own dialog rather than inheriting the Continue click's focus.
      key={step}
      onClose={onClose}
      dismissable={!busy}
      className="choice-dialog"
      labelledBy="wipe-collection-title"
    >
      <h2 id="wipe-collection-title" className="choice-dialog-title">
        {isFinal ? 'Last chance: delete everything?' : 'Delete entire collection?'}
      </h2>
      <p className="choice-dialog-body">
        {isFinal ? (
          <>
            This removes <strong>{count.toLocaleString()}</strong> {noun} and the import history.
            Binders stay but will be empty. Undo is only in the toast that follows.
          </>
        ) : (
          <>
            This removes all <strong>{count.toLocaleString()}</strong> {noun}. Binders and decks are
            kept, but decks lose their copy assignments.
          </>
        )}
      </p>
      <div className="choice-dialog-actions">
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant={isFinal ? 'danger' : 'secondary'}
          onClick={() => void handleAdvance()}
          disabled={busy}
          autoFocus
        >
          {busy ? 'Deleting…' : isFinal ? 'Delete everything' : 'Continue'}
        </Button>
      </div>
    </Modal>
  );
}
