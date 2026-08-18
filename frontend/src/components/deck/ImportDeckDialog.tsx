import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Upload, Download, ChevronRight, Cloud, Link2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../Modal';
import { ProgressBar } from '../ProgressBar';
import { fetchImportLink, importDeckText, importDeckFile } from '../../lib/api';
import { useDecksStore } from '../../store/decks';
import { buildAllocationMap, type AllocationInfo } from '../../lib/allocations';
import { useBuildDeckFromImport } from '../../lib/build-deck-from-import';
import { CommanderSearch } from './CommanderSearch';
import { getCardImageUrl } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { DeckImportResponse } from '../../types';
import {
  normalizeFormat,
  commanderEligibleFor,
  commanderCandidatesFor,
  partnerCandidatesFor,
  PartnerImportPicker,
  ImportParseSummary,
} from './import-deck-shared';
import { isNativePlatform } from '../../lib/platform';
import { pickNativeFiles } from '../../lib/native-file-picker';
import {
  googlePickerAvailable,
  isCancelled,
  pickFromGoogleDrive,
  warmGooglePicker,
} from '../../lib/google-picker';
import { usePublishOnCreate, type PublishOutcome } from '../../lib/use-publish-on-create';

const DECK_IMPORT_MIME = ['text/csv', 'text/tab-separated-values', 'text/plain'];
import {
  MAX_STAGED_FILES as MAX_FILES,
  mergeStagedFiles,
  stagedFilesNotice,
  stripExtension,
} from '../../lib/staged-files';

interface Props {
  onClose: () => void;
  /** Initial / fallback format selection. The user can change it per deck. */
  format?: DeckFormat;
}

type Step = 'input' | 'parsing' | 'batch' | 'review';

type BatchMode = 'separate' | 'merge';

const FORMATS = Object.keys(DECK_FORMAT_CONFIGS) as DeckFormat[];

/**
 * A parsed-but-not-yet-saved deck. The user can edit name / format / commander
 * before anything is written to the store.
 */
interface DraftDeck {
  key: string;
  fileName: string;
  status: 'ok' | 'failed';
  error?: string;
  result?: DeckImportResponse;
  name: string;
  format: DeckFormat;
  commander: ScryfallCard | null;
  partner: ScryfallCard | null;
  candidates: ScryfallCard[];
  searchOpen: boolean;
}

const PASTE_PLACEHOLDERS: Record<DeckFormat, string> = {
  commander:
    'Commander\n1 Korvold, Fae-Cursed King\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n1 Cultivate\n...',
  brawl:
    'Commander\n1 Chulane, Teller of Tales\n\nDeck\n1 Arcane Signet\n1 Cultivate\n1 Llanowar Elves\n...',
  paupercommander:
    'Commander\n1 Fynn, the Fangbearer\n\nDeck\n1 Arcane Signet\n1 Command Tower\n1 Rampant Growth\n...',
  standard:
    'Deck\n4 Lightning Strike\n4 Monastery Swiftspear\n20 Mountain\n...\n\nSideboard\n3 Roiling Vortex\n...',
  pauper:
    'Deck\n4 Lightning Bolt\n4 Brainstorm\n4 Ponder\n18 Island\n...\n\nSideboard\n2 Pyroblast\n...',
  modern:
    'Deck\n4 Ragavan, Nimble Pilferer\n4 Lightning Bolt\n20 Mountain\n...\n\nSideboard\n2 Surgical Extraction\n...',
  pioneer: 'Deck\n4 Thoughtseize\n4 Fatal Push\n20 Swamp\n...\n\nSideboard\n2 Duress\n...',
  legacy:
    'Deck\n4 Brainstorm\n4 Force of Will\n20 Island\n...\n\nSideboard\n2 Surgical Extraction\n...',
  vintage: 'Deck\n1 Black Lotus\n4 Force of Will\n20 Island\n...\n\nSideboard\n2 Null Rod\n...',
};

