import { Camera, ChevronDown, ChevronRight, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Suspense, lazy, useId, useMemo, useRef, useState } from 'react';
import { formatRelativeTime } from '../lib/format-time';
import { haptics } from '../lib/haptics';
import { useCollectionStore, type ImportMode } from '../store/collection';
import { importFile, importRows, importText, type ImportProgressCallback } from '../lib/api';
import type { UploadResponse } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';
import { parseBackup } from '../lib/backup';
import { useConfirm } from '../lib/use-confirm';
import {
  findPriorImports,
  findContentReimportMatch,
  type ContentReimportMatch,
} from '../lib/reimport';
import type { ImportHistoryEntry } from '../lib/local-cards';
import { summarizeImportRouting } from '../lib/import-routing';
import {
  mergeImportResults,
  removeUnresolvedName,
  importReviewHeadline,
} from '../lib/import-review';
import { useCardsWithTags, bindersUseTags } from '../lib/card-tags';
import { Modal } from './Modal';
import { useCanScan } from '../lib/use-can-scan';
import { useSealMoment } from './shared/SealMoment';

const CardScanner = lazy(() => import('./CardScanner').then((m) => ({ default: m.CardScanner })));
import { ProgressBar } from './ProgressBar';
import { StagedFileList } from './StagedFileList';
import { ImportRoutingSummary } from './ImportRoutingSummary';
import { InlineCardSearch } from './InlineCardSearch';
import { InfoTip } from './InfoTip';
import { mergeStagedFiles, stagedFilesNotice } from '../lib/staged-files';
import { useFileDrop } from '../lib/use-file-drop';
import { isNativePlatform } from '../lib/platform';
import { pickNativeFiles } from '../lib/native-file-picker';

const CSV_MIME_TYPES = ['text/csv', 'text/tab-separated-values', 'text/plain'];
const JSON_MIME_TYPES = ['application/json'];

// Per-format column/line examples for the import-source InfoTip (E130 —
// discoverability for the 5 bare text links, which named the tools but
// never showed what their export actually looks like).
const IMPORT_FORMAT_EXAMPLES = (
  <>
    <p className="info-tip-lead">
      Every export is auto-detected from its columns — no need to pick a format:
    </p>
    <ul className="info-tip-list">
      <li>
        <strong>ManaBox</strong> CSV: <code>Name, Set code, Quantity, Foil, Scryfall ID</code>
      </li>
      <li>
        <strong>Archidekt / Deckbox</strong> CSV: <code>Quantity, Name, Edition, Condition</code>
      </li>
      <li>
        <strong>Moxfield</strong> CSV: <code>Count, Tradelist Count, Name, Edition</code>
      </li>
      <li>
        <strong>MTGA</strong>: one card per line, e.g. <code>4 Arcane Signet (KHM) 331</code>
      </li>
      <li>
        <strong>Plain text</strong>: one card per line, e.g. <code>4 Arcane Signet</code>
      </li>
    </ul>
  </>
);

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

/**
 * A 'merge' import whose parsed content looks like a probable re-import of a
 * prior one (see findContentReimportMatch). Parsing already happened — we
 * pause here rather than re-fetch, so the gate can resolve straight to a
 * commit either way.
 */
interface PendingReimportGate {
  p: PendingImport;
  binderName?: string;
  parsedFiles?: { file: File; result: UploadResponse }[];
  singleResult?: UploadResponse;
  match: ContentReimportMatch;
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
  // Raw lines the parser couldn't turn into a row at all (bad column count, no
  // name, …) from the most recent import. Session-local like the other import
  // banners' toggle state — cleared on the next import or Clear all.
  const [malformedRows, setMalformedRows] = useState<string[]>([]);
  const [showMalformed, setShowMalformed] = useState(false);
  // Completion moment — the seal blooms once when an import lands (the
  // banner + haptic carry the substance; this is the visual counterpart
  // the haptic never had).
  const { fire: fireSealMoment, moment: sealMoment } = useSealMoment();
  /** ImportIds from the most recent runImport invocation. Drives the
   *  post-import "where did my cards go?" panel. Cleared whenever the user
   *  starts a new import or dismisses the panel. */
  const [recentImportIds, setRecentImportIds] = useState<Set<string>>(new Set());
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [pendingReimportGate, setPendingReimportGate] = useState<PendingReimportGate | null>(null);
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

