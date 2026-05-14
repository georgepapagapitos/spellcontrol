import { useCallback, useMemo, useRef, useState } from 'react';
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
  /** Initial format selection. The user can change it from inside the dialog. */
  format?: DeckFormat;
}

type Step = 'input' | 'importing' | 'review';

function splitImportZones(cards: ScryfallCard[]): {
  mainboard: ScryfallCard[];
  sideboard: ScryfallCard[];
} {
  return { mainboard: cards, sideboard: [] };
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
  return (Object.keys(DECK_FORMAT_CONFIGS) as DeckFormat[]).find((f) => f === slug) ?? null;
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

  const allocateCards = useCallback(
    (cardList: ScryfallCard[]) => {
      const claimed = new Map<string, AllocationInfo>(buildAllocationMap(decks));
      return cardList.map((card) => {
        const pick = pickCollectionCopy(card.name, collectionCards, claimed, card.id);
        if (pick) {
          claimed.set(pick.copyId, {
            deckId: '__pending__',
            deckName: '__pending__',
            cardName: card.name,
          });
        }
        return newDeckCard(card, pick?.copyId ?? null);
      });
    },
    [decks, collectionCards]
  );

  const finalizeDeck = useCallback(
    (result: DeckImportResponse, commander: ScryfallCard, name: string) => {
      const mainCards = result.cards.filter((c) => c.name !== commander.name);
      const cards = allocateCards(mainCards);
      const commanderPick = pickCollectionCopy(
        commander.name,
        collectionCards,
        buildAllocationMap(decks),
        commander.id
      );

      const id = createDeck({
        name: name.trim() || undefined,
        format: selectedFormat,
        source: 'manual',
        commander,
        commanderAllocatedCopyId: commanderPick?.copyId ?? null,
        cards,
      });

      onClose();
      navigate(`/decks/${id}`);
    },
    [allocateCards, collectionCards, decks, createDeck, navigate, onClose, selectedFormat]
  );

  const finalizeWithoutCommander = useCallback(
    (result: DeckImportResponse, name: string) => {
      const { mainboard, sideboard } = splitImportZones(result.cards);
      const cards = allocateCards(mainboard);
      const sideboardCards = allocateCards(sideboard);

      const id = createDeck({
        name: name.trim() || undefined,
        format: selectedFormat,
        source: 'manual',
        commander: null,
        cards,
        sideboard: sideboardCards,
      });

      onClose();
      navigate(`/decks/${id}`);
    },
    [allocateCards, createDeck, navigate, onClose, selectedFormat]
  );

  const handleImportResult = useCallback(
    (result: DeckImportResponse) => {
      const hasWarnings =
        result.unresolvedNames.length > 0 ||
        (normalizeFormat(result.detectedFormat) !== null &&
          normalizeFormat(result.detectedFormat) !== selectedFormat);

      // Resolve commander if format calls for one.
      let commander: ScryfallCard | null = null;
      let needsCommanderChoice = false;
      if (formatConfig.hasCommander) {
        if (result.commander) {
          commander = result.commander;
        } else {
          const candidates = dedupeByName(result.cards.filter(isValidCommander));
          if (candidates.length === 1) {
            commander = candidates[0];
          } else {
            needsCommanderChoice = true;
          }
        }
      }

      // Fast path: nothing to review, finalize immediately.
      if (!needsCommanderChoice && !hasWarnings) {
        if (formatConfig.hasCommander && commander) {
          finalizeDeck(result, commander, deckName);
        } else {
          finalizeWithoutCommander(result, deckName);
        }
        return;
      }

      setPendingResult(result);
      setPendingCommander(commander);
      setShowCommanderSearch(false);
      setStep('review');
      setIsLoading(false);
    },
    [finalizeDeck, finalizeWithoutCommander, formatConfig, selectedFormat, deckName]
  );

  const handlePasteImport = useCallback(async () => {
    const text = pasteText.trim();
    if (!text || isLoading) return;
    setError(null);
    setIsLoading(true);
    setStep('importing');
    try {
      const result = await importDeckText(text);
      handleImportResult(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Import failed. Check the format and try again.'
      );
      setStep('input');
      setIsLoading(false);
    }
  }, [pasteText, isLoading, handleImportResult]);

  const importFile = useCallback(
    async (file: File) => {
      if (isLoading) return;
      setError(null);
      setIsLoading(true);
      setStep('importing');
      try {
        const result = await importDeckFile(file);
        handleImportResult(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Import failed. Check the format and try again.'
        );
        setStep('input');
        setIsLoading(false);
      }
    },
    [isLoading, handleImportResult]
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (!file) return;
      void importFile(file);
    },
    [importFile]
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
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      void importFile(file);
    },
    [importFile, isLoading, step]
  );

  const handleCommanderSelect = useCallback((card: ScryfallCard | null) => {
    setPendingCommander(card);
    setShowCommanderSearch(false);
  }, []);

  const handleConfirmReview = useCallback(() => {
    if (!pendingResult) return;
    if (formatConfig.hasCommander) {
      if (!pendingCommander) return;
      finalizeDeck(pendingResult, pendingCommander, deckName);
    } else {
      finalizeWithoutCommander(pendingResult, deckName);
    }
  }, [
    pendingResult,
    pendingCommander,
    formatConfig.hasCommander,
    finalizeDeck,
    finalizeWithoutCommander,
    deckName,
  ]);

  const canConfirm = !!pendingResult && (!formatConfig.hasCommander || pendingCommander !== null);

  const reviewTitle = step === 'review' ? 'Review import' : 'Import deck';

  return (
    <Modal
      onClose={onClose}
      labelledBy="import-deck-title"
      className="modal import-deck-modal"
      dismissable={!isLoading}
    >
      <div className="modal-header">
        <h2 id="import-deck-title">{reviewTitle}</h2>
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
            <div className="import-deck-drop-message">Drop file to import</div>
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
              <span className="import-deck-format-label">Format</span>
              <div className="format-pill-row" role="radiogroup" aria-label="Deck format">
                {(Object.keys(DECK_FORMAT_CONFIGS) as DeckFormat[]).map((fmt) => {
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
              Paste a deck list below, drop a file anywhere on this dialog, or click Upload.
              Supports MTGA, ManaBox, Moxfield, Archidekt, and plain text formats.
              {formatConfig.hasCommander
                ? ' If the list includes a "Commander" section header, it will be detected automatically.'
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
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv,.tsv,.txt"
              style={{ display: 'none' }}
              onChange={handleFileChange}
              disabled={isLoading}
            />
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

        {step === 'importing' && (
          <div className="import-deck-loading">
            <ProgressBar indeterminate message="Importing and resolving cards…" />
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
          >
            Upload file
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handlePasteImport}
            disabled={isLoading || !pasteText.trim()}
          >
            Import
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
            disabled={!canConfirm}
          >
            Create deck
          </button>
        </div>
      )}
    </Modal>
  );
}
