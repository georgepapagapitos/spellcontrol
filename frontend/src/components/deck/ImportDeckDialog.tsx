import { useCallback, useMemo, useRef, useState } from 'react';
import { Upload, Download, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../Modal';
import { ProgressBar } from '../ProgressBar';
import { importDeckText, importDeckFile } from '../../lib/api';
import { useDecksStore, newDeckCard } from '../../store/decks';
import { useCollectionStore } from '../../store/collection';
import { buildAllocationMap, pickCollectionCopy, type AllocationInfo } from '../../lib/allocations';
import { CommanderSearch } from './CommanderSearch';
import { getCardImageUrl } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard, DeckFormat } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { DeckImportResponse } from '../../types';
import { isValidCommander } from '../../lib/commanders';

interface Props {
  onClose: () => void;
  /** Initial / fallback format selection. The user can change it per deck. */
  format?: DeckFormat;
}

type Step = 'input' | 'parsing' | 'batch' | 'review';

type BatchMode = 'separate' | 'merge';

const FORMATS = Object.keys(DECK_FORMAT_CONFIGS) as DeckFormat[];

/** Most files that can be staged for a single batch import. */
const MAX_FILES = 10;

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
  candidates: ScryfallCard[];
  searchOpen: boolean;
}

function dedupeByName(cards: ScryfallCard[]): ScryfallCard[] {
  const seen = new Set<string>();
  return cards.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}

function normalizeFormat(detected: string | undefined | null): DeckFormat | null {
  if (!detected) return null;
  const slug = detected.toLowerCase();
  return FORMATS.find((f) => f === slug) ?? null;
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** Returns `name` if free, else the next available "base (n).ext" variant. */
function uniqueFileName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 1;
  while (taken.has(`${base} (${n})${ext}`)) n++;
  return `${base} (${n})${ext}`;
}

const PASTE_PLACEHOLDERS: Record<DeckFormat, string> = {
  commander:
    'Commander\n1 Korvold, Fae-Cursed King\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n1 Cultivate\n...',
  brawl:
    'Commander\n1 Chulane, Teller of Tales\n\nDeck\n1 Arcane Signet\n1 Cultivate\n1 Llanowar Elves\n...',
  standard:
    'Deck\n4 Lightning Strike\n4 Monastery Swiftspear\n20 Mountain\n...\n\nSideboard\n3 Roiling Vortex\n...',
  pauper:
    'Deck\n4 Lightning Bolt\n4 Brainstorm\n4 Ponder\n18 Island\n...\n\nSideboard\n2 Pyroblast\n...',
};