export function ImportDeckDialog({ onClose, format: initialFormat = 'commander' }: Props) {
  const navigate = useNavigate();
  const decks = useDecksStore((s) => s.decks);
  const buildDeckFromResult = useBuildDeckFromImport();

  // ── Visibility (creation-time choice, E150) ─────────────────────────────
  // Single-deck paths only (paste/merge — see the fieldset's render guard
  // below); a multi-file batch that lands on ONE deck instead gets the
  // lighter DeckPublishNudge on arrival (promptVisibility, set in
  // commitBatch) rather than this fieldset — see the PR description for why.
  const onPublishSettled = useCallback(
    (id: string, outcome?: PublishOutcome) => {
      onClose();
      navigate(
        `/decks/${id}`,
        outcome ? { state: { justPublished: outcome.isFirstPublish } } : undefined
      );
    },
    [onClose, navigate]
  );
  const {
    canPublish,
    publicDisabledReason,
    visibility,
    setVisibility,
    publishing,
    needsDisplayName,
    displayNameDraft,
    setDisplayNameDraft,
    publishAfterCreate,
    saveDisplayNameAndPublish,
    cancelDisplayName,
  } = usePublishOnCreate(onPublishSettled);

  const [selectedFormat, setSelectedFormat] = useState<DeckFormat>(initialFormat);
  const formatConfig = DECK_FORMAT_CONFIGS[selectedFormat];
  // Radios group by shared `name` — scope each group to this dialog instance.
  const formatGroup = useId();
  const visibilityGroup = useId();
  const [step, setStep] = useState<Step>('input');
  const [pasteText, setPasteText] = useState('');
  /** Google Sheets / Drive share link, fetched server-side and staged as a file. */
  const [linkUrl, setLinkUrl] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const linkInputId = useId();
  const [driveBusy, setDriveBusy] = useState(false);
  /** Web-only — see google-picker.ts. Native and un-keyed builds fall back to
   *  the link field below. */
  const canPickDrive = googlePickerAvailable();
  // Warm Google's scripts before the click — awaiting them inside the handler
  // spends the user activation the consent popup needs. See warmGooglePicker.
  useEffect(() => {
    if (canPickDrive) warmGooglePicker();
  }, [canPickDrive]);
  const [deckName, setDeckName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchMode, setBatchMode] = useState<BatchMode>('separate');
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(
    null
  );
  const [drafts, setDrafts] = useState<DraftDeck[]>([]);
  // Legacy single-deck review (used by paste + merge mode).
  const [pendingResult, setPendingResult] = useState<DeckImportResponse | null>(null);
  const [pendingCommander, setPendingCommander] = useState<ScryfallCard | null>(null);
  const [pendingPartner, setPendingPartner] = useState<ScryfallCard | null>(null);
  const [showCommanderSearch, setShowCommanderSearch] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const commanderCandidates = useMemo(
    () => commanderCandidatesFor(pendingResult?.cards, selectedFormat),
    [pendingResult, selectedFormat]
  );

  const partnerCandidates = useMemo(
    () => partnerCandidatesFor(pendingResult?.cards, pendingCommander),
    [pendingResult, pendingCommander]
  );

  /**
   * Picks the commander for a result given a target format. Returns
   * `needsChoice` when the format wants a commander but we can't pick one
   * unambiguously (multiple or zero valid candidates).
   */
  const resolveAutoCommander = useCallback(
    (
      result: DeckImportResponse,
      format: DeckFormat
    ): { commander: ScryfallCard | null; needsChoice: boolean } => {
      if (!DECK_FORMAT_CONFIGS[format].hasCommander) {
        return { commander: null, needsChoice: false };
      }
      if (result.commander) return { commander: result.commander, needsChoice: false };
      const candidates = commanderCandidatesFor(result.cards, format);
      if (candidates.length === 1) return { commander: candidates[0], needsChoice: false };
      return { commander: null, needsChoice: true };
    },
    []
  );

  // --- Legacy single-deck flow (paste + merge) ----------------------------

  const finalizeDeck = useCallback(
    (
      result: DeckImportResponse,
      commander: ScryfallCard | null,
      name: string,
      partner: ScryfallCard | null = null
    ) => {
      const id = buildDeckFromResult(result, commander, name, selectedFormat, { partner });
      if (visibility === 'public' && canPublish) {
        void publishAfterCreate(id);
        return;
      }
      onClose();
      navigate(`/decks/${id}`);
    },
    [
      buildDeckFromResult,
      navigate,
      onClose,
      selectedFormat,
      visibility,
      canPublish,
      publishAfterCreate,
    ]
  );

  const processSingleResult = useCallback(
    (result: DeckImportResponse) => {
      const hasWarnings =
        result.unresolvedNames.length > 0 ||
        result.fetchErrors.length > 0 ||
        (result.considering?.length ?? 0) > 0 ||
        (normalizeFormat(result.detectedFormat) !== null &&
          normalizeFormat(result.detectedFormat) !== selectedFormat);
      const { commander, needsChoice } = resolveAutoCommander(result, selectedFormat);
      // A pairable commander always routes through review so the partner can be
      // offered (never auto-paired) even when nothing else needs a decision.
      const hasPartnerOption =
        formatConfig.hasCommander && partnerCandidatesFor(result.cards, commander).length > 0;

      if (!needsChoice && !hasWarnings && !hasPartnerOption) {
        finalizeDeck(result, formatConfig.hasCommander ? commander : null, deckName);
        return;
      }
      setPendingResult(result);
      setPendingCommander(commander);
      setPendingPartner(null);
      setShowCommanderSearch(false);
      setStep('review');
      setIsLoading(false);
    },
    [finalizeDeck, resolveAutoCommander, formatConfig, selectedFormat, deckName]
  );

  const handlePasteImport = useCallback(async () => {
    const text = pasteText.trim();
    if (!text || isLoading) return;
    setError(null);
    setIsLoading(true);
    setStep('parsing');
    try {
      const result = await importDeckText(text);
      processSingleResult(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Import failed. Check the format and try again.'
      );
      setStep('input');
      setIsLoading(false);
    }
  }, [pasteText, isLoading, processSingleResult]);

  const handleConfirmReview = useCallback(() => {
    if (!pendingResult) return;
    if (formatConfig.hasCommander) {
      if (!pendingCommander) return;
      finalizeDeck(pendingResult, pendingCommander, deckName, pendingPartner);
    } else {
      finalizeDeck(pendingResult, null, deckName);
    }
  }, [
    pendingResult,
    pendingCommander,
    pendingPartner,
    formatConfig.hasCommander,
    finalizeDeck,
    deckName,
  ]);

  // --- Multi-file staging + parse-then-review -----------------------------

  /**
   * Appends files to the staged list (never uploads on selection). Duplicate
   * names are kept as renamed copies ("deck (1).csv"); the list is capped at
   * MAX_FILES and any overflow is dropped with a notice.
   */
  const acceptFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;
      const { files, renamed, dropped } = mergeStagedFiles(batchFiles, incoming);
      setError(stagedFilesNotice(renamed, dropped));
      setBatchFiles(files);
    },
    [batchFiles]
  );

  const runParse = useCallback(async () => {
    if (isLoading || batchFiles.length === 0) return;
    setError(null);
    setIsLoading(true);
    setStep('parsing');
    const files = batchFiles;
    const total = files.length;

    if (batchMode === 'merge' && total > 1) {
      const mergedCards: ScryfallCard[] = [];
      const mergedSideboard: ScryfallCard[] = [];
      const mergedConsidering: ScryfallCard[] = [];
      let mergedCommander: ScryfallCard | null = null;
      let mergedCompanion: ScryfallCard | null = null;
      const unresolved: string[] = [];
      const fetchFailed: string[] = [];
      const failed: string[] = [];
      for (let i = 0; i < total; i++) {
        const file = files[i];
        setProgress({ done: i, total, label: file.name });
        try {
          const r = await importDeckFile(file);
          mergedCards.push(...r.cards);
          mergedSideboard.push(...(r.sideboard ?? []));
          mergedConsidering.push(...(r.considering ?? []));
          if (!mergedCommander && r.commander) mergedCommander = r.commander;
          if (!mergedCompanion && r.companion) mergedCompanion = r.companion;
          unresolved.push(...r.unresolvedNames);
          fetchFailed.push(...r.fetchErrors);
        } catch (err) {
          failed.push(`${file.name}: ${err instanceof Error ? err.message : 'failed'}`);
        }
      }
      setProgress(null);
      if (mergedCards.length === 0 && !mergedCommander) {
        setError(
          failed.length > 0
            ? `Nothing could be imported. ${failed.join('; ')}`
            : 'No cards found in the selected files.'
        );
        setStep('input');
        setIsLoading(false);
        return;
      }
      if (failed.length > 0) setError(`Some files were skipped: ${failed.join('; ')}`);
      processSingleResult({
        commander: mergedCommander,
        companion: mergedCompanion,
        cards: mergedCards,
        sideboard: mergedSideboard,
        considering: mergedConsidering,
        unresolvedNames: Array.from(new Set(unresolved)),
        fetchErrors: Array.from(new Set(fetchFailed)),
        detectedFormat: '',
        cardCount: mergedCards.length + (mergedCommander ? 1 : 0) + (mergedCompanion ? 1 : 0),
      });
      return;
    }

    // Separate (or single file): parse each, build editable drafts, save nothing.
    const next: DraftDeck[] = [];
    for (let i = 0; i < total; i++) {
      const file = files[i];
      setProgress({ done: i, total, label: file.name });
      try {
        const r = await importDeckFile(file);
        const fmt = normalizeFormat(r.detectedFormat) ?? selectedFormat;
        const { commander } = resolveAutoCommander(r, fmt);
        next.push({
          key: `${i}-${file.name}`,
          fileName: file.name,
          status: 'ok',
          result: r,
          name: stripExtension(file.name),
          format: fmt,
          commander,
          partner: null,
          candidates: commanderCandidatesFor(r.cards, fmt),
          searchOpen: false,
        });
      } catch (err) {
        next.push({
          key: `${i}-${file.name}`,
          fileName: file.name,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Import failed.',
          name: stripExtension(file.name),
          format: selectedFormat,
          commander: null,
          partner: null,
          candidates: [],
          searchOpen: false,
        });
      }
    }
    setProgress(null);
    setDrafts(next);
    setStep('batch');
    setIsLoading(false);
  }, [isLoading, batchFiles, batchMode, selectedFormat, resolveAutoCommander, processSingleResult]);

  const patchDraft = useCallback((key: string, patch: Partial<DraftDeck>) => {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }, []);

  /**
   * Re-runs the import for whatever produced the current review result — the
   * pasted text, or the staged files. Used when part of the list couldn't be
   * fetched (card-service outage): the server cache keeps the retry cheap and
   * the re-import converges once the service answers.
   */
  const retryReview = useCallback(() => {
    if (isLoading) return;
    if (pasteText.trim()) void handlePasteImport();
    else void runParse();
  }, [isLoading, pasteText, handlePasteImport, runParse]);

  /**
   * Re-parses a single staged file whose draft came back degraded, preserving
   * the user's edits (name / format / commander pick) on the draft.
   */
  const retryDraft = useCallback(
    async (d: DraftDeck) => {
      const file = batchFiles.find((f) => f.name === d.fileName);
      if (!file || isLoading) return;
      setIsLoading(true);
      setError(null);
      try {
        const r = await importDeckFile(file);
        const { commander } = resolveAutoCommander(r, d.format);
        patchDraft(d.key, {
          result: r,
          commander: d.commander ?? commander,
          candidates: commanderCandidatesFor(r.cards, d.format),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Retry failed. Give it a moment.');
      } finally {
        setIsLoading(false);
      }
    },
    [batchFiles, isLoading, resolveAutoCommander, patchDraft]
  );

  const changeDraftFormat = useCallback((key: string, format: DeckFormat) => {
    setDrafts((ds) =>
      ds.map((d) => {
        if (d.key !== key) return d;
        // Eligibility differs per format (PDH: uncommon creature; others:
        // legendary) — recompute the candidate list and drop a commander the
        // new format can't legally have.
        const candidates = commanderCandidatesFor(d.result?.cards, format);
        let commander =
          d.commander && commanderEligibleFor(format)(d.commander) ? d.commander : null;
        if (DECK_FORMAT_CONFIGS[format].hasCommander && !commander && candidates.length === 1) {
          commander = candidates[0];
        }
        // A format without a commander (or a different commander) invalidates
        // any previously-chosen partner.
        const partner = DECK_FORMAT_CONFIGS[format].hasCommander ? d.partner : null;
        return { ...d, format, commander, partner, candidates };
      })
    );
  }, []);

  const okDrafts = useMemo(() => drafts.filter((d) => d.status === 'ok'), [drafts]);

  const commitBatch = useCallback(() => {
    const claimed = new Map<string, AllocationInfo>(buildAllocationMap(decks));
    const ids: string[] = [];
    for (const d of okDrafts) {
      if (!d.result) continue;
      const useCommander = DECK_FORMAT_CONFIGS[d.format].hasCommander ? d.commander : null;
      const usePartner = useCommander ? d.partner : null;
      ids.push(
        buildDeckFromResult(d.result, useCommander, d.name, d.format, {
          claimed,
          partner: usePartner,
        })
      );
    }
    onClose();
    // A batch that lands on exactly one deck (a single staged file, or every
    // other draft skipped/removed) gets the lighter post-create nudge on
    // arrival — this multi-draft review screen never showed the visibility
    // fieldset, so there's no explicit choice to honor either way. A batch
    // that lands on several decks has no single editor to nudge on, so it
    // stays as-is (E150 — see the PR description for the full rationale).
    navigate(
      ids.length === 1 ? `/decks/${ids[0]}` : '/decks',
      ids.length === 1 ? { state: { promptVisibility: true } } : undefined
    );
  }, [okDrafts, decks, buildDeckFromResult, navigate, onClose]);

  // --- File input / drag-drop --------------------------------------------

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (fileInputRef.current) fileInputRef.current.value = '';
      acceptFiles(files);
    },
    [acceptFiles]
  );

  /**
   * Pull a Sheet / Drive file down through the backend and stage it as a normal
   * File, so the batch parse, merge mode and review step treat it like any
   * other upload.
   */
  const handleFetchLink = useCallback(async () => {
    const url = linkUrl.trim();
    if (!url || linkBusy || isLoading) return;
    setLinkBusy(true);
    setError(null);
    try {
      const { text, name } = await fetchImportLink(url);
      acceptFiles([new File([text], name, { type: 'text/csv' })]);
      setLinkUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't fetch that link");
    } finally {
      setLinkBusy(false);
    }
  }, [acceptFiles, isLoading, linkBusy, linkUrl]);

  /** Open Drive and stage the picked files like any other upload. */
  const handlePickDrive = useCallback(async () => {
    if (isLoading || driveBusy) return;
    setDriveBusy(true);
    setError(null);
    try {
      acceptFiles(await pickFromGoogleDrive());
    } catch (err) {
      // Backing out is silent; anything else must be visible. See CancelledError.
      if (!isCancelled(err)) {
        setError(err instanceof Error ? err.message : "Couldn't open Google Drive");
      }
    } finally {
      setDriveBusy(false);
    }
  }, [acceptFiles, driveBusy, isLoading]);

  const handlePickFile = useCallback(async () => {
    if (isLoading) return;
    if (isNativePlatform()) {
      try {
        const files = await pickNativeFiles({ types: DECK_IMPORT_MIME, multiple: true });
        acceptFiles(files);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't open file picker");
      }
      return;
    }
    fileInputRef.current?.click();
  }, [acceptFiles, isLoading]);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (isLoading || step !== 'input') return;
      if (!Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setIsDragging(true);
    },
    [isLoading, step]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (isLoading || step !== 'input') return;
      if (!Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    [isLoading, step]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      if (isLoading || step !== 'input') return;
      const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
      acceptFiles(files);
    },
    [acceptFiles, isLoading, step]
  );

  const handleCommanderSelect = useCallback((card: ScryfallCard | null) => {
    setPendingCommander(card);
    // The previously-picked partner may not be legal for the new commander.
    setPendingPartner(null);
    setShowCommanderSearch(false);
  }, []);

  const canConfirmReview =
    !!pendingResult && (!formatConfig.hasCommander || pendingCommander !== null);

  const title =
    step === 'review' ? 'Review import' : step === 'batch' ? 'Review decks' : 'Import deck';

  // The deck already exists at this point (only reachable after a create
  // succeeded but the publish itself needs a display name) — replace the
  // whole modal rather than layering this over now-stale step content,
  // mirroring ShareDialog's own display_name_required fallback.
  if (needsDisplayName) {
    return (
      <Modal
        onClose={onClose}
        labelledBy="import-deck-title"
        className="modal import-deck-modal"
        dismissable={!publishing}
      >
        <div className="modal-header">
          <h2 id="import-deck-title">Set a display name</h2>
        </div>
        <div className="modal-body">
          <p className="import-deck-hint">
            Publishing shows your display name on the deck page — set one to continue.
          </p>
          <div className="field">
            <label htmlFor="import-deck-display-name">Display name</label>
            <input
              id="import-deck-display-name"
              type="text"
              className="name-input-field"
              value={displayNameDraft}
              maxLength={40}
              disabled={publishing}
              onChange={(e) => setDisplayNameDraft(e.target.value)}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={cancelDisplayName} disabled={publishing}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void saveDisplayNameAndPublish()}
            disabled={publishing || !displayNameDraft.trim()}
          >
            {publishing ? 'Saving…' : 'Save & continue'}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      onClose={onClose}
      labelledBy="import-deck-title"
      className="modal import-deck-modal"
      dismissable={!isLoading && !publishing}
    >
      <div className="modal-header">
        <h2 id="import-deck-title">{title}</h2>
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close"
          disabled={isLoading}
        >
          ×
        </button>
      </div>

      <div
        className={`modal-body${isDragging ? ' import-deck-dragover' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="import-deck-drop-overlay" aria-hidden="true">
            <div className="import-deck-drop-message">
              Drop one or more files — each becomes its own deck
            </div>
          </div>
        )}

        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button className="banner-dismiss" onClick={() => setError(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        {step === 'input' && (
          <>
            <div className="import-deck-format">
              <span className="import-deck-format-label">
                {batchFiles.length > 0 ? 'Default format' : 'Format'}
              </span>
              <fieldset
                className="format-pill-row"
                aria-label="Default deck format"
                disabled={isLoading}
              >
                {FORMATS.map((fmt) => {
                  const cfg = DECK_FORMAT_CONFIGS[fmt];
                  const active = selectedFormat === fmt;
                  return (
                    <label key={fmt} className={`format-pill${active ? ' active' : ''}`}>
                      <input
                        type="radio"
                        name={formatGroup}
                        value={fmt}
                        checked={active}
                        onChange={() => setSelectedFormat(fmt)}
                      />
                      <span>{cfg.label}</span>
                    </label>
                  );
                })}
              </fieldset>
            </div>

            {batchFiles.length > 0 ? (
              <div className="import-deck-batch">
                <div className="import-deck-batch-head">
                  <strong>
                    {batchFiles.length} of {MAX_FILES} file
                    {batchFiles.length === 1 ? '' : 's'} staged
                  </strong>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => setBatchFiles([])}
                    disabled={isLoading}
                  >
                    Clear
                  </button>
                </div>
                <ul className="import-deck-batch-list">
                  {batchFiles.map((f, i) => (
                    <li key={f.name}>
                      <span className="import-deck-batch-file-name">{f.name}</span>
                      <button
                        type="button"
                        className="import-deck-batch-remove"
                        onClick={() => {
                          setError(null);
                          setBatchFiles((fs) => fs.filter((_, idx) => idx !== i));
                        }}
                        disabled={isLoading}
                        aria-label={`Remove ${f.name}`}
                        title="Remove"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                {/* Already native radios — the wrapper just needed to be a real
                    fieldset instead of a div carrying role="radiogroup". */}
                {batchFiles.length > 1 && (
                  <fieldset
                    className="import-deck-batch-modes"
                    aria-label="How to import multiple files"
                  >
                    <label className="import-deck-batch-mode">
                      <input
                        type="radio"
                        name="batch-mode"
                        checked={batchMode === 'separate'}
                        onChange={() => setBatchMode('separate')}
                        disabled={isLoading}
                      />
                      <span>
                        <strong>Separate decks</strong> — one deck per file. You'll review and can
                        change each deck's name, format, and commander before anything is saved.
                      </span>
                    </label>
                    <label className="import-deck-batch-mode">
                      <input
                        type="radio"
                        name="batch-mode"
                        checked={batchMode === 'merge'}
                        onChange={() => setBatchMode('merge')}
                        disabled={isLoading}
                      />
                      <span>
                        <strong>Merge into one deck</strong> — combine every file's cards into a
                        single {formatConfig.label} deck.
                      </span>
                    </label>
                  </fieldset>
                )}
                <p className="import-deck-hint">
                  Click <strong>Upload files</strong> again or drop more to add to this list
                  {batchFiles.length >= MAX_FILES ? ` (${MAX_FILES} max reached)` : ''}. Nothing is
                  saved yet — files are parsed for review when you continue.
                </p>
              </div>
            ) : (
              <>
                <label className="import-deck-name">
                  <span className="import-deck-name-label">Deck name (optional)</span>
                  <input
                    type="text"
                    className="import-deck-name-input"
                    value={deckName}
                    onChange={(e) => setDeckName(e.target.value)}
                    placeholder={
                      formatConfig.hasCommander
                        ? 'Auto-named from commander if blank'
                        : 'Defaults to "Untitled deck"'
                    }
                    disabled={isLoading}
                    maxLength={120}
                  />
                </label>
                <textarea
                  className="paste-textarea import-textarea"
                  aria-label="Deck list to import"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={PASTE_PLACEHOLDERS[selectedFormat]}
                  disabled={isLoading}
                  autoFocus
                />
                {/* Fallback for where the Drive picker can't run (Capacitor
                    WebView / un-keyed build): a decklist in a Google Sheet is
                    the one source no OS file picker can reach. The fetched
                    file joins the staged batch like any other. */}
                {!canPickDrive && (
                  <div className="import-link-row">
                    <label className="sr-only" htmlFor={linkInputId}>
                      Google Sheets or Drive link
                    </label>
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
                      placeholder="…or paste a Google Sheets / Drive link"
                      disabled={isLoading || linkBusy}
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="btn import-link-btn"
                      onClick={handleFetchLink}
                      disabled={isLoading || linkBusy || !linkUrl.trim()}
                      title="Fetch a deck list from a Google Sheet, or from a file in Drive. The link has to be shared with anyone who has it."
                    >
                      {linkBusy ? (
                        <span className="spinner" />
                      ) : (
                        <Link2 width={14} height={14} strokeWidth={1.8} aria-hidden />
                      )}
                      <span>{linkBusy ? 'Fetching…' : 'Fetch'}</span>
                    </button>
                  </div>
                )}
              </>
            )}
            {/* Only the paths that create exactly one deck (paste, or a
                staged batch merged into one) get the creation-time choice —
                mirrors /decks/new's single fieldset. "Separate decks" (N
                results) has no single editor to land the choice on; those
                decks stay private, publishable afterward per-deck like
                today, and a single-result landing gets the lighter
                DeckPublishNudge instead (see commitBatch). */}
            {(batchFiles.length === 0 || batchMode === 'merge') && (
              <div className="import-deck-commander-section">
                <div className="import-deck-section-title">Visibility</div>
                <fieldset
                  className="share-audience"
                  aria-label="Deck visibility"
                  disabled={isLoading}
                >
                  {(
                    [
                      { value: 'private', label: 'Private', blocked: false },
                      { value: 'public', label: 'Public', blocked: !canPublish },
                    ] as const
                  ).map((opt) => (
                    <label
                      key={opt.value}
                      className={`share-audience-option${
                        visibility === opt.value ? ' is-active' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name={visibilityGroup}
                        value={opt.value}
                        checked={visibility === opt.value}
                        disabled={opt.blocked}
                        onChange={() => setVisibility(opt.value)}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </fieldset>
                <p className="import-deck-hint">
                  {visibility === 'public'
                    ? 'Anyone can find it at a stable link and on your profile.'
                    : 'Only you can see this deck.'}
                  {!canPublish && ` ${publicDisabledReason}`}
                </p>
              </div>
            )}
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv,.tsv,.txt"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
              disabled={isLoading}
            />
          </>
        )}

        {step === 'batch' && (
          <>
            <div className="import-deck-review-summary">
              <span>
                Parsed <strong>{drafts.length}</strong> file{drafts.length === 1 ? '' : 's'} —
                review each deck below. Nothing is saved until you create them.
              </span>
            </div>
            <ul className="import-deck-summary-list">
              {drafts.map((d) =>
                d.status === 'failed' ? (
                  <li key={d.key} className="import-deck-summary-item is-failed">
                    <span className="import-deck-summary-name">{d.fileName}</span>
                    <div className="import-deck-summary-warn">{d.error}</div>
                  </li>
                ) : (
                  <li key={d.key} className="import-deck-summary-item">
                    <div className="import-deck-draft-row">
                      <input
                        type="text"
                        className="import-deck-name-input import-deck-draft-name"
                        value={d.name}
                        onChange={(e) => patchDraft(d.key, { name: e.target.value })}
                        maxLength={120}
                        aria-label={`Deck name for ${d.fileName}`}
                      />
                      <select
                        className="import-deck-draft-format"
                        value={d.format}
                        onChange={(e) => changeDraftFormat(d.key, e.target.value as DeckFormat)}
                        aria-label={`Format for ${d.name}`}
                      >
                        {FORMATS.map((f) => (
                          <option key={f} value={f}>
                            {DECK_FORMAT_CONFIGS[f].label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="import-deck-summary-meta">
                      <span>
                        {d.result?.cardCount} card{d.result?.cardCount === 1 ? '' : 's'}
                      </span>
                      {d.result && (d.result.considering?.length ?? 0) > 0 && (
                        <span>{d.result.considering!.length} to Considering</span>
                      )}
                      {d.result && d.result.unresolvedNames.length > 0 && (
                        <span className="import-deck-summary-warn">
                          {d.result.unresolvedNames.length} skipped
                        </span>
                      )}
                      {d.result && d.result.fetchErrors.length > 0 && (
                        <span className="import-deck-summary-warn">
                          {d.result.fetchErrors.length} couldn't be fetched{' '}
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => void retryDraft(d)}
                            disabled={isLoading}
                          >
                            Retry
                          </button>
                        </span>
                      )}
                      <span className="import-deck-summary-file">{d.fileName}</span>
                    </div>

                    {DECK_FORMAT_CONFIGS[d.format].hasCommander && (
                      <div className="import-deck-draft-commander">
                        {d.commander && !d.searchOpen ? (
                          <div className="import-deck-commander-selected">
                            <img
                              className="import-deck-commander-art"
                              src={getCardImageUrl(d.commander, 'small')}
                              alt=""
                              aria-hidden="true"
                            />
                            <div className="import-deck-commander-info">
                              <span className="import-deck-commander-name">{d.commander.name}</span>
                              <span className="import-deck-commander-type">
                                {d.commander.type_line ?? d.commander.card_faces?.[0]?.type_line}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="btn-link"
                              onClick={() => patchDraft(d.key, { searchOpen: true })}
                            >
                              Change
                            </button>
                          </div>
                        ) : !d.searchOpen ? (
                          <>
                            <span className="import-deck-summary-warn">Pick a commander</span>
                            {d.candidates.length > 0 && (
                              <ul className="import-deck-commander-list">
                                {d.candidates.map((card) => (
                                  <li key={card.id}>
                                    <button
                                      type="button"
                                      className="import-deck-commander-option"
                                      onClick={() =>
                                        patchDraft(d.key, { commander: card, partner: null })
                                      }
                                    >
                                      <img
                                        className="import-deck-commander-art"
                                        src={getCardImageUrl(card, 'small')}
                                        alt=""
                                        aria-hidden="true"
                                      />
                                      <div className="import-deck-commander-info">
                                        <span className="import-deck-commander-name">
                                          {card.name}
                                        </span>
                                        <span className="import-deck-commander-type">
                                          {card.type_line ?? card.card_faces?.[0]?.type_line}
                                        </span>
                                      </div>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                            <button
                              type="button"
                              className="btn-link import-deck-search-link"
                              onClick={() => patchDraft(d.key, { searchOpen: true })}
                            >
                              Search for a commander
                            </button>
                          </>
                        ) : (
                          <CommanderSearch
                            key={d.format}
                            format={d.format}
                            value={d.commander}
                            onSelect={(card) =>
                              patchDraft(d.key, {
                                commander: card,
                                partner: null,
                                searchOpen: false,
                              })
                            }
                          />
                        )}
                        {d.commander && !d.searchOpen && (
                          <PartnerImportPicker
                            commander={d.commander}
                            candidates={partnerCandidatesFor(d.result?.cards, d.commander)}
                            partner={d.partner}
                            onSelect={(card) => patchDraft(d.key, { partner: card })}
                          />
                        )}
                      </div>
                    )}
                  </li>
                )
              )}
            </ul>
          </>
        )}

        {step === 'review' && pendingResult && (
          <>
            <ImportParseSummary
              result={pendingResult}
              selectedFormat={selectedFormat}
              isLoading={isLoading}
              onRetry={retryReview}
              onSwitchFormat={setSelectedFormat}
            />

            {formatConfig.hasCommander && (
              <div className="import-deck-commander-section">
                <div className="import-deck-section-title">Commander</div>
                {pendingCommander && !showCommanderSearch ? (
                  <div className="import-deck-commander-selected">
                    <img
                      className="import-deck-commander-art"
                      src={getCardImageUrl(pendingCommander, 'small')}
                      alt=""
                      aria-hidden="true"
                    />
                    <div className="import-deck-commander-info">
                      <span className="import-deck-commander-name">{pendingCommander.name}</span>
                      <span className="import-deck-commander-type">
                        {pendingCommander.type_line ?? pendingCommander.card_faces?.[0]?.type_line}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setShowCommanderSearch(true)}
                    >
                      Change
                    </button>
                  </div>
                ) : commanderCandidates.length > 0 && !showCommanderSearch ? (
                  <>
                    <p className="import-deck-hint">Select a commander from the imported cards.</p>
                    <ul className="import-deck-commander-list">
                      {commanderCandidates.map((card) => (
                        <li key={card.id}>
                          <button
                            type="button"
                            className="import-deck-commander-option"
                            onClick={() => handleCommanderSelect(card)}
                          >
                            <img
                              className="import-deck-commander-art"
                              src={getCardImageUrl(card, 'small')}
                              alt=""
                              aria-hidden="true"
                            />
                            <div className="import-deck-commander-info">
                              <span className="import-deck-commander-name">{card.name}</span>
                              <span className="import-deck-commander-type">
                                {card.type_line ?? card.card_faces?.[0]?.type_line}
                              </span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="btn-link import-deck-search-link"
                      onClick={() => setShowCommanderSearch(true)}
                    >
                      Search for a different commander
                    </button>
                  </>
                ) : (
                  <CommanderSearch
                    key={selectedFormat}
                    format={selectedFormat}
                    value={null}
                    onSelect={handleCommanderSelect}
                  />
                )}
              </div>
            )}

            {formatConfig.hasCommander && pendingCommander && !showCommanderSearch && (
              <PartnerImportPicker
                commander={pendingCommander}
                candidates={partnerCandidates}
                partner={pendingPartner}
                onSelect={setPendingPartner}
              />
            )}
          </>
        )}

        {step === 'parsing' && (
          <div className="import-deck-loading">
            <ProgressBar
              indeterminate
              message={
                progress
                  ? `Parsing ${progress.done + 1} of ${progress.total}: ${progress.label}`
                  : 'Parsing and resolving cards…'
              }
            />
          </div>
        )}
      </div>

      {step === 'input' && (
        <div className="modal-footer">
          {canPickDrive && (
            <button
              type="button"
              className="btn"
              onClick={handlePickDrive}
              disabled={isLoading || driveBusy}
              title="Browse your Google Drive — Sheets are exported to CSV automatically"
            >
              {driveBusy ? (
                <span className="spinner" />
              ) : (
                <Cloud width={14} height={14} strokeWidth={1.8} aria-hidden />
              )}
              <span>{driveBusy ? 'Opening…' : 'Google Drive'}</span>
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={handlePickFile}
            disabled={isLoading}
            title="Choose one or more files — each becomes its own deck"
          >
            <Upload width={14} height={14} strokeWidth={1.8} aria-hidden />
            <span>Upload files</span>
          </button>
          {batchFiles.length > 0 ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={runParse}
              disabled={isLoading || publishing}
            >
              <span>
                Continue ({batchFiles.length} file{batchFiles.length === 1 ? '' : 's'})
              </span>
              <ChevronRight width={14} height={14} strokeWidth={1.8} aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handlePasteImport}
              disabled={isLoading || !pasteText.trim() || publishing}
            >
              <Download width={14} height={14} strokeWidth={1.8} aria-hidden />
              <span>Import</span>
            </button>
          )}
        </div>
      )}

      {step === 'batch' && (
        <div className="modal-footer">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDrafts([]);
              setStep('input');
            }}
          >
            Back
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={commitBatch}
            disabled={okDrafts.length === 0}
          >
            Create {okDrafts.length} deck{okDrafts.length === 1 ? '' : 's'}
          </button>
        </div>
      )}

      {step === 'review' && (
        <div className="modal-footer">
          <button type="button" className="btn" onClick={() => setStep('input')}>
            Back
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirmReview}
            disabled={!canConfirmReview || publishing}
          >
            Create deck
          </button>
        </div>
      )}
    </Modal>
  );
}
