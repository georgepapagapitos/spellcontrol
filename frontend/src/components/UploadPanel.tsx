import { Camera, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Suspense, lazy, useMemo, useRef, useState } from 'react';
import { formatRelativeTime } from '../lib/format-time';
import { haptics } from '../lib/haptics';
import { useCollectionStore, type ImportMode } from '../store/collection';
import { importFile, importRows, importText, type ImportProgressCallback } from '../lib/api';
import type { FetchErrorRow, UploadResponse } from '../types';
import { parseBackup } from '../lib/backup';
import { useConfirm } from '../lib/use-confirm';
import { findPriorImports } from '../lib/reimport';
import type { ImportHistoryEntry } from '../lib/local-cards';
import { summarizeImportRouting } from '../lib/import-routing';
import { useCardsWithTags, bindersUseTags } from '../lib/card-tags';
import { Modal } from './Modal';
import { useCanScan } from '../lib/use-can-scan';
import { useSealMoment } from './shared/SealMoment';

const CardScanner = lazy(() => import('./CardScanner').then((m) => ({ default: m.CardScanner })));
import { ProgressBar } from './ProgressBar';
import { StagedFileList } from './StagedFileList';
import { ImportRoutingSummary } from './ImportRoutingSummary';
import { mergeStagedFiles, stagedFilesNotice } from '../lib/staged-files';
import { useFileDrop } from '../lib/use-file-drop';
import { isNativePlatform } from '../lib/platform';
import { pickNativeFiles } from '../lib/native-file-picker';

const CSV_MIME_TYPES = ['text/csv', 'text/tab-separated-values', 'text/plain'];
const JSON_MIME_TYPES = ['application/json'];

interface PendingImport {
  /** Runs the actual import call. Omitted for staged-file batches. */
  fn?: (onProgress?: ImportProgressCallback) => Promise<UploadResponse>;
  /** Staged files to import sequentially (one history entry per file). */
  files?: File[];
  /** Display label — file name or "pasted-list". */
  label: string;
  /** Approximate item count for the prompt (line count for paste, file count for batches). */
  preview?: string;
  /** True for sample-set imports — flagged in history so users can find & delete them. */
  isSample?: boolean;
}

interface ImportProgressState {
  chunkIndex: number;
  totalChunks: number;
  /** Filename when importing a staged-file batch, undefined for paste/scan. */
  fileLabel?: string;
  /** 1-indexed file when batching multiple files. */
  fileIndex?: number;
  totalFiles?: number;
}

interface UploadPanelProps {
  /** Hide the "Scan cards" button in the panel header. Used when the
   *  panel renders inside a host (e.g. AddCardsSheet) that already
   *  exposes scanning as a peer entry point — two scan buttons in the
   *  same surface is confusing. */
  hideScanButton?: boolean;
}