  // Single review/summary surface (E130): one container covers the
  // success line, routing rows, and every fidelity bucket (fetch errors /
  // malformed rows / unresolved names) instead of up to four stacked
  // banners. Shown whenever any of those has something to say.
  const showImportReview =
    !!successMsg ||
    routingSummary.entries.length > 0 ||
    fetchErrors.length > 0 ||
    malformedRows.length > 0 ||
    (hasCollection && unresolvedNames.length > 0);
  const reviewHeadline = importReviewHeadline({
    fetchErrorCount: fetchErrors.length,
    unresolvedCount: hasCollection ? unresolvedNames.length : 0,
  });

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

  /**
   * Commits an already-parsed staged-file batch. Split out of runImport so
   * the reimport gate can pause AFTER parsing (we need the parsed cards to
   * check content overlap) but BEFORE anything is written to the store.
   */
  async function commitFiles(
    parsedFiles: { file: File; result: UploadResponse }[],
    mode: ImportMode,
    p: PendingImport,
    binderName?: string
  ) {
    // Sequential batch: one history entry per file. For 'replace' the
    // first file wipes the collection and the rest append, so the net
    // result is the union of every file rather than just the last.
    const newImportIds = new Set<string>();
    for (let i = 0; i < parsedFiles.length; i++) {
      const { file, result } = parsedFiles[i];
      const fileMode: ImportMode = mode === 'replace' && i > 0 ? 'merge' : mode;
      const id = await importCards(result, file.name, fileMode, {
        isSample: p.isSample,
        binderName,
      });
      newImportIds.add(id);
    }
    const totals = mergeImportResults(parsedFiles.map((f) => f.result));
    const allFetchErrors = parsedFiles.flatMap((f) => f.result.fetchErrors);
    const allMalformedRows = parsedFiles.flatMap((f) => f.result.malformedRows);
    // importCards stamps each file's own fetchErrors, so after the loop the
    // store only holds the last file's — restore the whole batch's bucket
    // so every withheld row stays retryable.
    if (allFetchErrors.length > 0) {
      useCollectionStore.setState({ fetchErrors: allFetchErrors });
    }
    setMalformedRows(allMalformedRows);
    const parts: string[] = [
      `Imported ${totals.cardsImported.toLocaleString()} cards from ${parsedFiles.length} files`,
    ];
    if (totals.unresolvedCount > 0) parts.push(`${totals.unresolvedCount} unresolved`);
    if (allFetchErrors.length > 0) {
      parts.push(`${allFetchErrors.length} couldn't be fetched — retry below`);
    }
    if (allMalformedRows.length > 0) {
      parts.push(`${allMalformedRows.length} rows couldn't be read`);
    }
    if (totals.skippedUnownedCount > 0) {
      parts.push(`${totals.skippedUnownedCount} unowned rows skipped`);
    }
    if (totals.clampedCount > 0) {
      parts.push(`${totals.clampedCount} rows over the copy limit — capped`);
    }
    if (mode === 'binder' && binderName) parts.push(`binder "${binderName}" created`);
    setSuccessMsg(parts.join(' · '));
    setStagedFiles([]);
    setStageNote(null);
    setRecentImportIds(newImportIds);
    haptics.success();
    fireSealMoment();
  }

