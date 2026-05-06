import { useRef, useState } from 'react';
import { useCollectionStore, type ImportMode } from '../store/collection';
import { importFile, importText } from '../lib/api';
import type { UploadResponse } from '../types';

export function UploadPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasteText, setPasteText] = useState('');
  const [mode, setMode] = useState<ImportMode>('replace');
  const [showUnresolved, setShowUnresolved] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const {
    fileName,
    cards,
    uploadedAt,
    isLoading,
    error,
    unresolvedNames,
    detectedFormat,
    importCards,
    clearCards,
    setLoading,
    setError,
  } = useCollectionStore();

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

  return (
    <div className="upload-panel">
      {hasCollection && (
        <div className="upload-current">
          <div className="upload-current-info">
            <span className="upload-current-icon">&#10003;</span>
            <div>
              <div className="upload-current-name">{fileName}</div>
              <div className="upload-current-meta">
                {cards.length.toLocaleString()} cards
                {uploadedAt ? ` · ${formatRelative(uploadedAt)}` : ''}
                {detectedFormat ? ` · ${detectedFormat}` : ''}
              </div>
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
            <button className="btn-link-danger" onClick={handleClear} disabled={isLoading}>
              Clear cached collection
            </button>
          </div>
        </div>
      )}

      {successMsg && !error && (
        <div className="success-banner">{successMsg}</div>
      )}

      {hasCollection && unresolvedNames.length > 0 && (
        <div className="unresolved-banner">
          <div className="unresolved-summary">
            <span>
              {unresolvedNames.length} card{unresolvedNames.length !== 1 ? 's' : ''} couldn't
              be matched to Scryfall data. These cards will appear without images or metadata.
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

      {hasCollection && importOpen && (
        <div className="import-mode-row">
          <span className="rule-label">When importing more</span>
          <label className="field-checkbox">
            <input
              type="radio"
              name="import-mode"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
            />
            Replace existing
          </label>
          <label className="field-checkbox">
            <input
              type="radio"
              name="import-mode"
              checked={mode === 'merge'}
              onChange={() => setMode('merge')}
            />
            Add to existing
          </label>
        </div>
      )}

      {importOpen && (
      <div className="upload-grid">
        {/* File side */}
        <div
          className={`upload-card ${isLoading ? 'loading' : ''}`}
          onClick={handlePickFile}
          role="button"
          tabIndex={0}
          aria-disabled={isLoading}
        >
          {isLoading ? (
            <>
              <div className="upload-icon">
                <span className="spinner" />
              </div>
              <div className="upload-text">Importing...</div>
              <div className="upload-sub">parsing &amp; resolving via Scryfall</div>
            </>
          ) : (
            <>
              <div className="upload-icon">&#128194;</div>
              <div className="upload-text">
                {hasCollection ? 'Import another file' : 'Upload a CSV file'}
              </div>
              <div className="upload-sub">
                ManaBox · Archidekt · Moxfield · Deckbox · or any CSV
              </div>
            </>
          )}
          <input
            type="file"
            ref={fileInputRef}
            accept=".csv,.tsv,.txt"
            style={{ display: 'none' }}
            onChange={handleFileChange}
            disabled={isLoading}
          />
        </div>

        {/* Paste side */}
        <div className="upload-card upload-card-paste">
          <div className="upload-icon">&#128203;</div>
          <div className="upload-text">Paste a card list</div>
          <textarea
            className="paste-textarea"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'1 Sol Ring\n4 Lightning Bolt\n1 Fire // Ice (APC) 128\nRhystic Study'}
            disabled={isLoading}
          />
          <div className="upload-sub">
            One per line · MTGA format · CSV · quantities supported
          </div>
          <button
            className="btn btn-primary"
            onClick={handlePasteImport}
            disabled={isLoading || !pasteText.trim()}
          >
            {isLoading ? 'Importing...' : 'Import list'}
          </button>
        </div>
      </div>
      )}

      {error && <div className="error-banner">{error}</div>}
    </div>
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