export function UploadPanel({ hideScanButton = false }: UploadPanelProps = {}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [pasteText, setPasteText] = useState('');
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [stageNote, setStageNote] = useState<string | null>(null);
  const [showUnresolved, setShowUnresolved] = useState(false);
  const [showFetchErrors, setShowFetchErrors] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // Completion moment — the seal blooms once when an import lands (the
  // banner + haptic carry the substance; this is the visual counterpart
  // the haptic never had).
  const { fire: fireSealMoment, moment: sealMoment } = useSealMoment();
  /** ImportIds from the most recent runImport invocation. Drives the
   *  post-import "where did my cards go?" panel. Cleared whenever the user
   *  starts a new import or dismisses the panel. */
  const [recentImportIds, setRecentImportIds] = useState<Set<string>>(new Set());
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
  const [confirmingDeleteImports, setConfirmingDeleteImports] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const canScan = useCanScan();

  const rawCards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  // Decorate with oracle tags so "where did my import go?" respects tag rules
  // (no-op unless a binder uses one).
  const cards = useCardsWithTags(rawCards, bindersUseTags(binders));
  const isLoading = useCollectionStore((s) => s.isLoading);
  const error = useCollectionStore((s) => s.error);
  const unresolvedNames = useCollectionStore((s) => s.unresolvedNames);
  const fetchErrors = useCollectionStore((s) => s.fetchErrors);
  const importHistory = useCollectionStore((s) => s.importHistory);
  const importCards = useCollectionStore((s) => s.importCards);
  const deleteImports = useCollectionStore((s) => s.deleteImports);
  const clearCards = useCollectionStore((s) => s.clearCards);
  const setLoading = useCollectionStore((s) => s.setLoading);
  const setError = useCollectionStore((s) => s.setError);
  const restoreFromBackup = useCollectionStore((s) => s.restoreFromBackup);

  const hasCollection = cards.length > 0;
  const { confirm, dialog: confirmDialog } = useConfirm();

  const routingSummary = useMemo(
    () => summarizeImportRouting(recentImportIds, cards, binders),
    [recentImportIds, cards, binders]
  );

  const handlePickFile = async () => {
    if (isLoading) return;
    if (isNativePlatform()) {
      try {
        const files = await pickNativeFiles({ types: CSV_MIME_TYPES, multiple: true });
        stageIncoming(files);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't open file picker");
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const stageIncoming = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const { files, renamed, dropped } = mergeStagedFiles(stagedFiles, incoming);
    setStagedFiles(files);
    setStageNote(stagedFilesNotice(renamed, dropped));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = e.target.files ? Array.from(e.target.files) : [];
    if (fileInputRef.current) fileInputRef.current.value = '';
    stageIncoming(incoming);
  };

  const { isDragging, dropProps } = useFileDrop(stageIncoming, { disabled: isLoading });

  const handleRemoveStaged = (index: number) => {
    setStagedFiles((fs) => fs.filter((_, i) => i !== index));
    setStageNote(null);
  };

  const handleClearStaged = () => {
    setStagedFiles([]);
    setStageNote(null);
  };

  const handleImportStaged = () => {
    if (stagedFiles.length === 0 || isLoading) return;
    queueImport({
      files: stagedFiles,
      label: `${stagedFiles.length} files`,
      preview: `${stagedFiles.length} file${stagedFiles.length === 1 ? '' : 's'}`,
    });
  };

  const handlePasteImport = () => {
    const text = pasteText.trim();
    if (!text || isLoading) return;
    const lineCount = text.split('\n').filter((l) => l.trim()).length;
    queueImport({
      fn: (onProgress) => importText(text, onProgress),
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
    setRecentImportIds(new Set());
    setShowUnresolved(false);
    setShowFetchErrors(false);
    setImportProgress(null);
    const newImportIds = new Set<string>();
    try {
      if (p.files) {
        // Sequential batch: one history entry per file. For 'replace' the
        // first file wipes the collection and the rest append, so the net
        // result is the union of every file rather than just the last.
        const totalFiles = p.files.length;
        let totalCards = 0;
        let totalUnresolved = 0;
        const allFetchErrors: FetchErrorRow[] = [];
        for (let i = 0; i < p.files.length; i++) {
          const file = p.files[i];
          const result = await importFile(file, (prog) =>
            setImportProgress({
              chunkIndex: prog.chunkIndex,
              totalChunks: prog.totalChunks,
              fileLabel: file.name,
              fileIndex: i + 1,
              totalFiles,
            })
          );
          const fileMode: ImportMode = mode === 'replace' && i > 0 ? 'merge' : mode;
          const id = await importCards(result, file.name, fileMode, {
            isSample: p.isSample,
            binderName,
          });
          newImportIds.add(id);
          totalCards += result.cards.length;
          totalUnresolved += result.unresolvedNames.length;
          allFetchErrors.push(...result.fetchErrors);
        }
        // importCards stamps each file's own fetchErrors, so after the loop the
        // store only holds the last file's — restore the whole batch's bucket
        // so every withheld row stays retryable.
        if (allFetchErrors.length > 0) {
          useCollectionStore.setState({ fetchErrors: allFetchErrors });
        }
        const parts: string[] = [
          `Imported ${totalCards.toLocaleString()} cards from ${p.files.length} files`,
        ];
        if (totalUnresolved > 0) parts.push(`${totalUnresolved} unresolved`);
        if (allFetchErrors.length > 0) {
          parts.push(`${allFetchErrors.length} couldn't be fetched — retry below`);
        }
        if (mode === 'binder' && binderName) parts.push(`binder "${binderName}" created`);
        setSuccessMsg(parts.join(' · '));
        setStagedFiles([]);
        setStageNote(null);
        setRecentImportIds(newImportIds);
        haptics.success();
        fireSealMoment();
        return;
      }

      const result = await p.fn!((prog) =>
        setImportProgress({ chunkIndex: prog.chunkIndex, totalChunks: prog.totalChunks })
      );
      const id = await importCards(result, p.label, mode, {
        isSample: p.isSample,
        binderName,
      });
      newImportIds.add(id);
      const parts: string[] = [`Imported ${result.cards.length.toLocaleString()} cards`];
      if (result.scryfallHits > 0) {
        parts.push(`${result.scryfallHits.toLocaleString()} matched`);
      }
      if (result.unresolvedNames.length > 0) {
        parts.push(`${result.unresolvedNames.length} unresolved`);
      }
      if (result.fetchErrors.length > 0) {
        parts.push(`${result.fetchErrors.length} couldn't be fetched — retry below`);
      }
      if (mode === 'binder' && binderName) {
        parts.push(`binder "${binderName}" created`);
      }
      setSuccessMsg(parts.join(' · '));
      if (p.label === 'pasted-list') setPasteText('');
      setRecentImportIds(newImportIds);
      haptics.success();
      fireSealMoment();
    } catch (err) {
      const fallback = "Couldn't read that file. Double-check the format and try again.";
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setLoading(false);
      setImportProgress(null);
    }
  }

  /**
   * Retry the rows the last import withheld because the card service was
   * unreachable. The rows are POSTed back verbatim ({ rows }), so quantity /
   * printing / finish survive; anything that fails again lands back in the
   * store's fetchErrors bucket and the banner stays up.
   */
  const handleRetryFetchErrors = () => {
    if (fetchErrors.length === 0 || isLoading) return;
    const copies = fetchErrors.reduce((n, r) => n + Math.max(1, r.quantity ?? 1), 0);
    void runImport(
      {
        fn: () => importRows(fetchErrors),
        label: 'retried-cards',
        preview: `${copies} card${copies === 1 ? '' : 's'}`,
      },
      'merge'
    );
  };

  const handleClearAll = async () => {
    const ok = await confirm({
      title: 'Clear your collection?',
      body: "All cards will be removed. You'll need to re-import them.",
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
    await deleteImports(ids);
    setSelectedHistoryIds(new Set());
    setConfirmingDeleteImports(false);
    // deleteImports() already surfaces a "Removed N cards" toast with Undo —
    // clear any stale import banner rather than double-confirming inline.
    setSuccessMsg(null);
  };

  const handlePickBackup = async () => {
    if (isLoading) return;
    if (cards.length > 0 || binders.length > 0) {
      const ok = await confirm({
        title: 'Restore backup?',
        body: "This will replace your current collection and binders. This can't be undone.",
        confirmLabel: 'Restore',
        danger: true,
      });
      if (!ok) return;
    }
    if (isNativePlatform()) {
      try {
        const [file] = await pickNativeFiles({ types: JSON_MIME_TYPES, multiple: false });
        if (file) await applyBackupFile(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Restore failed');
      }
      return;
    }
    backupInputRef.current?.click();
  };

  const applyBackupFile = async (file: File) => {
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

  const handleBackupChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (backupInputRef.current) backupInputRef.current.value = '';
    if (file) await applyBackupFile(file);
  };

  return (
    <div className="upload-panel">
      {confirmDialog}
      {/* While the collection import / backup restore is running we
          surface a progress strip at the top of the panel. If the
          import was big enough to be chunked we show determinate
          progress per batch; otherwise (single small upload, backup
          restore) we fall back to the indeterminate animation. */}
      {isLoading && (
        <div className="upload-progress" role="status" aria-live="polite">
          {importProgress && importProgress.totalChunks > 1 ? (
            <ProgressBar
              percent={((importProgress.chunkIndex - 1) / importProgress.totalChunks) * 100}
              message={formatImportProgressMessage(importProgress)}
            />
          ) : (
            <ProgressBar indeterminate message="Importing your collection…" />
          )}
        </div>
      )}
      {sealMoment}
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

      {!error && routingSummary.entries.length > 0 && (
        <ImportRoutingSummary
          summary={routingSummary}
          onDismiss={() => setRecentImportIds(new Set())}
        />
      )}

      {fetchErrors.length > 0 && (
        <div className="unresolved-banner fetch-error-banner" role="alert">
          <div className="unresolved-summary">
            <span>
              {fetchErrors.length} card{fetchErrors.length !== 1 ? 's' : ''} couldn't be fetched —
              the card service was unreachable. They were <strong>not</strong> imported.
            </span>
            <span className="fetch-error-actions">
              <button className="btn-link" onClick={() => setShowFetchErrors((v) => !v)}>
                {showFetchErrors ? 'Hide list' : 'Show list'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleRetryFetchErrors}
                disabled={isLoading}
              >
                Retry
              </button>
            </span>
          </div>
          {showFetchErrors && (
            <ul className="unresolved-list">
              {fetchErrors.map((r, i) => (
                <li key={i}>{(r.quantity ?? 1) > 1 ? `${r.quantity}× ${r.name}` : r.name}</li>
              ))}
            </ul>
          )}
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
        <div
          className={`import-card file-dropzone${isDragging ? ' is-dragging' : ''}`}
          {...dropProps}
        >
          {isDragging && (
            <div className="file-drop-overlay" aria-hidden="true">
              <div className="file-drop-message">Drop file(s) to stage</div>
            </div>
          )}
          <div className="import-card-header">
            <h2 className="import-card-title">Import your collection</h2>
            <div className="import-card-header-actions">
              {canScan && !hideScanButton && (
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
                title="Upload one or more CSV/TSV files (ManaBox, Archidekt, Moxfield, Deckbox, etc.)"
              >
                {isLoading ? (
                  <span className="spinner" />
                ) : (
                  <Upload width={14} height={14} strokeWidth={1.8} aria-hidden />
                )}
                <span>Upload files</span>
              </button>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv,.tsv,.txt"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
              disabled={isLoading}
            />
          </div>

          <p className="import-card-desc">
            Paste a card list or upload CSVs — each card is matched to Scryfall and routed into your
            binders.
          </p>

          {stagedFiles.length > 0 ? (
            <>
              <StagedFileList
                files={stagedFiles}
                onRemove={handleRemoveStaged}
                onClear={handleClearStaged}
                disabled={isLoading}
              />
              <p className="import-card-desc">
                {stageNote ??
                  'Each file is imported as a separate entry in your import history. Upload more to add to this list.'}
              </p>
            </>
          ) : (
            <textarea
              className="paste-textarea import-textarea"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'4 Arcane Signet\n1 Cyclonic Rift\n2 Forest\n…'}
              disabled={isLoading}
            />
          )}

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
            {stagedFiles.length > 0 ? (
              <button className="btn btn-primary" onClick={handleImportStaged} disabled={isLoading}>
                {isLoading
                  ? 'Importing…'
                  : `Import ${stagedFiles.length} file${stagedFiles.length === 1 ? '' : 's'}`}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={handlePasteImport}
                disabled={isLoading || !pasteText.trim()}
              >
                {isLoading ? 'Importing…' : 'Import'}
              </button>
            )}
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
        <Suspense fallback={null}>
          <CardScanner
            onClose={() => setScannerOpen(false)}
            onConfirm={(text, count) => {
              setScannerOpen(false);
              queueImport({
                fn: (onProgress) => importText(text, onProgress),
                label: 'scanned-cards',
                preview: `${count} scanned card${count === 1 ? '' : 's'}`,
              });
            }}
          />
        </Suspense>
      )}

      {pendingImport && (
        <ImportModeDialog
          existingCount={cards.length}
          incomingPreview={pendingImport.preview}
          priorImports={findPriorImports(
            pendingImport.files ? pendingImport.files.map((f) => f.name) : [pendingImport.label],
            importHistory
          )}
          onPick={(mode, binderName) => runImport(pendingImport, mode, binderName)}
          onCancel={() => setPendingImport(null)}
        />
      )}

      {confirmingDeleteImports && (
        <DeleteImportsDialog
          imports={importHistory.filter((h) => selectedHistoryIds.has(h.id))}
          onConfirm={handleDeleteSelected}
          onCancel={() => setConfirmingDeleteImports(false)}
        />
      )}
    </div>
  );
}

interface DeleteImportsDialogProps {
  imports: Array<{ id: string; name: string; format: string; count: number }>;
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
      <p className="choice-dialog-body">Other cards stay where they are. This can't be undone.</p>
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
  /** Prior imports whose name matches an incoming source — a likely re-import. */
  priorImports?: ImportHistoryEntry[];
  onPick: (mode: ImportMode, binderName?: string) => void;
  onCancel: () => void;
}

function ImportModeDialog({
  existingCount,
  incomingPreview,
  priorImports,
  onPick,
  onCancel,
}: ImportModeDialogProps) {
  const [binderName, setBinderName] = useState('');
  const [showBinderInput, setShowBinderInput] = useState(false);

  // A re-import only stacks duplicates when there's already a collection to
  // stack onto; with an empty collection "Add" behaves like "Replace" anyway.
  const reimports = existingCount > 0 ? (priorImports ?? []) : [];
  const isReimport = reimports.length > 0;

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
          {incomingPreview ? ` and you're importing ${incomingPreview}` : ''}.
        </p>
      )}
      {isReimport && (
        <p className="choice-dialog-warning" role="alert">
          {reimports.length === 1 ? (
            <>
              You already imported <strong>{reimports[0].name}</strong> (
              {reimports[0].count.toLocaleString()} cards, {formatRelative(reimports[0].addedAt)}
              ).{' '}
            </>
          ) : (
            <>
              <strong>{reimports.length}</strong> of these were imported before:{' '}
              {reimports.map((r) => r.name).join(', ')}.{' '}
            </>
          )}
          “Add to collection” adds a <strong>second copy of every card</strong>. To refresh it
          instead, choose <strong>Replace collection</strong>.
        </p>
      )}
      <div className="choice-dialog-options">
        <button
          type="button"
          className="choice-dialog-option"
          onClick={() => onPick(existingCount > 0 ? 'merge' : 'replace')}
          autoFocus={!showBinderInput && !isReimport}
        >
          <span className="choice-dialog-option-title">Add to collection</span>
          <span className="choice-dialog-option-desc">
            {existingCount > 0
              ? isReimport
                ? 'Keeps the existing cards AND adds another full copy of this import — duplicates stack.'
                : 'Keep existing cards and append the new ones. Duplicates will stack.'
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
            autoFocus={isReimport && !showBinderInput}
          >
            <span className="choice-dialog-option-title">
              Replace collection{isReimport ? ' (recommended)' : ''}
            </span>
            <span className="choice-dialog-option-desc">
              {isReimport
                ? 'Wipe the current collection and load this import fresh — refreshes it with no duplicates.'
                : 'Wipe the current collection and start fresh with the imported cards.'}
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
  if (name === 'retried-cards') return 'Retried cards';
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

function formatImportProgressMessage(p: ImportProgressState): string {
  const batch = `batch ${p.chunkIndex} of ${p.totalChunks}`;
  if (p.totalFiles && p.totalFiles > 1 && p.fileLabel) {
    return `Importing ${p.fileLabel} (file ${p.fileIndex} of ${p.totalFiles}) — ${batch}…`;
  }
  if (p.fileLabel) return `Importing ${p.fileLabel} — ${batch}…`;
  return `Importing your collection — ${batch}…`;
}

function formatRelative(timestamp: number): string {
  return formatRelativeTime(timestamp, { verbose: true });
}
