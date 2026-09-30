import { X } from 'lucide-react';
import { DeckTestHandPanel } from '../../components/deck/DeckTestHandPanel';
import { IconButton } from '@/components/shared/Button';
import { DeckEditorCardPickerSheet } from './DeckEditorCardPickerSheet';

export function DeckTestHandSheet({ deckId, onClose }: { deckId: string; onClose: () => void }) {
  return (
    <DeckEditorCardPickerSheet label="Test hand" className="deck-test-hand-sheet" onClose={onClose}>
      {(dismiss) => (
        <>
          <div className="card-picker-handle" aria-hidden />
          <div className="deck-test-hand-sheet-header">
            <h2 className="deck-test-hand-sheet-title">Test hand</h2>
            <IconButton
              variant="quiet"
              onClick={dismiss}
              label="Close test hand"
              icon={<X width={18} height={18} strokeWidth={2} />}
            />
          </div>
          <div className="deck-test-hand-sheet-body">
            <DeckTestHandPanel embedded deckId={deckId} />
          </div>
        </>
      )}
    </DeckEditorCardPickerSheet>
  );
}
