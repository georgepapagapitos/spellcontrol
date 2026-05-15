import { Camera, RotateCcw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useCollectionStore, type ImportMode } from '../store/collection';
import { importFile, importText } from '../lib/api';
import type { UploadResponse } from '../types';
import { parseBackup } from '../lib/backup';
import { useConfirm } from '../lib/use-confirm';
import { Modal } from './Modal';
import { CardScanner } from './CardScanner';
import { useCanScan } from '../lib/use-can-scan';
import { ProgressBar } from './ProgressBar';

interface PendingImport {
  /** Runs the actual import call. */
  fn: () => Promise<UploadResponse>;
  /** Display label — file name or "pasted-list". */
  label: string;
  /** Approximate item count for the prompt (line count for paste, unknown for files). */
  preview?: string;
  /** True for sample-set imports — flagged in history so users can find & delete them. */
  isSample?: boolean;
}

export function UploadPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [pasteText, setPasteText] = useState('');
  const [showUnresolved, setShowUnresolved] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
  const [confirmingDeleteImports, setConfirmingDeleteImports] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const canScan = useCanScan();

  const cards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const isLoading = useCollectionStore((s) => s.isLoading);
  const error = useCollectionStore((s) => s.error);
  const unresolvedNames = useCollectionStore((s) => s.unresolvedNames);
  const importHistory = useCollectionStore((s) => s.importHistory);
  const importCards = useCollectionStore((s) => s.importCards);
  const deleteImports = useCollectionStore((s) => s.deleteImports);
  const clearCards = useCollectionStore((s) => s.clearCards);
  const setLoading = useCollectionStore((s) => s.setLoading);
  const setError = useCollectionStore((s) => s.setError);
  const restoreFromBackup = useCollectionStore((s) => s.restoreFromBackup);

  const hasCollection = cards.length > 0;
  const { confirm, dialog: confirmDialog } = useConfirm();

  const handlePickFile = () => {
    if (isLoading) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    queueImport({ fn: () => importFile(file), label: file.name, preview: file.name });
  };

  const handlePasteImport = () => {
    const text = pasteText.trim();
    if (!text || isLoading) return;
    const lineCount = text.split('\n').filter((l) => l.trim()).length;
    queueImport({
      fn: () => importText(text),
      label: 'pasted-list',
      preview: `${lineCount} line${lineCount === 1 ? '' : 's'}`,
    });
  };

  function queueImport(p: PendingImport) {
    setPendingImport(p);
  }

  async function runImport(p: PendingImport, mode: ImportMode, binderName?: string) {
    setPendingImport(null);
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setShowUnresolved(false);
    try {
      const result = await p.fn();
      await importCards(result, p.label, mode, {
        isSample: p.isSample,
        binderName,
      });
      const parts: string[] = [`Imported ${result.cards.length.toLocaleString()} cards`];
      if (result.scryfallHits > 0) {
        parts.push(`${result.scryfallHits.toLocaleString()} matched`);
      }
      if (result.unresolvedNames.length > 0) {
        parts.push(`${result.unresolvedNames.length} unresolved`);
      }
      if (mode === 'binder' && binderName) {
        parts.push(`binder "${binderName}" created`);
      }
      setSuccessMsg(parts.join(' · '));
      if (p.label === 'pasted-list') setPasteText('');
    } catch (err) {
      const fallback = 'Could not read that file. Double-check the format and try again.';
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setLoading(false);
    }
  }

  const handleClearAll = async () => {
    const ok = await confirm({
      title: 'Clear your collection?',
      body: 'All cards will be removed. You will need to re-import them.',
      confirmLabel: 'Clear all',
      danger: true,
    });
    if (!ok) return;
    await clearCards();
    setShowUnresolved(false);
    setSuccessMsg(null);
    setSelectedHistoryIds(new Set());
  };

  const toggleHistorySelection = (id: string) => {
    setSelectedHistoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedHistoryIds);
    if (ids.length === 0) return;
    const totalCount = importHistory
      .filter((h) => h.id && selectedHistoryIds.has(h.id))
      .reduce((sum, h) => sum + h.count, 0);
    await deleteImports(ids);
    setSelectedHistoryIds(new Set());
    setConfirmingDeleteImports(false);
    setSuccessMsg(
      `Removed ${ids.length} import${ids.length === 1 ? '' : 's'} · ${totalCount.toLocaleString()} card${totalCount === 1 ? '' : 's'}`
    );
  };

  const handlePickBackup = async () => {
    if (isLoading) return;
    if (cards.length > 0 || binders.length > 0) {
      const ok = await confirm({
        title: 'Restore backup?',
        body: 'This will replace your current collection and binders. This cannot be undone.',
        confirmLabel: 'Restore',
        danger: true,
      });
      if (!ok) return;
    }
    backupInputRef.current?.click();
  };

  const handleBackupChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (backupInputRef.current) backupInputRef.current.value = '';
    if (!file) return;

    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setShowUnresolved(false);
    try {
      const text = await file.text();
      const backup = parseBackup(text);
      await restoreFromBackup(backup);
      const parts: string[] = [];
      if (backup.collection) {
        parts.push(`${backup.collection.cards.length.toLocaleString()} cards`);
      }
      parts.push(`${backup.binders.length} binder${backup.binders.length === 1 ? '' : 's'}`);
      setSuccessMsg(`Backup restored · ${parts.join(' · ')}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="upload-panel">
      {confirmDialog}
      {/* While the collection import / backup restore is running we
          surface a single indeterminate progress strip at the top of
          the panel so the user gets clear feedback even when the
          import itself takes 10+ seconds. Mirrors the
          ImportDeckDialog progress UX so both surfaces communicate
          "working" the same way. */}
      {isLoading && (
        <div className="upload-progress" role="status" aria-live="polite">
          <ProgressBar indeterminate message="Importing your collection…" />
        </div>
      )}
      {successMsg && !error && (
        <div className="success-banner">
          <span>{successMsg}</span>
          <button
            type="button"
            className="banner-dismiss"
            onClick={() => setSuccessMsg(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {hasCollection && unresolvedNames.length > 0 && (
        <div className="unresolved-banner">
          <div className="unresolved-summary">
            <span>
              {unresolvedNames.length} card{unresolvedNames.length !== 1 ? 's' : ''} couldn't be
              matched to Scryfall data. These cards will appear without images or metadata.
            </span>
            <button className="btn-link" onClick={() => setShowUnresolved((v) => !v)}>
              {showUnresolved ? 'Hide list' : 'Show list'}
            </button>
          </div>
          {showUnresolved && (
            <ul className="unresolved-list">
              {unresolvedNames.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={`import-grid${hasCollection ? ' has-history' : ''}`}>
        <div className="import-card">
          <div className="import-card-header">
            <h2 className="import-card-title">Import your collection</h2>
            <div className="import-card-header-actions">
              {canScan && (
                <button
                  type="button"
                  className="btn import-upload-btn"
                  onClick={() => setScannerOpen(true)}
                  disabled={isLoading}
                  title="Scan physical cards with your device camera"
                >
                  <Camera width={14} height={14} strokeWidth={1.8} aria-hidden />
                  <span>Scan cards</span>
                </button>
              )}
              <button
                type="button"
                className="btn import-upload-btn"
                onClick={handlePickFile}
                disabled={isLoading}
                title="Upload a CSV/TSV file (ManaBox, Archidekt, Moxfield, Deckbox, etc.)"
              >
                {isLoading && <span className="spinner" />}
                <span>Upload CSV</span>
              </button>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv,.tsv,.txt"
              style={{ display: 'none' }}
              onChange={handleFileChange}
              disabled={isLoading}
            />
          </div>

          <p className="import-card-desc">
            Paste card names — plain text, MTGA format, or pasted CSV — or upload a CSV file. Each
            card gets matched against Scryfall and routed through your binder rules.
          </p>

          <textarea
            className="paste-textarea import-textarea"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'4 Arcane Signet\n1 Cyclonic Rift\n2 Forest\n…'}
            disabled={isLoading}
          />

          <div className="import-card-footer">
            <span className="import-card-hint">
              {'Plain CSV or TXT · '}
              <a href="https://manabox.app/" target="_blank" rel="noopener noreferrer">
                ManaBox
              </a>
              {' · '}
              <a href="https://archidekt.com/" target="_blank" rel="noopener noreferrer">
                Archidekt
              </a>
              {' · '}
              <a href="https://moxfield.com/" target="_blank" rel="noopener noreferrer">
                Moxfield
              </a>
              {' · '}
              <a href="https://deckbox.org/" target="_blank" rel="noopener noreferrer">
                Deckbox
              </a>
              {' · '}
              <a
                href="https://magic.wizards.com/en/mtgarena"
                target="_blank"
                rel="noopener noreferrer"
              >
                MTGA
              </a>
            </span>
            <button
              className="btn btn-primary"
              onClick={handlePasteImport}
              disabled={isLoading || !pasteText.trim()}
            >
              {isLoading ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>

        {hasCollection && (
          <aside className="import-history" aria-label="Import history">
            <h3 className="import-history-title">Import history</h3>
            {importHistory.length > 0 ? (
              <ul className="import-history-list">
                {[...importHistory]
                  .map((h, originalIdx) => ({ h, originalIdx }))
                  .reverse()
                  .map(({ h, originalIdx }) => {
                    const selectable = !!h.id;
                    const checked = !!h.id && selectedHistoryIds.has(h.id);
                    return (
                      <li key={originalIdx} className="import-history-item">
                        <label
                          className="import-history-check"
                          title={
                            selectable
                              ? 'Select this import to delete'
                              : 'This import predates the per-import delete feature and can only be removed via Clear all'
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!selectable || isLoading}
                            onChange={() => h.id && toggleHistorySelection(h.id)}
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
                            {h.count.toLocaleString()} cards · {formatRelative(h.addedAt)}
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
            <div className="import-history-footer">
              {selectedHistoryIds.size > 0 ? (
                <button
                  type="button"
                  className="upload-action upload-action-danger"
                  onClick={() => setConfirmingDeleteImports(true)}
                  disabled={isLoading}
                  title="Remove the selected imports and all cards they added"
                >
                  <Trash2 width={14} height={14} strokeWidth={1.6} aria-hidden />
                  <span>Delete selected ({selectedHistoryIds.size})</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="upload-action"
                    onClick={handlePickBackup}
                    disabled={isLoading}
                    title="Restore from a previously exported backup (replaces current data)"
                  >
                    <RotateCcw width={14} height={14} strokeWidth={1.6} aria-hidden />
                    <span>Restore</span>
                  </button>
                  <button
                    type="button"
                    className="upload-action upload-action-danger"
                    onClick={handleClearAll}
                    disabled={isLoading}
                    title="Clear all cards from your collection"
                  >
                    <Trash2 width={14} height={14} strokeWidth={1.6} aria-hidden />
                    <span>Clear all</span>
                  </button>
                </>
              )}
            </div>
          </aside>
        )}
      </div>

      <input
        type="file"
        ref={backupInputRef}
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={handleBackupChange}
        disabled={isLoading}
      />

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button
            type="button"
            className="banner-dismiss"
            onClick={() => setError(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {scannerOpen && (
        <CardScanner
          onClose={() => setScannerOpen(false)}
          onConfirm={(text, count) => {
            setScannerOpen(false);
            queueImport({
              fn: () => importText(text),
              label: 'scanned-cards',
              preview: `${count} scanned card${count === 1 ? '' : 's'}`,
            });
          }}
        />
      )}

      {pendingImport && (
        <ImportModeDialog
          existingCount={cards.length}
          incomingPreview={pendingImport.preview}
          onPick={(mode, binderName) => runImport(pendingImport, mode, binderName)}
          onCancel={() => setPendingImport(null)}
        />
      )}

      {confirmingDeleteImports && (
        <DeleteImportsDialog
          imports={importHistory.filter((h) => h.id && selectedHistoryIds.has(h.id))}
          onConfirm={handleDeleteSelected}
          onCancel={() => setConfirmingDeleteImports(false)}
        />
      )}
    </div>
  );
}

interface DeleteImportsDialogProps {
  imports: Array<{ id?: string; name: string; format: string; count: number }>;
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
      <p className="choice-dialog-body">Other cards stay where they are. This cannot be undone.</p>
      <div className="choice-dialog-actions">
        <button type="button" className="upload-action" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary upload-action-danger"
          onClick={onConfirm}
          autoFocus
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}

interface ImportModeDialogProps {
  existingCount: number;
  incomingPreview?: string;
  onPick: (mode: ImportMode, binderName?: string) => void;
  onCancel: () => void;
}

function ImportModeDialog({
  existingCount,
  incomingPreview,
  onPick,
  onCancel,
}: ImportModeDialogProps) {
  const [binderName, setBinderName] = useState('');
  const [showBinderInput, setShowBinderInput] = useState(false);

  const handleBinderSubmit = () => {
    const name = binderName.trim();
    if (!name) return;
    onPick('binder', name);
  };

  return (
    <Modal onClose={onCancel} labelledBy="import-mode-title">
      <h2 id="import-mode-title" className="choice-dialog-title">
        How should these cards be imported?
      </h2>
      {existingCount > 0 && (
        <p className="choice-dialog-body">
          You already have {existingCount.toLocaleString()} card{existingCount === 1 ? '' : 's'}{' '}
          loaded
          {incomingPreview ? ` and you are importing ${incomingPreview}` : ''}.
        </p>
      )}
      <div className="choice-dialog-options">
        <button
          type="button"
          className="choice-dialog-option"
          onClick={() => onPick(existingCount > 0 ? 'merge' : 'replace')}
          autoFocus={!showBinderInput}
        >
          <span className="choice-dialog-option-title">Add to collection</span>
          <span className="choice-dialog-option-desc">
            {existingCount > 0
              ? 'Keep existing cards and append the new ones. Duplicates will stack.'
              : 'Import these cards into your collection. They will be routed through your binder rules.'}
          </span>
        </button>
        {!showBinderInput ? (
          <button
            type="button"
            className="choice-dialog-option"
            onClick={() => setShowBinderInput(true)}
          >
            <span className="choice-dialog-option-title">Import as binder</span>
            <span className="choice-dialog-option-desc">
              Create a new binder with these cards in the order they were listed.
            </span>
          </button>
        ) : (
          <div className="choice-dialog-option choice-dialog-option-active">
            <span className="choice-dialog-option-title">Import as binder</span>
            <div className="binder-name-input-row">
              <input
                type="text"
                className="binder-name-input"
                placeholder="Binder name"
                value={binderName}
                onChange={(e) => setBinderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleBinderSubmit();
                }}
                autoFocus
                maxLength={60}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleBinderSubmit}
                disabled={!binderName.trim()}
              >
                Import
              </button>
            </div>
            <span className="choice-dialog-option-desc binder-import-note">
              Cards will also be added to your collection.
            </span>
          </div>
        )}
        {existingCount > 0 && (
          <button
            type="button"
            className="choice-dialog-option choice-dialog-option-danger"
            onClick={() => onPick('replace')}
          >
            <span className="choice-dialog-option-title">Replace collection</span>
            <span className="choice-dialog-option-desc">
              Wipe the current collection and start fresh with the imported cards.
            </span>
          </button>
        )}
      </div>
      <div className="choice-dialog-actions">
        <button type="button" className="upload-action" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/**
 * Replace the internal 'pasted-list' label with a friendlier name that names
 * the detected text format ("Pasted MTGA list", "Pasted Moxfield CSV", etc).
 */
function prettyImportName(name: string, format: string): string {
  if (name === 'scanned-cards') return 'Scanned cards';
  if (name !== 'pasted-list') return name;
  switch ((format || '').toLowerCase()) {
    case 'mtga':
      return 'Pasted MTGA list';
    case 'plain':
      return 'Pasted text';
    case 'manabox':
      return 'Pasted ManaBox CSV';
    case 'archidekt':
      return 'Pasted Archidekt CSV';
    case 'moxfield':
      return 'Pasted Moxfield CSV';
    case 'deckbox':
      return 'Pasted Deckbox CSV';
    case 'generic-csv':
      return 'Pasted CSV';
    default:
      return 'Pasted list';
  }
}

function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (days >= 7) {
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (minutes >= 1) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  return 'just now';
}