  /** Commits an already-parsed paste/scan/retry result. Sibling of commitFiles. */
  async function commitSingle(
    result: UploadResponse,
    mode: ImportMode,
    p: PendingImport,
    binderName?: string
  ) {
    const id = await importCards(result, p.label, mode, {
      isSample: p.isSample,
      binderName,
    });
    setMalformedRows(result.malformedRows);
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
    if (result.malformedRows.length > 0) {
      parts.push(`${result.malformedRows.length} rows couldn't be read`);
    }
    if (result.skippedUnownedRows > 0) {
      parts.push(
        `${result.skippedUnownedRows} unowned row${result.skippedUnownedRows !== 1 ? 's' : ''} skipped`
      );
    }
    if (result.clampedRows > 0) {
      parts.push(
        `${result.clampedRows} row${result.clampedRows !== 1 ? 's' : ''} over the copy limit — capped`
      );
    }
    if (mode === 'binder' && binderName) {
      parts.push(`binder "${binderName}" created`);
    }
    setSuccessMsg(parts.join(' · '));
    if (p.label === 'pasted-list') setPasteText('');
    setRecentImportIds(new Set([id]));
    haptics.success();
    fireSealMoment();
  }

  /**
   * Replacing a non-empty collection is destructive (Undo toast is the
   * second net, not the first) — confirm before it runs. An empty collection
   * has nothing to lose, so no nag.
   */
  async function confirmReplaceCollection(): Promise<boolean> {
    if (cards.length === 0) return true;
    return confirm({
      title: 'Replace your collection?',
      body: `This replaces your ${cards.length.toLocaleString()} card${
        cards.length === 1 ? '' : 's'
      } with this file's contents. You can undo it right after.`,
      confirmLabel: 'Replace',
      danger: true,
    });
  }

