import { useState } from 'react';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { Modal } from './Modal';
import type { MaterializedBinder, EnrichedCard } from '../types';
import {
  buildBackup,
  buildBinderBackup,
  buildAllBindersBackup,
  downloadBackup,
  binderBackupFileName,
  allBindersBackupFileName,
} from '../lib/backup';
import { CollectionExportDialog } from './CollectionExportDialog';

interface Props {
  binders: MaterializedBinder[];
  /** Currently active binder id (used to label the "this binder" option). */
  activeId: string | null;
  onClose: () => void;
}

type ExportKind = 'binder' | 'binder-csv' | 'binder-print' | 'all-binders' | 'full';

export function BinderExportDialog({ binders, activeId, onClose }: Props) {
  const buildBackupSnapshot = useCollectionStore((s) => s.buildBackupSnapshot);
  const decks = useDecksStore((s) => s.decks);

  const active = binders.find((b) => b.def.id === activeId) ?? null;
  const allBinderCards = collectCards(binders);
  // "This binder as a file" hands off to the format picker in place.
  const [fileStep, setFileStep] = useState(false);

  const handlePick = (kind: ExportKind) => {
    if (kind === 'binder-csv') {
      // Stays open: swaps this chooser for the format picker (below).
      if (active) setFileStep(true);
      return;
    }
    try {
      if (kind === 'binder') {
        if (!active) return;
        const cards = collectCards([active]);
        downloadBackup(buildBinderBackup(active.def, cards), binderBackupFileName(active.def.name));
      } else if (kind === 'binder-print') {
        if (!active) return;
        // Closes below (the finally), then the print stylesheet renders the
        // binder's own .print-list (BinderPage) instead of the modal.
        requestAnimationFrame(() => window.print());
      } else if (kind === 'all-binders') {
        downloadBackup(
          buildAllBindersBackup(
            binders.map((b) => b.def),
            allBinderCards
          ),
          allBindersBackupFileName()
        );
      } else {
        // Full backup: collection + binders + decks, same as the Settings-style export.
        const snapshot = buildBackupSnapshot();
        downloadBackup(buildBackup(snapshot.collection, snapshot.binders, decks));
      }
    } finally {
      onClose();
    }
  };

  if (fileStep && active) {
    return (
      <CollectionExportDialog
        cards={collectCards([active])}
        binderName={active.def.name}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal onClose={onClose} labelledBy="binder-export-title">
      <h2 id="binder-export-title" className="choice-dialog-title">
        Export
      </h2>
      <p className="choice-dialog-body">
        Export a JSON backup that can be re-imported via Restore. Cards include the full Scryfall
        enrichment used by this app.
      </p>
      <div className="choice-dialog-options">
        <button
          type="button"
          className="choice-dialog-option"
          onClick={() => handlePick('binder')}
          disabled={!active}
          autoFocus
        >
          <span className="choice-dialog-option-title">
            {active ? `This binder: ${active.def.name}` : 'This binder'}
          </span>
          <span className="choice-dialog-option-desc">
            {active
              ? `"${active.def.name}" and its ${active.totalCards.toLocaleString()} card${active.totalCards === 1 ? '' : 's'}.`
              : 'No active binder.'}
          </span>
        </button>
        <button
          type="button"
          className="choice-dialog-option"
          onClick={() => handlePick('binder-csv')}
          disabled={!active}
        >
          <span className="choice-dialog-option-title">
            {active ? `This binder as a file: ${active.def.name}` : 'This binder as a file'}
          </span>
          <span className="choice-dialog-option-desc">
            Cards only, one row per copy, as a SpellControl, Moxfield or Archidekt CSV or an Arena
            list. No rule definitions.
          </span>
        </button>
        <button
          type="button"
          className="choice-dialog-option"
          onClick={() => handlePick('binder-print')}
          disabled={!active}
        >
          <span className="choice-dialog-option-title">
            {active ? `Print checklist: ${active.def.name}` : 'Print checklist'}
          </span>
          <span className="choice-dialog-option-desc">
            A plain checklist: name, quantity, set/collector number. Grouped the same way this
            binder is.
          </span>
        </button>
        <button
          type="button"
          className="choice-dialog-option"
          onClick={() => handlePick('all-binders')}
          disabled={binders.length === 0}
        >
          <span className="choice-dialog-option-title">All binders</span>
          <span className="choice-dialog-option-desc">
            {binders.length} binder{binders.length === 1 ? '' : 's'} and every card routed to one of
            them. Uncategorized cards aren't included.
          </span>
        </button>
        <button type="button" className="choice-dialog-option" onClick={() => handlePick('full')}>
          <span className="choice-dialog-option-title">Full collection</span>
          <span className="choice-dialog-option-desc">
            Everything: all cards, including uncategorized, all binder definitions, and every deck.
          </span>
        </button>
      </div>
      <div className="choice-dialog-actions">
        <button type="button" className="upload-action" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** Flatten cards from materialized binders, deduping when a card appears in multiple sections. */
function collectCards(binders: MaterializedBinder[]): EnrichedCard[] {
  const seen = new Set<EnrichedCard>();
  for (const b of binders) {
    for (const section of b.sections) {
      for (const card of section.cards) seen.add(card);
    }
  }
  return [...seen];
}
