import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import './ImportHistorySheet.css';
import { useCollectionStore } from '../store/collection';
import { useLockBodyScroll } from '@/lib/overlays/use-lock-body-scroll';
import { useSheetExit } from '@/lib/overlays/use-sheet-exit';
import { formatRelativeTime } from '@/lib/util/format-time';
import { prettyImportName } from '@/lib/import-export/import-history-name';
import type { ImportHistoryEntry } from '@/lib/sync/local-cards';
import { Modal } from './Modal';
import { Button } from '@/components/shared/Button';

interface Props {
  onClose: () => void;
}

/**
 * Import history (D, board T153): moved out of the add-cards flow into its
 * own sheet, reachable from Collection ⋮ → "Import history". Same data and
 * per-import delete as the old UploadPanel aside; the delete confirm now
 * states the truth about Undo instead of contradicting the toast that
 * follows it (deleteImports() always offers one).
 */
export function ImportHistorySheet({ onClose }: Props) {
  const importHistory = useCollectionStore((s) => s.importHistory);
  const deleteImports = useCollectionStore((s) => s.deleteImports);
  const isLoading = useCollectionStore((s) => s.isLoading);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  useLockBodyScroll();
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(
    onClose,
    'binder-sheet-slide-out',
    { instantAt: '(min-width: 1024px)' }
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    await deleteImports(ids);
    setSelected(new Set());
    setConfirming(false);
  };

  return createPortal(
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) beginClose();
      }}
      role="presentation"
    >
      <div
        className={`card-picker-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-history-title"
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 id="import-history-title" className="card-picker-title">
            Import history
          </h2>
        </div>
        <div className="card-picker-list import-history-sheet-body">
          {importHistory.length > 0 ? (
            <ul className="import-history-list">
              {[...importHistory]
                .map((h, originalIdx) => ({ h, originalIdx }))
                .reverse()
                .map(({ h, originalIdx }) => {
                  const selectable = !!h.id;
                  const checked = !!h.id && selected.has(h.id);
                  return (
                    <li key={originalIdx} className="import-history-item">
                      <label
                        className="import-history-check"
                        title={
                          selectable
                            ? undefined
                            : 'This import predates per-import delete. Clear your collection in Settings to remove it.'
                        }
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!selectable || isLoading}
                          onChange={() => h.id && toggle(h.id)}
                          aria-label={`Select ${prettyImportName(h.name, h.format)}`}
                        />
                      </label>
                      <div className="import-history-text">
                        <div className="import-history-name">
                          <span className="import-history-name-label">
                            {prettyImportName(h.name, h.format)}
                          </span>
                        </div>
                        <div className="import-history-meta">
                          {h.count.toLocaleString()} card{h.count === 1 ? '' : 's'} ·{' '}
                          {formatRelativeTime(h.addedAt, { verbose: true })}
                          {h.format ? ` · ${h.format}` : ''}
                        </div>
                      </div>
                    </li>
                  );
                })}
            </ul>
          ) : (
            <p className="import-history-empty">No imports recorded for this collection.</p>
          )}
        </div>
        <div className="card-picker-footer">
          {selected.size > 0 ? (
            <Button
              variant="danger"
              onClick={() => setConfirming(true)}
              disabled={isLoading}
              icon={<Trash2 width={14} height={14} strokeWidth={1.8} aria-hidden />}
            >
              Delete selected ({selected.size})
            </Button>
          ) : (
            <Button variant="primary" onClick={() => beginClose()}>
              Done
            </Button>
          )}
        </div>
      </div>
      {confirming && (
        <DeleteImportsDialog
          imports={importHistory.filter((h) => selected.has(h.id))}
          onConfirm={() => void handleDeleteSelected()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>,
    document.body
  );
}

interface DeleteImportsDialogProps {
  imports: ImportHistoryEntry[];
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteImportsDialog({ imports, onConfirm, onCancel }: DeleteImportsDialogProps) {
  const totalCards = imports.reduce((sum, h) => sum + h.count, 0);
  return (
    <Modal onClose={onCancel} labelledBy="delete-imports-title">
      <h2 id="delete-imports-title" className="choice-dialog-title">
        Delete {imports.length} import{imports.length === 1 ? '' : 's'}?
      </h2>
      <p className="choice-dialog-body">
        This removes the {totalCards.toLocaleString()} card
        {totalCards === 1 ? '' : 's'} added by:
      </p>
      <ul className="delete-imports-list">
        {imports.map((h, i) => (
          <li key={i}>
            {prettyImportName(h.name, h.format)} · {h.count.toLocaleString()} cards
          </li>
        ))}
      </ul>
      {/* Truthful about Undo: the store's deleteImports() always offers one
          via the toast that follows, so "This can't be undone" (the old copy)
          contradicted it. */}
      <p className="choice-dialog-body">
        Other cards stay where they are. You can undo from the toast.
      </p>
      <div className="choice-dialog-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm} autoFocus>
          Delete
        </Button>
      </div>
    </Modal>
  );
}
