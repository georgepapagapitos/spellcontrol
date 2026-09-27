import { Camera, ChevronDown, ChevronRight, Cloud, Link2, Upload } from 'lucide-react';
import { Suspense, lazy, useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatRelativeTime } from '../lib/format-time';
import { haptics } from '../lib/haptics';
import { usePushProgress } from '../lib/use-push-progress';
import type { PushProgress } from '../lib/sync';
import { useCollectionStore, type ImportMode } from '../store/collection';
import {
  fetchImportLink,
  importFile,
  importRows,
  importText,
  type ImportProgressCallback,
} from '../lib/api';
import type { UploadResponse } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';
import { useConfirm } from '../lib/use-confirm';
import {
  findPriorImports,
  findContentReimportMatch,
  type ContentReimportMatch,
} from '../lib/reimport';
import { prettyImportName } from '../lib/import-history-name';
import { summarizeImportRouting } from '../lib/import-routing';
import {
  mergeImportResults,
  removeUnresolvedName,
  importReviewHeadline,
  fetchErrorMessage,
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
import { ChoiceList, Disclosure, Field, SwitchRow } from './shared/form';
import { mergeStagedFiles, stagedFilesNotice } from '../lib/staged-files';
import { useFileDrop } from '../lib/use-file-drop';
import {
  googlePickerAvailable,
  isCancelled,
  pickFromGoogleDrive,
  warmGooglePicker,
} from '../lib/google-picker';

import { userMessage } from '@/lib/user-error';
import { Button } from '@/components/shared/Button';

// Per-format column/line examples for the import-source InfoTip (E130 —
// discoverability for the 5 bare text links, which named the tools but
// never showed what their export actually looks like).
const IMPORT_FORMAT_EXAMPLES = (
  <>
    <p className="info-tip-lead">
      Every export is auto-detected from its columns. No need to pick a format:
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
  /** "Mark all as proxies" toggle at import time — stamped on the request, not the scan path. */
  proxy?: boolean;
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
  const [pasteText, setPasteText] = useState('');
  /** Google Sheets / Drive share link, fetched server-side and staged as a file. */
  const [linkUrl, setLinkUrl] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const linkInputId = useId();
  const [driveBusy, setDriveBusy] = useState(false);
  /** An un-keyed build has no credentials, and falls back to the link field. */
  const canPickDrive = googlePickerAvailable();
  // Load Google's scripts before the click, not during it: awaiting them inside
  // the handler spends the user activation the consent popup needs, and the
  // browser then blocks it outright. See warmGooglePicker.
  useEffect(() => {
    if (canPickDrive) warmGooglePicker();
  }, [canPickDrive]);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [stageNote, setStageNote] = useState<string | null>(null);
  const [showUnresolved, setShowUnresolved] = useState(false);
  const [showFetchErrors, setShowFetchErrors] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // Raw lines the parser couldn't turn into a row at all (bad column count, no
  // name, …) from the most recent import. Session-local like the other import
  // banners' toggle state — cleared on the next import.
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
  const [pendingReimportGate, setPendingReimportGate] = useState<PendingReimportGate | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  /** Parsing is done and the cards are being written to the device. */
  const [savingLocally, setSavingLocally] = useState(false);
  /** Slice progress of the background server push, once the panel has let go. */
  const pushProgress = usePushProgress();
  const [scannerOpen, setScannerOpen] = useState(false);
  const canScan = useCanScan();
  /** "These are all proxies" toggle — applies to paste + file-drop, NOT the scan path. */
  const [markAsProxies, setMarkAsProxies] = useState(false);
  // How this import lands — default is a plain add; the rarer choices live in
  // the "Options" disclosure below so a click on Import never stops for a
  // dialog (D, board T153).
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [binderName, setBinderName] = useState('');
  const binderNameId = useId();

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
  const setLoading = useCollectionStore((s) => s.setLoading);
  const setError = useCollectionStore((s) => s.setError);

  const hasCollection = cards.length > 0;
  const missingBinderName = importMode === 'binder' && !binderName.trim();
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Disclosure summary (STYLE_GUIDE § Config surfaces): states the current
  // choice while closed, so a non-default pick is never hidden.
  const modeSummary =
    importMode === 'replace'
      ? 'Replace collection'
      : importMode === 'binder'
        ? binderName.trim()
          ? `New binder "${binderName.trim()}"`
          : 'Add as new binder'
        : 'Add to collection';
  const optionsSummary = markAsProxies ? `${modeSummary} · Proxies on` : modeSummary;

  // Soft, name-based re-import signal (lib/reimport.ts): an incoming staged
  // file shares a name with something already in history. Paste/scan use
  // synthetic labels the matcher ignores, so this only ever fires for a real
  // file. The strong, content-based signal is `findContentReimportMatch`,
  // which still hard-gates a merge import below.
  const priorFilenameMatches = useMemo(
    () =>
      findPriorImports(
        stagedFiles.map((f) => f.name),
        importHistory
      ),
    [stagedFiles, importHistory]
  );

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
    fileInputRef.current?.click();
  };

  /**
   * Open the user's Drive. Whatever they pick arrives as a normal File — a
   * Sheet is exported to CSV on the way — so it stages exactly like a drop.
   */
  const handlePickDrive = async () => {
    if (isLoading || driveBusy) return;
    setDriveBusy(true);
    setError(null);
    try {
      stageIncoming(await pickFromGoogleDrive());
    } catch (err) {
      // Backing out is silent; anything else must be visible. The old
      // empty-message convention swallowed a real abort — see CancelledError.
      if (!isCancelled(err)) {
        setError(userMessage(err, "Couldn't open Google Drive. Try again."));
      }
    } finally {
      setDriveBusy(false);
    }
  };

  const stageIncoming = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const { files, renamed, dropped } = mergeStagedFiles(stagedFiles, incoming);
    setStagedFiles(files);
    setStageNote(stagedFilesNotice(renamed, dropped));
  };

  /**
   * Pull a Sheet / Drive file down through the backend and stage it as a normal
   * File — from here it's indistinguishable from one the user dropped, so the
   * re-import gate, per-file history and routing summary all work unchanged.
   */
  const handleFetchLink = async () => {
    const url = linkUrl.trim();
    if (!url || linkBusy || isLoading) return;
    setLinkBusy(true);
    setError(null);
    try {
      const { text, name } = await fetchImportLink(url);
      stageIncoming([new File([text], name, { type: 'text/csv' })]);
      setLinkUrl('');
    } catch (err) {
      setError(
        userMessage(
          err,
          "Couldn't fetch that link. Check it's a public Google Sheets or Drive link and try again."
        )
      );
    } finally {
      setLinkBusy(false);
    }
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
    if (stagedFiles.length === 0 || isLoading || missingBinderName) return;
    void startImport({
      files: stagedFiles,
      label: `${stagedFiles.length} files`,
      preview: `${stagedFiles.length} file${stagedFiles.length === 1 ? '' : 's'}`,
      proxy: markAsProxies,
    });
  };

  const handlePasteImport = () => {
    const text = pasteText.trim();
    if (!text || isLoading || missingBinderName) return;
    const lineCount = text.split('\n').filter((l) => l.trim()).length;
    void startImport({
      fn: (onProgress) => importText(text, onProgress, markAsProxies),
      label: 'pasted-list',
      preview: `${lineCount} line${lineCount === 1 ? '' : 's'}`,
      proxy: markAsProxies,
    });
  };

  /**
   * Runs the currently-selected import mode (the "Options" disclosure) right
   * away — Add to collection is the default and needs no confirmation.
   * Replace is the one choice that still nags (its own confirm + Undo, D,
   * board T153: the per-import mode dialog no longer blocks every import).
   */
  async function startImport(p: PendingImport) {
    if (isLoading || missingBinderName) return;
    if (importMode === 'replace') {
      const ok = await confirmReplaceCollection();
      if (!ok) return;
    }
    await runImport(p, importMode, importMode === 'binder' ? binderName.trim() : undefined);
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
    setImportProgress(null);
    setSavingLocally(true);
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
      `Imported ${totals.cardsImported.toLocaleString()} card${
        totals.cardsImported === 1 ? '' : 's'
      } from ${parsedFiles.length} file${parsedFiles.length === 1 ? '' : 's'}`,
    ];
    if (totals.unresolvedCount > 0) parts.push(`${totals.unresolvedCount} unresolved`);
    if (allFetchErrors.length > 0) {
      parts.push(fetchErrorMessage(allFetchErrors.length, 'Retry below.'));
    }
    if (allMalformedRows.length > 0) {
      parts.push(`${allMalformedRows.length} rows couldn't be read`);
    }
    if (totals.skippedUnownedCount > 0) {
      parts.push(`${totals.skippedUnownedCount} unowned rows skipped`);
    }
    if (totals.clampedCount > 0) {
      parts.push(`${totals.clampedCount} rows over the copy limit, capped`);
    }
    if (mode === 'binder' && binderName) parts.push(`binder "${binderName}" created`);
    if (p.proxy) parts.push('marked as proxies');
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
    setImportProgress(null);
    setSavingLocally(true);
    const id = await importCards(result, p.label, mode, {
      isSample: p.isSample,
      binderName,
    });
    setMalformedRows(result.malformedRows);
    const parts: string[] = [
      `Imported ${result.cards.length.toLocaleString()} card${result.cards.length === 1 ? '' : 's'}`,
    ];
    if (result.scryfallHits > 0) {
      parts.push(`${result.scryfallHits.toLocaleString()} matched`);
    }
    if (result.unresolvedNames.length > 0) {
      parts.push(`${result.unresolvedNames.length} unresolved`);
    }
    if (result.fetchErrors.length > 0) {
      parts.push(fetchErrorMessage(result.fetchErrors.length, 'Retry below.'));
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
        `${result.clampedRows} row${result.clampedRows !== 1 ? 's' : ''} over the copy limit, capped`
      );
    }
    if (mode === 'binder' && binderName) {
      parts.push(`binder "${binderName}" created`);
    }
    if (p.proxy) parts.push('marked as proxies');
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
          const result = await importFile(
            file,
            (prog) =>
              setImportProgress({
                chunkIndex: prog.chunkIndex,
                totalChunks: prog.totalChunks,
                fileLabel: file.name,
                fileIndex: i + 1,
                totalFiles,
              }),
            p.proxy
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
      setSavingLocally(false);
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
      setError(userMessage(err, "Couldn't complete the import."));
    } finally {
      setLoading(false);
      setImportProgress(null);
      setSavingLocally(false);
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

  return (
    <div className="upload-panel">
      {confirmDialog}
      {/* A progress strip at the top of the panel for each phase of an import:
          1. Parsing — determinate per batch when the file was big enough to
             be chunked, otherwise (a small upload) indeterminate.
          2. Saving to the device — indeterminate; short.
          3. Saving to the account — the server push. The panel has already
             let go by then (the store returns once the rows are on the
             device), so this strip stays up without blocking, advancing per
             /api/sync round trip, and disappears when the push settles. */}
      {isLoading ? (
        <div className="upload-progress" role="status" aria-live="polite">
          {savingLocally ? (
            <ProgressBar indeterminate message="Saving your cards to this device…" />
          ) : importProgress && importProgress.totalChunks > 1 ? (
            <ProgressBar
              percent={(importProgress.chunkIndex / importProgress.totalChunks) * 100}
              message={formatImportProgressMessage(importProgress)}
            />
          ) : (
            <ProgressBar indeterminate message="Importing your collection…" />
          )}
        </div>
      ) : (
        pushProgress && (
          <div className="upload-progress" role="status" aria-live="polite">
            <ProgressBar
              percent={(pushProgress.done / pushProgress.total) * 100}
              message={formatPushProgressMessage(pushProgress)}
            />
          </div>
        )
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

          {(routingSummary.entries.length > 0 || routingSummary.unroutedCount > 0) && (
            <div className="import-review-section import-review-section--routing">
              <ImportRoutingSummary summary={routingSummary} />
            </div>
          )}

          {fetchErrors.length > 0 && (
            <div className="import-review-section import-review-section--warn" role="alert">
              <div className="unresolved-summary">
                <span>
                  {fetchErrorMessage(
                    fetchErrors.length,
                    "The card service was unreachable, so they weren't imported."
                  )}
                </span>
                <span className="fetch-error-actions">
                  <Button variant="link" onClick={() => setShowFetchErrors((v) => !v)}>
                    {showFetchErrors ? 'Hide list' : 'Show list'}
                  </Button>
                  <Button variant="primary" onClick={handleRetryFetchErrors} disabled={isLoading}>
                    Retry
                  </Button>
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
                  at all. They weren't imported.
                </span>
                <span className="fetch-error-actions">
                  <Button variant="link" onClick={() => setShowMalformed((v) => !v)}>
                    {showMalformed ? 'Hide list' : 'Show list'}
                  </Button>
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
                  {unresolvedNames.length} card{unresolvedNames.length !== 1 ? 's' : ''} didn't
                  match Scryfall. Fix them below, or leave them as bare entries with no image or
                  price.
                </span>
                <Button variant="link" onClick={() => setShowUnresolved((v) => !v)}>
                  {showUnresolved ? 'Hide list' : 'Show list'}
                </Button>
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

      <div className="import-grid">
        <div
          className={`import-card file-dropzone${isDragging ? ' is-dragging' : ''}`}
          {...dropProps}
        >
          {isDragging && (
            <div className="file-drop-overlay" aria-hidden="true">
              <div className="file-drop-message">Drop files to stage</div>
            </div>
          )}
          <div className="import-card-header">
            <h2 className="import-card-title">Import your collection</h2>
            <div className="import-card-header-actions">
              {canScan && !hideScanButton && (
                <Button
                  onClick={() => setScannerOpen(true)}
                  disabled={isLoading}
                  title="Scan physical cards with your device camera"
                  className="import-upload-btn"
                  icon={<Camera width={14} height={14} strokeWidth={1.8} />}
                >
                  Scan cards
                </Button>
              )}
              {canPickDrive && (
                <Button
                  onClick={handlePickDrive}
                  disabled={isLoading || driveBusy}
                  title="Browse Google Drive for a card list"
                  className="import-upload-btn"
                  icon={
                    driveBusy ? (
                      <span className="spinner" />
                    ) : (
                      <Cloud width={14} height={14} strokeWidth={1.8} />
                    )
                  }
                >
                  {driveBusy ? 'Opening…' : 'Google Drive'}
                </Button>
              )}
              <Button
                onClick={handlePickFile}
                disabled={isLoading}
                title="Upload CSV or TXT files"
                className="import-upload-btn"
                icon={
                  isLoading ? (
                    <span className="spinner" />
                  ) : (
                    <Upload width={14} height={14} strokeWidth={1.8} />
                  )
                }
              >
                Upload files
              </Button>
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
            Paste a card list or upload CSVs. Each card is matched to Scryfall and routed into your
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
              {priorFilenameMatches.length > 0 && (
                <p className="import-reimport-warning" role="alert">
                  {priorFilenameMatches.length === 1 ? (
                    <>
                      You already imported <strong>{priorFilenameMatches[0].name}</strong> (
                      {priorFilenameMatches[0].count.toLocaleString()} cards,{' '}
                      {formatRelative(priorFilenameMatches[0].addedAt)}). Adding it again stacks a
                      second copy of every card. Open Options below to replace instead.
                    </>
                  ) : (
                    <>
                      <strong>{priorFilenameMatches.length}</strong> of these were imported before:{' '}
                      {priorFilenameMatches.map((r) => r.name).join(', ')}. Adding them again stacks
                      a second copy of every card. Open Options below to replace instead.
                    </>
                  )}
                </p>
              )}
            </>
          ) : (
            <textarea
              className="paste-textarea import-textarea"
              // Named because a placeholder is not an accessible name, and this
              // is no longer the only textbox in the card.
              aria-label="Card list to import"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'4 Arcane Signet\n1 Cyclonic Rift\n2 Forest\n…'}
              disabled={isLoading}
            />
          )}

          {/* Fallback for the platforms the Drive picker can't run on (the
              an embedded browser, or a build with no API key). A Sheet is the one
              source the OS document picker cannot reach, so native still needs
              a way in; the server fetches the link because Google's export
              endpoints send no CORS headers. */}
          {!canPickDrive && (
            <div className="import-link-field">
              {/* A visible label, not a placeholder: the row used to carry only
                  "Paste a share link", which said nothing about WHICH link
                  and truncated at 360px anyway. */}
              <label className="import-link-label" htmlFor={linkInputId}>
                Google Sheets or Drive link
              </label>
              <p className="import-link-hint">
                Set sharing to “Anyone with the link”, then paste it here.
              </p>
              <div className="import-link-row">
                <input
                  id={linkInputId}
                  type="url"
                  className="import-link-input"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleFetchLink();
                    }
                  }}
                  placeholder="Paste the link"
                  disabled={isLoading || linkBusy}
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  onClick={handleFetchLink}
                  disabled={isLoading || linkBusy || !linkUrl.trim()}
                  title="Fetch the card list from this link"
                  className="import-link-btn"
                  icon={
                    linkBusy ? (
                      <span className="spinner" />
                    ) : (
                      <Link2 width={14} height={14} strokeWidth={1.8} />
                    )
                  }
                >
                  {linkBusy ? 'Fetching…' : 'Fetch'}
                </Button>
              </div>
            </div>
          )}

          <Disclosure title="Options" summary={optionsSummary}>
            <ChoiceList<ImportMode>
              ariaLabel="How to import these cards"
              value={importMode}
              onChange={setImportMode}
              options={[
                {
                  value: 'merge',
                  label: 'Add to collection',
                  hint:
                    binders.length > 0
                      ? 'Cards are routed through your binder rules.'
                      : 'Cards go straight into your collection.',
                },
                {
                  value: 'binder',
                  label: 'Add as a new binder',
                  hint: 'Creates a new binder with these cards, in the order they were listed. Cards are also added to your collection.',
                },
                {
                  value: 'replace',
                  label: 'Replace my collection',
                  hint: 'Wipes your current collection and loads this import fresh, with no duplicates.',
                },
              ]}
            />
            {importMode === 'binder' && (
              <Field label="Binder name" htmlFor={binderNameId}>
                <input
                  id={binderNameId}
                  type="text"
                  className="binder-name-input"
                  placeholder="Binder name"
                  value={binderName}
                  onChange={(e) => setBinderName(e.target.value)}
                  disabled={isLoading}
                  maxLength={60}
                />
              </Field>
            )}
            <SwitchRow
              label="Mark all as proxies"
              hint="Proxy copies count as owned in your collection and binders, but carry no market value. Their cost, if any, still counts toward what you paid."
              checked={markAsProxies}
              onChange={setMarkAsProxies}
              disabled={isLoading}
            />
          </Disclosure>

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
              <Button
                variant="primary"
                onClick={handleImportStaged}
                disabled={isLoading || missingBinderName}
              >
                {isLoading
                  ? 'Importing…'
                  : `Import ${stagedFiles.length} file${stagedFiles.length === 1 ? '' : 's'}`}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handlePasteImport}
                disabled={isLoading || !pasteText.trim() || missingBinderName}
              >
                {isLoading ? 'Importing…' : 'Import'}
              </Button>
            )}
          </div>
        </div>
      </div>

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
              void startImport({
                fn: (onProgress) => importText(text, onProgress),
                label: 'scanned-cards',
                preview: `${count} scanned card${count === 1 ? '' : 's'}`,
              });
              // Never claim the add succeeded here: a Replace-mode import can
              // still be declined at its confirm, and the scanner keeps its
              // list until an import actually lands.
              return false;
            }}
          />
        </Suspense>
      )}

      {pendingReimportGate && (
        <ReimportGateDialog
          match={pendingReimportGate.match}
          onReplace={() => void resolveReimportGate('replace')}
          onMergeAnyway={() => void resolveReimportGate('merge')}
          onCancel={() => void resolveReimportGate('cancel')}
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
        <Button
          variant="link"
          onClick={() => setExpanded((v) => !v)}
          disabled={disabled}
          aria-expanded={expanded}
          className="unresolved-repair-toggle"
          icon={
            expanded ? (
              <ChevronDown width={12} height={12} strokeWidth={2} />
            ) : (
              <ChevronRight width={12} height={12} strokeWidth={2} />
            )
          }
        >
          Fix
        </Button>
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
        These cards closely match an import you already made:{' '}
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
        <Button variant="danger" onClick={onReplace} autoFocus>
          Replace instead
        </Button>
      </div>
    </Modal>
  );
}

function formatImportProgressMessage(p: ImportProgressState): string {
  // chunkIndex counts batches COMPLETED, so the one in flight is the next.
  const current = Math.min(p.chunkIndex + 1, p.totalChunks);
  const batch = `batch ${current} of ${p.totalChunks}`;
  if (p.totalFiles && p.totalFiles > 1 && p.fileLabel) {
    return `Importing ${p.fileLabel} (file ${p.fileIndex} of ${p.totalFiles}) · ${batch}…`;
  }
  if (p.fileLabel) return `Importing ${p.fileLabel} · ${batch}…`;
  return `Importing your collection · ${batch}…`;
}

function formatPushProgressMessage(p: PushProgress): string {
  const current = Math.min(p.done + 1, p.total);
  return `Saving to your account · ${current} of ${p.total}…`;
}

function formatRelative(timestamp: number): string {
  return formatRelativeTime(timestamp, { verbose: true });
}
