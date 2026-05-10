import { useCollectionStore } from '../store/collection';
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

interface Props {
  binders: MaterializedBinder[];
  /** Currently active binder id (used to label the "this binder" option). */
  activeId: string | null;
  onClose: () => void;
}

type ExportKind = 'binder' | 'all-binders' | 'full';

export function BinderExportDialog({ binders, activeId, onClose }: Props) {
  const buildBackupSnapshot = useCollectionStore((s) => s.buildBackupSnapshot);

  const active = binders.find((b) => b.def.id === activeId) ?? null;
  const allBinderCards = collectCards(binders);

  const handlePick = (kind: ExportKind) => {
    try {
      if (kind === 'binder') {
        if (!active) return;
        const cards = collectCards([active]);
        downloadBackup(buildBinderBackup(active.def, cards), binderBackupFileName(active.def.name));
      } else if (kind === 'all-binders') {
        downloadBackup(
          buildAllBindersBackup(
            binders.map((b) => b.def),
            allBinderCards
          ),
          allBindersBackupFileName()
        );
      } else {
        // Full backup: collection + binders, same as the Settings-style export.
        const snapshot = buildBackupSnapshot();
        downloadBackup(buildBackup(snapshot.collection, snapshot.binders));
      }
    } finally {
      onClose();
    }
  };

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
            {active ? `This binder — ${active.def.name}` : 'This binder'}
          </span>
          <span className="choice-dialog-option-desc">
            {active
              ? `Just "${active.def.name}" and its ${active.totalCards.toLocaleString()} card${active.totalCards === 1 ? '' : 's'}.`
              : 'No active binder.'}
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
            them. Uncategorized cards are not included.
          </span>
        </button>
        <button type="button" className="choice-dialog-option" onClick={() => handlePick('full')}>
          <span className="choice-dialog-option-title">Full collection</span>
          <span className="choice-dialog-option-desc">
            Everything — all cards (including uncategorized) and all binder definitions.
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
