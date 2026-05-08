import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll';
import { importDeckText, importDeckFile } from '../../lib/api';
import { useDecksStore, newDeckCard } from '../../store/decks';
import { useCollectionStore } from '../../store/collection';
import { buildAllocationMap, pickCollectionCopy, type AllocationInfo } from '../../lib/allocations';
import { CommanderSearch } from './CommanderSearch';
import { getCardImageUrl } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard } from '@/deck-builder/types';
import type { DeckImportResponse } from '../../types';

interface Props {
  onClose: () => void;
}

type Step = 'input' | 'commander' | 'importing';

function isValidCommander(card: ScryfallCard): boolean {
  const typeLine = (card.type_line ?? card.card_faces?.[0]?.type_line ?? '').toLowerCase();
  const oracleText = (
    card.oracle_text ??
    card.card_faces?.map((f) => f.oracle_text ?? '').join(' ') ??
    ''
  ).toLowerCase();
  const isLegendaryCreature = typeLine.includes('legendary') && typeLine.includes('creature');
  const canBeCommander = oracleText.includes('can be your commander');
  if (!isLegendaryCreature && !canBeCommander) return false;
  const legality = card.legalities?.commander;
  return legality === 'legal' || legality === 'restricted';
}

function dedupeByName(cards: ScryfallCard[]): ScryfallCard[] {
  const seen = new Set<string>();
  return cards.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}

export function ImportDeckDialog({ onClose }: Props) {
  const navigate = useNavigate();
  const decks = useDecksStore((s) => s.decks);
  const createDeck = useDecksStore((s) => s.createDeck);
  const collectionCards = useCollectionStore((s) => s.cards);

  const [step, setStep] = useState<Step>('input');
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingResult, setPendingResult] = useState<DeckImportResponse | null>(null);
  const [showCommanderSearch, setShowCommanderSearch] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useLockBodyScroll();

  const commanderCandidates = useMemo(
    () => dedupeByName(pendingResult?.cards.filter(isValidCommander) ?? []),
    [pendingResult]
  );

  const finalizeDeck = useCallback(
    (result: DeckImportResponse, commander: ScryfallCard) => {
      const claimed = new Map<string, AllocationInfo>(buildAllocationMap(decks));

      const allocateFor = (cardName: string): string | null => {
        const pick = pickCollectionCopy(cardName, collectionCards, claimed);
        if (!pick) return null;
        claimed.set(pick.copyId, {
          deckId: '__pending__',
          deckName: '__pending__',
          cardName,
        });
        return pick.copyId;
      };

      const commanderAlloc = allocateFor(commander.name);

      const cards = result.cards
        .filter((c) => c.name !== commander.name)
        .map((card) => newDeckCard(card, allocateFor(card.name)));

      const id = createDeck({
        source: 'manual',
        commander,
        commanderAllocatedCopyId: commanderAlloc,
        cards,
      });

      onClose();
      navigate(`/decks/${id}`);
    },
    [decks, collectionCards, createDeck, navigate, onClose]
  );

  const handleImportResult = useCallback(
    (result: DeckImportResponse) => {
      if (result.commander) {
        finalizeDeck(result, result.commander);
        return;
      }
      const candidates = dedupeByName(result.cards.filter(isValidCommander));
      if (candidates.length === 1) {
        finalizeDeck(result, candidates[0]);
        return;
      }
      setPendingResult(result);
      setStep('commander');
      setIsLoading(false);
    },
    [finalizeDeck]
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

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (!file || isLoading) return;
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

  const handleCommanderSelect = useCallback(
    (card: ScryfallCard | null) => {
      if (!card || !pendingResult) return;
      finalizeDeck(pendingResult, card);
    },
    [pendingResult, finalizeDeck]
  );

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal import-deck-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-deck-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="import-deck-title">
            {step === 'commander' ? 'Select commander' : 'Import deck'}
          </h2>
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

        <div className="modal-body">
          {error && (
            <div className="error-banner">
              <span>{error}</span>
              <button
                className="banner-dismiss"
                onClick={() => setError(null)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}

          {step === 'input' && (
            <>
              <p className="import-deck-hint">
                Paste a deck list below or upload an export file. Supports MTGA, ManaBox, Moxfield,
                Archidekt, and plain text formats. If the list includes a "Commander" section
                header, it will be detected automatically.
              </p>
              <textarea
                className="paste-textarea import-textarea"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={
                  'Commander\n1 Korvold, Fae-Cursed King\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n1 Cultivate\n...'
                }
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

          {step === 'commander' && pendingResult && (
            <>
              <p className="import-deck-hint">
                No commander section was found in the import ({pendingResult.cardCount} cards
                parsed).{' '}
                {commanderCandidates.length > 0 && !showCommanderSearch
                  ? 'Select a commander from the imported cards.'
                  : 'Search for a commander to lead this deck.'}
              </p>
              {commanderCandidates.length > 0 && !showCommanderSearch && (
                <>
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
              )}
              {(showCommanderSearch || commanderCandidates.length === 0) && (
                <CommanderSearch value={null} onSelect={handleCommanderSelect} />
              )}
            </>
          )}

          {step === 'importing' && (
            <div className="import-deck-loading" role="status" aria-live="polite">
              <p>Importing and resolving cards...</p>
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

        {step === 'commander' && (
          <div className="modal-footer">
            <button type="button" className="btn" onClick={() => setStep('input')}>
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