  async function runImport(
    p: PendingImport,
    mode: ImportMode,
    binderName?: string,
    skipReimportGate = false
  ) {
    setPendingImport(null);
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setRecentImportIds(new Set());
    setShowUnresolved(false);
    setShowFetchErrors(false);
    setMalformedRows([]);
    setShowMalformed(false);
    setImportProgress(null);
    try {
      if (p.files) {
        const totalFiles = p.files.length;
        const parsedFiles: { file: File; result: UploadResponse }[] = [];
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
          parsedFiles.push({ file, result });
        }
        if (mode === 'merge' && !skipReimportGate) {
          const match = findContentReimportMatch(
            parsedFiles.flatMap((f) => f.result.cards),
            importHistory,
            rawCards
          );
          if (match) {
            setPendingReimportGate({ p, binderName, parsedFiles, match });
            return;
          }
        }
        await commitFiles(parsedFiles, mode, p, binderName);
        return;
      }

      const result = await p.fn!((prog) =>
        setImportProgress({ chunkIndex: prog.chunkIndex, totalChunks: prog.totalChunks })
      );
      if (mode === 'merge' && !skipReimportGate) {
        const match = findContentReimportMatch(result.cards, importHistory, rawCards);
        if (match) {
          setPendingReimportGate({ p, binderName, singleResult: result, match });
          return;
        }
      }
      await commitSingle(result, mode, p, binderName);
    } catch (err) {
      const fallback = "Couldn't read that file. Double-check the format and try again.";
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setLoading(false);
      setImportProgress(null);
    }
  }

  /** Resolves the reimport gate: Replace (confirmed), Merge anyway, or Cancel. */
  async function resolveReimportGate(choice: 'replace' | 'merge' | 'cancel') {
    const gate = pendingReimportGate;
    if (!gate) return;
    setPendingReimportGate(null);
    if (choice === 'cancel') return;
    if (choice === 'replace') {
      const ok = await confirmReplaceCollection();
      if (!ok) return;
    }
    setLoading(true);
    setError(null);
    try {
      if (gate.parsedFiles) {
        await commitFiles(gate.parsedFiles, choice, gate.p, gate.binderName);
      } else if (gate.singleResult) {
        await commitSingle(gate.singleResult, choice, gate.p, gate.binderName);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't complete the import.");
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
      'merge',
      undefined,
      // Retrying withheld rows from the import that's already in the store —
      // not a fresh re-import — so it never needs the reimport gate.
      true
    );
  };

  /**
   * Clears the informational part of the review surface (the success
   * sentence + "where did my cards go?" routing rows). Actionable buckets
   * (fetch errors, malformed rows, unresolved names) keep their own
   * dismiss/repair affordances — this never drops data a Retry or Fix
   * still needs (E72 contract: fetchErrors stays a retryable outage
   * bucket, not something a summary dismiss can silently lose).
   */
  const handleDismissReviewSummary = () => {
    setSuccessMsg(null);
    setRecentImportIds(new Set());
  };

  /**
   * Inline repair (E130): the user matched an unresolved name to a real
   * Scryfall card via the review surface's per-name search and it was
   * added to the collection (InlineCardSearch's own addCard path) — drop
   * the name from the withheld-names bucket so the row shows as fixed.
   * Reads the store's live unresolvedNames rather than the closed-over
   * value so two repairs landing close together can't clobber each other.
   */
  const handleNameRepaired = (name: string) => {
    useCollectionStore.setState((s) => ({
      unresolvedNames: removeUnresolvedName(s.unresolvedNames, name),
    }));
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
    setMalformedRows([]);
    setShowMalformed(false);
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
    setMalformedRows([]);
    setShowMalformed(false);
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
      {!error && showImportReview && (
        <div className="import-review" role="status" aria-live="polite">
          <div className="import-review-header">
            <span className="import-review-title">{reviewHeadline}</span>
            {(successMsg || routingSummary.entries.length > 0) && (
              <button
                type="button"
                className="banner-dismiss"
                onClick={handleDismissReviewSummary}
                aria-label="Dismiss import summary"
              >
                ×
              </button>
            )}
          </div>

          {successMsg && <p className="import-review-line">{successMsg}</p>}

          {routingSummary.entries.length > 0 && (
            <div className="import-review-section import-review-section--routing">
              <ImportRoutingSummary summary={routingSummary} />
            </div>
          )}

          {fetchErrors.length > 0 && (
            <div className="import-review-section import-review-section--warn" role="alert">
              <div className="unresolved-summary">
                <span>
                  {fetchErrors.length} card{fetchErrors.length !== 1 ? 's' : ''} couldn't be fetched
                  — the card service was unreachable. They were <strong>not</strong> imported.
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

          {malformedRows.length > 0 && (
            <div className="import-review-section import-review-section--warn" role="alert">
              <div className="unresolved-summary">
                <span>
                  {malformedRows.length} row{malformedRows.length !== 1 ? 's' : ''} couldn't be read
                  at all — they were <strong>not</strong> imported.
                </span>
                <span className="fetch-error-actions">
                  <button className="btn-link" onClick={() => setShowMalformed((v) => !v)}>
                    {showMalformed ? 'Hide list' : 'Show list'}
                  </button>
                  <button
                    type="button"
                    className="banner-dismiss"
                    onClick={() => setMalformedRows([])}
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </span>
              </div>
              {showMalformed && (
                <ul className="unresolved-list">
                  {malformedRows.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {hasCollection && unresolvedNames.length > 0 && (
            <div className="import-review-section import-review-section--warn">
              <div className="unresolved-summary">
                <span>
                  {unresolvedNames.length} card{unresolvedNames.length !== 1 ? 's' : ''} couldn't be
                  matched to Scryfall data. Fix them inline below, or leave them — they'll stay in
                  your collection without images or metadata.
                </span>
                <button className="btn-link" onClick={() => setShowUnresolved((v) => !v)}>
                  {showUnresolved ? 'Hide list' : 'Show list'}
                </button>
              </div>
              {showUnresolved && (
                <ul className="unresolved-repair-list">
                  {unresolvedNames.map((n) => (
                    <UnresolvedNameRow
                      key={n}
                      name={n}
                      disabled={isLoading}
                      onResolved={handleNameRepaired}
                    />
                  ))}
                </ul>
              )}
            </div>
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
              </a>{' '}
              <InfoTip
                label="supported import formats"
                ariaLabel="What do these import formats look like?"
                text={IMPORT_FORMAT_EXAMPLES}
                wide
              />
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
          onPick={async (mode, binderName) => {
            if (mode === 'replace') {
              const ok = await confirmReplaceCollection();
              if (!ok) return;
            }
            void runImport(pendingImport, mode, binderName);
          }}
          onCancel={() => setPendingImport(null)}
        />
      )}

      {pendingReimportGate && (
        <ReimportGateDialog
          match={pendingReimportGate.match}
          onReplace={() => void resolveReimportGate('replace')}
          onMergeAnyway={() => void resolveReimportGate('merge')}
          onCancel={() => void resolveReimportGate('cancel')}
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

interface UnresolvedNameRowProps {
  /** The name Scryfall couldn't match, verbatim from the import. */
  name: string;
  disabled?: boolean;
  /** Called once a Scryfall match for this name has been added to the collection. */
  onResolved: (name: string) => void;
}

/**
 * One row of the review surface's unresolved-names section (E130). Repair
 * is inline: "Fix" expands a search pre-filled with the withheld name —
 * reusing InlineCardSearch (the same Scryfall search/autocomplete + add
 * machinery quick-add and the collection search panel use) rather than a
 * bespoke lookup. The prefilled text doubles as the manual-search fallback
 * — the user can edit it if the suggestions for the literal withheld text
 * don't include the right card. `compact` view keeps the row list light
 * for what's usually a handful of typos, not a full result grid.
 */
function UnresolvedNameRow({ name, disabled, onResolved }: UnresolvedNameRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState(name);
  const [resolvedAs, setResolvedAs] = useState<string | null>(null);
  const inputId = useId();

  if (resolvedAs) {
    return (
      <li className="unresolved-repair-row unresolved-repair-row--resolved">
        <span className="unresolved-repair-name">{name}</span>
        <span className="unresolved-repair-resolved-note">→ added “{resolvedAs}”</span>
      </li>
    );
  }

  return (
    <li className="unresolved-repair-row">
      <div className="unresolved-repair-row-head">
        <span className="unresolved-repair-name" title={name}>
          {name}
        </span>
        <button
          type="button"
          className="btn-link unresolved-repair-toggle"
          onClick={() => setExpanded((v) => !v)}
          disabled={disabled}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown width={12} height={12} strokeWidth={2} aria-hidden />
          ) : (
            <ChevronRight width={12} height={12} strokeWidth={2} aria-hidden />
          )}
          Fix
        </button>
      </div>
      {expanded && (
        <div className="unresolved-repair-search">
          <label className="visually-hidden" htmlFor={inputId}>
            {`Search Scryfall to fix "${name}"`}
          </label>
          <input
            id={inputId}
            type="text"
            className="unresolved-repair-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search card name…"
            disabled={disabled}
            autoFocus
          />
          <InlineCardSearch
            query={query}
            view="compact"
            onAdded={(card: ScryfallCard) => {
              setResolvedAs(card.name);
              onResolved(name);
            }}
          />
        </div>
      )}
    </li>
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

interface ReimportGateDialogProps {
  match: ContentReimportMatch;
  onReplace: () => void;
  onMergeAnyway: () => void;
  onCancel: () => void;
}

/**
 * Hard stop for a merge-mode import whose parsed content overlaps a prior
 * import above findContentReimportMatch's threshold — strong enough evidence
 * that this is a duplicate of cards already owned, not just a filename
 * coincidence. Merge stays one click away ("Merge anyway"); it just can't
 * happen by accident anymore.
 */
function ReimportGateDialog({
  match,
  onReplace,
  onMergeAnyway,
  onCancel,
}: ReimportGateDialogProps) {
  const { entry } = match;
  return (
    <Modal onClose={onCancel} labelledBy="reimport-gate-title">
      <h2 id="reimport-gate-title" className="choice-dialog-title">
        This looks like a re-import
      </h2>
      <p className="choice-dialog-warning" role="alert">
        These cards closely match an import you already made —{' '}
        <strong>{prettyImportName(entry.name, entry.format)}</strong> (
        {entry.count.toLocaleString()} cards, {formatRelative(entry.addedAt)}). Merging will add a{' '}
        <strong>second copy of every card</strong>. To refresh it instead, choose{' '}
        <strong>Replace</strong>.
      </p>
      <div className="choice-dialog-actions">
        <button type="button" className="upload-action" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="upload-action" onClick={onMergeAnyway}>
          Merge anyway
        </button>
        <button
          type="button"
          className="btn btn-primary upload-action-danger"
          onClick={onReplace}
          autoFocus
        >
          Replace instead
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