export function ImportDeckDialog({ onClose, format: initialFormat = 'commander' }: Props) {
  const navigate = useNavigate();
  const decks = useDecksStore((s) => s.decks);
  const createDeck = useDecksStore((s) => s.createDeck);
  const collectionCards = useCollectionStore((s) => s.cards);

  const [selectedFormat, setSelectedFormat] = useState<DeckFormat>(initialFormat);
  const formatConfig = DECK_FORMAT_CONFIGS[selectedFormat];
  const [step, setStep] = useState<Step>('input');
  const [pasteText, setPasteText] = useState('');
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
  const [showCommanderSearch, setShowCommanderSearch] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const commanderCandidates = useMemo(
    () => dedupeByName(pendingResult?.cards.filter(isValidCommander) ?? []),
    [pendingResult]
  );

  const detectedFormat = useMemo(
    () => normalizeFormat(pendingResult?.detectedFormat),
    [pendingResult]
  );
  const formatMismatch = detectedFormat !== null && detectedFormat !== selectedFormat;

  /**
   * Allocates each card to an owned physical copy, mutating the shared `claimed`
   * map so multiple decks created together can't both grab the same copy.
   */
  const allocateCardsWith = useCallback(
    (cardList: ScryfallCard[], claimed: Map<string, AllocationInfo>) =>
      cardList.map((card) => {
        const pick = pickCollectionCopy(card.name, collectionCards, claimed, card.id);
        if (pick) {
          claimed.set(pick.copyId, {
            deckId: '__pending__',
            deckName: '__pending__',
            deckColor: '',
            cardName: card.name,
          });
        }
        return newDeckCard(card, pick?.copyId ?? null);
      }),
    [collectionCards]
  );

  /**
   * Creates a deck from a resolved import response and returns its id. Pass a
   * shared `claimed` map when creating several decks at once so physical copy
   * allocations don't collide; omit it for one-off imports.
   */
  const buildDeckFromResult = useCallback(
    (
      result: DeckImportResponse,
      commander: ScryfallCard | null,
      name: string,
      format: DeckFormat,
      claimed?: Map<string, AllocationInfo>
    ): string => {
      const claim = claimed ?? new Map<string, AllocationInfo>(buildAllocationMap(decks));
      if (commander) {
        const mainCards = result.cards.filter((c) => c.name !== commander.name);
        const cards = allocateCardsWith(mainCards, claim);
        const commanderPick = pickCollectionCopy(
          commander.name,
          collectionCards,
          claim,
          commander.id
        );
        if (commanderPick) {
          claim.set(commanderPick.copyId, {
            deckId: '__pending__',
            deckName: '__pending__',
            deckColor: '',
            cardName: commander.name,
          });
        }
        return createDeck({
          name: name.trim() || undefined,
          format,
          source: 'manual',
          commander,
          commanderAllocatedCopyId: commanderPick?.copyId ?? null,
          cards,
        });
      }
      const cards = allocateCardsWith(result.cards, claim);
      return createDeck({
        name: name.trim() || undefined,
        format,
        source: 'manual',
        commander: null,
        cards,
        sideboard: [],
      });
    },
    [allocateCardsWith, collectionCards, decks, createDeck]
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
      const candidates = dedupeByName(result.cards.filter(isValidCommander));
      if (candidates.length === 1) return { commander: candidates[0], needsChoice: false };
      return { commander: null, needsChoice: true };
    },
    []
  );

  // --- Legacy single-deck flow (paste + merge) ----------------------------

  const finalizeDeck = useCallback(
    (result: DeckImportResponse, commander: ScryfallCard | null, name: string) => {
      const id = buildDeckFromResult(result, commander, name, selectedFormat);
      onClose();
      navigate(`/decks/${id}`);
    },
    [buildDeckFromResult, navigate, onClose, selectedFormat]
  );

  const processSingleResult = useCallback(
    (result: DeckImportResponse) => {
      const hasWarnings =
        result.unresolvedNames.length > 0 ||
        (normalizeFormat(result.detectedFormat) !== null &&
          normalizeFormat(result.detectedFormat) !== selectedFormat);
      const { commander, needsChoice } = resolveAutoCommander(result, selectedFormat);

      if (!needsChoice && !hasWarnings) {
        finalizeDeck(result, formatConfig.hasCommander ? commander : null, deckName);
        return;
      }
      setPendingResult(result);
      setPendingCommander(commander);
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
      finalizeDeck(pendingResult, pendingCommander, deckName);
    } else {
      finalizeDeck(pendingResult, null, deckName);
    }
  }, [pendingResult, pendingCommander, formatConfig.hasCommander, finalizeDeck, deckName]);

  // --- Multi-file staging + parse-then-review -----------------------------

  /**
   * Appends files to the staged list (never uploads on selection). Duplicate
   * names are kept as renamed copies ("deck (1).csv"); the list is capped at
   * MAX_FILES and any overflow is dropped with a notice.
   */
  const acceptFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;
      const taken = new Set(batchFiles.map((f) => f.name));
      const next = [...batchFiles];
      let renamed = 0;
      let dropped = 0;
      for (const file of incoming) {
        if (next.length >= MAX_FILES) {
          dropped++;
          continue;
        }
        const finalName = uniqueFileName(file.name, taken);
        if (finalName !== file.name) {
          renamed++;
          next.push(
            new File([file], finalName, { type: file.type, lastModified: file.lastModified })
          );
        } else {
          next.push(file);
        }
        taken.add(finalName);
      }
      const notes: string[] = [];
      if (renamed > 0) {
        notes.push(
          `${renamed} file${renamed === 1 ? '' : 's'} had a duplicate name and ${
            renamed === 1 ? 'was' : 'were'
          } added as a copy.`
        );
      }
      if (dropped > 0) {
        notes.push(
          `${dropped} file${dropped === 1 ? '' : 's'} skipped — you can stage up to ${MAX_FILES} at a time.`
        );
      }
      setError(notes.length > 0 ? notes.join(' ') : null);
      setBatchFiles(next);
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
      let mergedCommander: ScryfallCard | null = null;
      let mergedCompanion: ScryfallCard | null = null;
      const unresolved: string[] = [];
      const failed: string[] = [];
      for (let i = 0; i < total; i++) {
        const file = files[i];
        setProgress({ done: i, total, label: file.name });
        try {
          const r = await importDeckFile(file);
          mergedCards.push(...r.cards);
          if (!mergedCommander && r.commander) mergedCommander = r.commander;
          if (!mergedCompanion && r.companion) mergedCompanion = r.companion;
          unresolved.push(...r.unresolvedNames);
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
        unresolvedNames: Array.from(new Set(unresolved)),
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
          candidates: dedupeByName(r.cards.filter(isValidCommander)),
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

  const changeDraftFormat = useCallback((key: string, format: DeckFormat) => {
    setDrafts((ds) =>
      ds.map((d) => {
        if (d.key !== key) return d;
        let commander = d.commander;
        if (DECK_FORMAT_CONFIGS[format].hasCommander && !commander && d.candidates.length === 1) {
          commander = d.candidates[0];
        }
        return { ...d, format, commander };
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
      ids.push(buildDeckFromResult(d.result, useCommander, d.name, d.format, claimed));
    }
    onClose();
    navigate(ids.length === 1 ? `/decks/${ids[0]}` : '/decks');
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
    setShowCommanderSearch(false);
  }, []);

  const canConfirmReview =
    !!pendingResult && (!formatConfig.hasCommander || pendingCommander !== null);

  const title =
    step === 'review' ? 'Review import' : step === 'batch' ? 'Review decks' : 'Import deck';

  return (
    <Modal
      onClose={onClose}
      labelledBy="import-deck-title"
      className="modal import-deck-modal"
      dismissable={!isLoading}
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
              <div className="format-pill-row" role="radiogroup" aria-label="Default deck format">
                {FORMATS.map((fmt) => {
                  const cfg = DECK_FORMAT_CONFIGS[fmt];
                  const active = selectedFormat === fmt;
                  return (
                    <button
                      key={fmt}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`format-pill${active ? ' active' : ''}`}
                      onClick={() => setSelectedFormat(fmt)}
                      disabled={isLoading}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
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
                {batchFiles.length > 1 && (
                  <div
                    className="import-deck-batch-modes"
                    role="radiogroup"
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
                  </div>
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
                <p className="import-deck-hint">
                  <strong>Select or drop several files at once</strong> (up to {MAX_FILES}) to
                  create multiple decks in one go — each file becomes its own deck, and you can keep
                  adding more before continuing. Or paste a single list below. Supports MTGA,
                  ManaBox, Moxfield, Archidekt, and plain text formats.
                  {formatConfig.hasCommander
                    ? ' A "Commander" section header is detected automatically.'
                    : ''}
                </p>
                <textarea
                  className="paste-textarea import-textarea"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={PASTE_PLACEHOLDERS[selectedFormat]}
                  disabled={isLoading}
                  autoFocus
                />
              </>
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
                      {d.result && d.result.unresolvedNames.length > 0 && (
                        <span className="import-deck-summary-warn">
                          {d.result.unresolvedNames.length} skipped
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
                                      onClick={() => patchDraft(d.key, { commander: card })}
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
                            value={d.commander}
                            onSelect={(card) =>
                              patchDraft(d.key, { commander: card, searchOpen: false })
                            }
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
            <div className="import-deck-review-summary">
              <span>
                Parsed <strong>{pendingResult.cardCount}</strong> card
                {pendingResult.cardCount === 1 ? '' : 's'}
              </span>
              {detectedFormat && (
                <span className="import-deck-review-tag">
                  Detected: {DECK_FORMAT_CONFIGS[detectedFormat].label}
                </span>
              )}
            </div>

            {formatMismatch && detectedFormat && (
              <div className="import-deck-warning">
                The file looks like a <strong>{DECK_FORMAT_CONFIGS[detectedFormat].label}</strong>{' '}
                list, but you selected <strong>{formatConfig.label}</strong>.{' '}
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setSelectedFormat(detectedFormat)}
                >
                  Switch to {DECK_FORMAT_CONFIGS[detectedFormat].label}
                </button>
              </div>
            )}

            {pendingResult.unresolvedNames.length > 0 && (
              <div className="import-deck-warning">
                <div className="import-deck-warning-title">
                  {pendingResult.unresolvedNames.length} card
                  {pendingResult.unresolvedNames.length === 1 ? '' : 's'} couldn't be matched and
                  will be skipped:
                </div>
                <ul className="import-deck-unresolved-list">
                  {pendingResult.unresolvedNames.slice(0, 12).map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                  {pendingResult.unresolvedNames.length > 12 && (
                    <li className="import-deck-unresolved-more">
                      …and {pendingResult.unresolvedNames.length - 12} more
                    </li>
                  )}
                </ul>
              </div>
            )}

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
                            onClick={() => setPendingCommander(card)}
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
                  <CommanderSearch value={null} onSelect={handleCommanderSelect} />
                )}
              </div>
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
          <button
            type="button"
            className="btn"
            onClick={() => fileInputRef.current?.click()}
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
              disabled={isLoading}
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
              disabled={isLoading || !pasteText.trim()}
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
            disabled={!canConfirmReview}
          >
            Create deck
          </button>
        </div>
      )}
    </Modal>
  );
}
