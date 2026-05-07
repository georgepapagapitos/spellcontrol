import { useRef, useState } from 'react';
import { useCollectionStore, type ImportMode } from '../store/collection';
import { importFile, importText } from '../lib/api';
import type { UploadResponse } from '../types';
import { downloadBackup, parseBackup } from '../lib/backup';

export function UploadPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [pasteText, setPasteText] = useState('');
  const [mode, setMode] = useState<ImportMode>('replace');
  const [showUnresolved, setShowUnresolved] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fileName = useCollectionStore((s) => s.fileName);
  const cards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const uploadedAt = useCollectionStore((s) => s.uploadedAt);
  const isLoading = useCollectionStore((s) => s.isLoading);
  const error = useCollectionStore((s) => s.error);
  const unresolvedNames = useCollectionStore((s) => s.unresolvedNames);
  const detectedFormat = useCollectionStore((s) => s.detectedFormat);
  const importHistory = useCollectionStore((s) => s.importHistory);
  const importCards = useCollectionStore((s) => s.importCards);
  const clearCards = useCollectionStore((s) => s.clearCards);
  const setLoading = useCollectionStore((s) => s.setLoading);
  const setError = useCollectionStore((s) => s.setError);
  const buildBackupSnapshot = useCollectionStore((s) => s.buildBackupSnapshot);
  const restoreFromBackup = useCollectionStore((s) => s.restoreFromBackup);

  const hasCollection = cards.length > 0;
  // When a collection is loaded, the import area collapses to a thin bar; new users see the full UI.
  const importOpen = !hasCollection || expanded;

  const handlePickFile = () => {
    if (isLoading) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await runImport(() => importFile(file), file.name);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePasteImport = async () => {
    const text = pasteText.trim();
    if (!text || isLoading) return;
    await runImport(() => importText(text), 'pasted-list');
    setPasteText('');
  };

  async function runImport(fn: () => Promise<UploadResponse>, label: string) {
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setShowUnresolved(false);
    try {
      const result = await fn();
      await importCards(result, label, hasCollection ? mode : 'replace');
      const parts: string[] = [`Imported ${result.cards.length.toLocaleString()} cards`];
      if (result.scryfallHits > 0) {
        parts.push(`${result.scryfallHits.toLocaleString()} matched`);
      }
      if (result.unresolvedNames.length > 0) {
        parts.push(`${result.unresolvedNames.length} unresolved`);
      }
      setSuccessMsg(parts.join(' · '));
      setExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  }

  const handleClear = async () => {
    if (!confirm('Clear cached collection? You will need to re-import your cards.')) return;
    await clearCards();
    setShowUnresolved(false);
    setSuccessMsg(null);
    setExpanded(false);
  };

  const handleExportBackup = () => {
    try {
      const snapshot = buildBackupSnapshot();
      downloadBackup(snapshot);
      setError(null);
      const parts: string[] = [];
      if (snapshot.collection) {
        parts.push(`${snapshot.collection.cards.length.toLocaleString()} cards`);
      }
      parts.push(`${snapshot.binders.length} binder${snapshot.binders.length === 1 ? '' : 's'}`);
      setSuccessMsg(`Backup downloaded · ${parts.join(' · ')}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup failed');
    }
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
      setExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="upload-panel">
      {hasCollection && (
        <div className="upload-current">
          <div className="upload-current-info">
            <span className="upload-current-icon">&#10003;</span>
            <div className="upload-current-text">
              <div className="upload-current-name">
                {importHistory.length > 1
                  ? `${importHistory.length} imports merged`
                  : prettyImportName(
                      fileName || importHistory[0]?.name || 'Imported collection',
                      detectedFormat
                    )}
              </div>
              <div className="upload-current-meta">
                {cards.length.toLocaleString()} cards
                {uploadedAt ? ` · ${formatRelative(uploadedAt)}` : ''}
                {detectedFormat ? ` · ${detectedFormat}` : ''}
              </div>
              {importHistory.length > 1 && (
                <ul className="upload-current-history">
                  {importHistory.map((h, i) => (
                    <li key={i}>
                      <span className="upload-history-name">
                        {prettyImportName(h.name, h.format)}
                      </span>
                      <span className="upload-history-meta">
                        {h.count.toLocaleString()} cards · {formatRelative(h.addedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="upload-current-actions">
            <button
              className="btn-link"
              onClick={() => setExpanded((v) => !v)}
              disabled={isLoading}
              aria-expanded={importOpen}
            >
              {importOpen ? 'Hide import' : 'Import more'}
            </button>
            <button
              className="btn-link"
              onClick={handleExportBackup}
              disabled={isLoading}
              title="Download a JSON file containing your collection and binders"
            >
              Export backup
            </button>
            <button
              className="btn-link"
              onClick={handlePickBackup}
              disabled={isLoading}
              title="Restore from a previously exported backup (replaces current data)"
            >
              Restore backup
            </button>
            <button className="btn-link-danger" onClick={handleClear} disabled={isLoading}>
              Clear cached collection
            </button>
          </div>
        </div>
      )}

      {successMsg && !error && <div className="success-banner">{successMsg}</div>}

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

      {importOpen && (
        <div className="import-card">
          <div className="import-card-header">
            <h2 className="import-card-title">Import your collection</h2>
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
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv,.tsv,.txt"
              style={{ display: 'none' }}
              onChange={handleFileChange}
              disabled={isLoading}
            />
          </div>

          {hasCollection && (
            <div className="import-mode-row">
              <span className="import-mode-label">Mode:</span>
              <div className="import-mode-options" role="radiogroup">
                <button
                  type="button"
                  className={`import-mode-option ${mode === 'replace' ? 'active' : ''}`}
                  onClick={() => setMode('replace')}
                  role="radio"
                  aria-checked={mode === 'replace'}
                  title="Wipes the current collection and starts over"
                >
                  Replace
                </button>
                <button
                  type="button"
                  className={`import-mode-option ${mode === 'merge' ? 'active' : ''}`}
                  onClick={() => setMode('merge')}
                  role="radio"
                  aria-checked={mode === 'merge'}
                  title="Appends these cards onto the current collection"
                >
                  Add
                </button>
              </div>
              <span className="import-mode-hint">
                {mode === 'replace' ? 'wipes existing cards' : 'duplicates will stack'}
              </span>
            </div>
          )}

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

          {!hasCollection && (
            <div className="import-card-restore">
              Restoring from a previous export?{' '}
              <button
                type="button"
                className="btn-link"
                onClick={handlePickBackup}
                disabled={isLoading}
              >
                Restore backup
              </button>
            </div>
          )}
        </div>
      )}

      <input
        type="file"
        ref={backupInputRef}
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={handleBackupChange}
        disabled={isLoading}
      />

      {error && <div className="error-banner">{error}</div>}
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
