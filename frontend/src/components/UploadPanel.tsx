import { useRef, useState } from 'react';
import { useCollectionStore, type ImportMode } from '../store/collection';
import { importFile, importText } from '../lib/api';
import type { UploadResponse } from '../types';
import { parseBackup } from '../lib/backup';

interface PendingImport {
  /** Runs the actual import call. */
  fn: () => Promise<UploadResponse>;
  /** Display label — file name or "pasted-list". */
  label: string;
  /** Approximate item count for the prompt (line count for paste, unknown for files). */
  preview?: string;
}

export function UploadPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [pasteText, setPasteText] = useState('');
  const [showUnresolved, setShowUnresolved] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

  const cards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const isLoading = useCollectionStore((s) => s.isLoading);
  const error = useCollectionStore((s) => s.error);
  const unresolvedNames = useCollectionStore((s) => s.unresolvedNames);
  const importHistory = useCollectionStore((s) => s.importHistory);
  const importCards = useCollectionStore((s) => s.importCards);
  const clearCards = useCollectionStore((s) => s.clearCards);
  const setLoading = useCollectionStore((s) => s.setLoading);
  const setError = useCollectionStore((s) => s.setError);
  const restoreFromBackup = useCollectionStore((s) => s.restoreFromBackup);

  const hasCollection = cards.length > 0;

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
    if (hasCollection) {
      setPendingImport(p);
    } else {
      // First-time import: skip the prompt and replace.
      runImport(p, 'replace');
    }
  }

  async function runImport(p: PendingImport, mode: ImportMode) {
    setPendingImport(null);
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setShowUnresolved(false);
    try {
      const result = await p.fn();
      await importCards(result, p.label, mode);
      const parts: string[] = [`Imported ${result.cards.length.toLocaleString()} cards`];
      if (result.scryfallHits > 0) {
        parts.push(`${result.scryfallHits.toLocaleString()} matched`);
      }
      if (result.unresolvedNames.length > 0) {
        parts.push(`${result.unresolvedNames.length} unresolved`);
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
    if (!confirm('Clear all cards from your collection? You will need to re-import them.')) return;
    await clearCards();
    setShowUnresolved(false);
    setSuccessMsg(null);
  };

  const handlePickBackup = () => {
    if (isLoading) return;
    backupInputRef.current?.click();
  };

  const handleBackupChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (backupInputRef.current) backupInputRef.current.value = '';
    if (!file) return;

    if (cards.length > 0 || binders.length > 0) {
      const ok = confirm(
        'Restoring a backup will replace your current collection and binders. Continue?'
      );
      if (!ok) return;
    }

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
          {!hasCollection && (
            <p className="import-card-tagline">Plan your binder before you touch a card.</p>
          )}
          <div className="import-card-header">
            <h2 className="import-card-title">Import your collection</h2>
            <div className="import-card-header-actions">
              <button
                type="button"
                className="upload-action"
                onClick={handlePickBackup}
                disabled={isLoading}
                title="Restore from a previously exported backup (replaces current data)"
              >
                <RestoreIcon />
                <span>Restore</span>
              </button>
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
              ManaBox · Archidekt · Moxfield · Deckbox · MTGA · plain CSV
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
                  .map(({ h, originalIdx }) => (
                    <li key={originalIdx} className="import-history-item">
                      <div className="import-history-name">
                        {prettyImportName(h.name, h.format)}
                      </div>
                      <div className="import-history-meta">
                        {h.count.toLocaleString()} cards · {formatRelative(h.addedAt)}
                        {h.format ? ` · ${h.format}` : ''}
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="import-history-empty">No imports recorded for this collection.</p>
            )}
            <div className="import-history-footer">
              <button
                type="button"
                className="upload-action upload-action-danger"
                onClick={handleClearAll}
                disabled={isLoading}
                title="Clear all cards from your collection"
              >
                <ClearIcon />
                <span>Clear all</span>
              </button>
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

      {pendingImport && (
        <ImportModeDialog
          existingCount={cards.length}
          incomingPreview={pendingImport.preview}
          onPick={(mode) => runImport(pendingImport, mode)}
          onCancel={() => setPendingImport(null)}
        />
      )}
    </div>
  );
}

interface ImportModeDialogProps {
  existingCount: number;
  incomingPreview?: string;
  onPick: (mode: ImportMode) => void;
  onCancel: () => void;
}

function ImportModeDialog({
  existingCount,
  incomingPreview,
  onPick,
  onCancel,
}: ImportModeDialogProps) {
  return (
    <div className="modal-backdrop" onClick={onCancel} role="presentation">
      <div
        className="choice-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-mode-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="import-mode-title" className="choice-dialog-title">
          Replace or add to your collection?
        </h2>
        <p className="choice-dialog-body">
          You already have {existingCount.toLocaleString()} card{existingCount === 1 ? '' : 's'}{' '}
          loaded
          {incomingPreview ? ` and you're importing ${incomingPreview}` : ''}. Pick how to handle
          the new cards.
        </p>
        <div className="choice-dialog-options">
          <button
            type="button"
            className="choice-dialog-option"
            onClick={() => onPick('merge')}
            autoFocus
          >
            <span className="choice-dialog-option-title">Add</span>
            <span className="choice-dialog-option-desc">
              Keep existing cards and append the new ones. Duplicates will stack.
            </span>
          </button>
          <button
            type="button"
            className="choice-dialog-option choice-dialog-option-danger"
            onClick={() => onPick('replace')}
          >
            <span className="choice-dialog-option-title">Replace</span>
            <span className="choice-dialog-option-desc">
              Wipe the current collection and start fresh with the imported cards.
            </span>
          </button>
        </div>
        <div className="choice-dialog-actions">
          <button type="button" className="upload-action" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Replace the internal 'pasted-list' label with a friendlier name that names
 * the detected text format ("Pasted MTGA list", "Pasted Moxfield CSV", etc).
 */
function prettyImportName(name: string, format: string): string {
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

function ClearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 4h10M6.5 4V2.5h3V4M5 4l.6 8.5a1 1 0 0 0 1 .9h2.8a1 1 0 0 0 1-.9L11 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 8a5 5 0 1 1 1.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M3 4v3.5h3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
