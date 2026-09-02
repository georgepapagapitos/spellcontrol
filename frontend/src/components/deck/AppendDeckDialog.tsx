import { useCallback, useMemo, useState } from 'react';
import { WifiOff, Download } from 'lucide-react';
import { Modal } from '../Modal';
import { ProgressBar } from '../ProgressBar';
import { importDeckText } from '../../lib/api';
import { useDecksStore, type Deck } from '../../store/decks';
import { useCollectionStore } from '../../store/collection';
import { useDeckHistoryStore } from '../../store/deck-history';
import {
  buildAppendPlan,
  appendPartnerCandidatesFor,
  type AppendPlan,
} from '../../lib/append-deck-import';
import { validateDeck, type LegalityIssue } from '../../lib/deck-validation';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { ScryfallCard } from '@/deck-builder/types';
import type { DeckImportResponse } from '../../types';
import { ImportParseSummary, PartnerImportPicker, useOnline } from './import-deck-shared';
import { CommanderSearch } from './CommanderSearch';
import { getCardImageUrl } from '@/deck-builder/services/scryfall/client';
import './AppendDeckDialog.css';

import { userMessage } from '@/lib/user-error';
interface Props {
  deck: Deck;
  onClose: () => void;
}

type Step = 'input' | 'parsing' | 'review';

/**
 * Paste a decklist INTO a deck that already exists (bulk append) — the
 * "one search-result click at a time" gap ImportDeckDialog doesn't cover
 * (it only ever creates a new deck). Same parser/review pieces as
 * ImportDeckDialog (see import-deck-shared.tsx), but the commit path is
 * fundamentally different: everything lands in exactly ONE `replaceDeck`
 * call wrapped in ONE `recordEdit`, never a per-card store write — see
 * `buildAppendPlan` for why that matters.
 */
export function AppendDeckDialog({ deck, onClose }: Props) {
  const decks = useDecksStore((s) => s.decks);
  const replaceDeck = useDecksStore((s) => s.replaceDeck);
  const recordEdit = useDeckHistoryStore((s) => s.record);
  const online = useOnline();

  const [step, setStep] = useState<Step>('input');
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<DeckImportResponse | null>(null);
  const [chosenCommander, setChosenCommander] = useState<ScryfallCard | null>(null);
  const [chosenPartner, setChosenPartner] = useState<ScryfallCard | null>(null);
  const [showCommanderSearch, setShowCommanderSearch] = useState(false);

  const formatConfig = DECK_FORMAT_CONFIGS[deck.format];

  const runImport = useCallback(async () => {
    const text = pasteText.trim();
    if (!text || isLoading || !online) return;
    setError(null);
    setIsLoading(true);
    setStep('parsing');
    try {
      const r = await importDeckText(text);
      setResult(r);
      setChosenCommander(null);
      setChosenPartner(null);
      setShowCommanderSearch(false);
      setStep('review');
    } catch (err) {
      setError(userMessage(err, "Couldn't read that deck list. Check the format and try again."));
      setStep('input');
    } finally {
      setIsLoading(false);
    }
  }, [pasteText, isLoading, online]);

  // A degraded resolve (fetchErrors) keeps the raw result cached server-side —
  // re-POSTing the same text is cheap and converges once the card service
  // answers, mirroring ImportDeckDialog's retryReview.
  const retryReview = useCallback(() => {
    if (isLoading) return;
    void runImport();
  }, [isLoading, runImport]);

  const collectionCards = useCollectionStore((s) => s.cards);

  const plan: AppendPlan | null = useMemo(() => {
    if (!result) return null;
    return buildAppendPlan(deck, result, chosenCommander, chosenPartner, {
      decks,
      collectionCards,
    });
  }, [result, deck, chosenCommander, chosenPartner, decks, collectionCards]);

  // Legality check scoped to just what THIS paste would add — a deck that
  // already had an issue before pasting shouldn't get re-reported here.
  const newIssues: LegalityIssue[] = useMemo(() => {
    if (!plan) return [];
    const addedSlotIds = new Set([
      ...plan.addedCards.map((c) => c.slotId),
      ...plan.addedSideboard.map((c) => c.slotId),
    ]);
    if (addedSlotIds.size === 0) return [];
    return validateDeck(plan.cards, plan.sideboard, formatConfig, {
      commander: plan.commander,
      partnerCommander: plan.partnerCommander,
    }).filter((issue) => addedSlotIds.has(issue.slotId));
  }, [plan, formatConfig]);

  const partnerCandidates = useMemo(
    () => (result ? appendPartnerCandidatesFor(result, chosenCommander) : []),
    [result, chosenCommander]
  );

  const handleConfirm = useCallback(() => {
    if (!plan || plan.addedCount === 0) return;
    const label = `paste ${plan.addedCount} card${plan.addedCount === 1 ? '' : 's'}`;
    recordEdit(deck.id, label, () => {
      replaceDeck(deck.id, {
        ...deck,
        cards: plan.cards,
        sideboard: plan.sideboard,
        considering: plan.considering,
        commander: plan.commander,
        partnerCommander: plan.partnerCommander,
        commanderAllocatedCopyId: plan.commanderAllocatedCopyId,
        partnerCommanderAllocatedCopyId: plan.partnerCommanderAllocatedCopyId,
      });
    });
    onClose();
  }, [plan, deck, recordEdit, replaceDeck, onClose]);

  const decision = plan?.commanderDecision;

  return (
    <Modal
      onClose={onClose}
      labelledBy="append-deck-title"
      className="modal import-deck-modal"
      dismissable={!isLoading}
    >
      <div className="modal-header">
        <h2 id="append-deck-title">Paste cards into {deck.name}</h2>
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
        {!online && (
          <p className="append-deck-offline" role="status">
            <WifiOff width={14} height={14} strokeWidth={2} aria-hidden />
            You're offline — reconnect to paste a list. Every other way to add cards still works.
          </p>
        )}

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="banner-dismiss" onClick={() => setError(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        {step === 'input' && (
          <>
            <p className="import-deck-hint">
              Paste a decklist — one card per line. Lines under a <strong>Sideboard</strong> header
              route to this deck's sideboard; lines under a <strong>Maybeboard</strong> header route
              to Considering. Everything else goes to the mainboard.
            </p>
            <textarea
              className="paste-textarea import-textarea"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'1 Sol Ring\n1 Arcane Signet\n1 Cultivate\n...'}
              disabled={isLoading || !online}
              autoFocus
            />
          </>
        )}

        {step === 'parsing' && (
          <div className="import-deck-loading">
            <ProgressBar indeterminate message="Parsing and resolving cards…" />
          </div>
        )}

        {step === 'review' && result && plan && (
          <>
            <ImportParseSummary
              result={result}
              selectedFormat={deck.format}
              isLoading={isLoading}
              onRetry={retryReview}
            />

            {plan.skippedDuplicates.length > 0 && (
              <div className="import-deck-warning">
                <div className="import-deck-warning-title">
                  Already in the deck at the {formatConfig.label} copy limit — not added again:
                </div>
                <ul className="import-deck-unresolved-list">
                  {plan.skippedDuplicates.map((d) => (
                    <li key={d.name}>
                      {d.name}
                      {d.count > 1 ? ` ×${d.count}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {newIssues.length > 0 && (
              <div className="import-deck-warning">
                <div className="import-deck-warning-title">
                  {newIssues.length} added card{newIssues.length === 1 ? '' : 's'} would be illegal
                  in this deck:
                </div>
                <ul className="import-deck-unresolved-list">
                  {newIssues.map((issue) => (
                    <li key={`${issue.slotId}-${issue.issue}`}>
                      {issue.cardName} — {issue.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {decision?.kind === 'matches-existing' && (
              <p className="import-deck-hint">
                {decision.commander.name} is already this deck's commander — not added twice.
              </p>
            )}

            {decision?.kind === 'conflicts-with-existing' && (
              <div className="import-deck-warning">
                This list's commander (<strong>{decision.pasted.name}</strong>) is different from
                this deck's current commander, <strong>{decision.existing.name}</strong>. Kept{' '}
                {decision.existing.name} as commander — {decision.pasted.name} was added as a
                regular card instead. Use its card row's "Make commander" action if you meant to
                swap.
              </div>
            )}

            {decision?.kind === 'deck-has-none' && decision.candidates.length > 0 && (
              <div className="import-deck-commander-section">
                <div className="import-deck-section-title">Set as commander (optional)</div>
                {chosenCommander && !showCommanderSearch ? (
                  <div className="import-deck-commander-selected">
                    <img
                      className="import-deck-commander-art"
                      src={getCardImageUrl(chosenCommander, 'small')}
                      alt=""
                      aria-hidden="true"
                    />
                    <div className="import-deck-commander-info">
                      <span className="import-deck-commander-name">{chosenCommander.name}</span>
                      <span className="import-deck-commander-type">
                        {chosenCommander.type_line ?? chosenCommander.card_faces?.[0]?.type_line}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => {
                        setChosenCommander(null);
                        setChosenPartner(null);
                      }}
                    >
                      Don't set
                    </button>
                  </div>
                ) : !showCommanderSearch ? (
                  <>
                    <p className="import-deck-hint">
                      This deck has no commander yet — pick one from the pasted cards, or skip and
                      set it later.
                    </p>
                    <ul className="import-deck-commander-list">
                      {decision.candidates.map((card) => (
                        <li key={card.id}>
                          <button
                            type="button"
                            className="import-deck-commander-option"
                            onClick={() => setChosenCommander(card)}
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
                      Search for a commander
                    </button>
                  </>
                ) : (
                  <CommanderSearch
                    key={deck.format}
                    format={deck.format}
                    value={chosenCommander}
                    onSelect={(card) => {
                      setChosenCommander(card);
                      setChosenPartner(null);
                      setShowCommanderSearch(false);
                    }}
                  />
                )}
                {chosenCommander && !showCommanderSearch && (
                  <PartnerImportPicker
                    commander={chosenCommander}
                    candidates={partnerCandidates}
                    partner={chosenPartner}
                    onSelect={setChosenPartner}
                  />
                )}
              </div>
            )}

            {plan.addedCount === 0 && (
              <p className="append-deck-nothing-to-add" role="status">
                Nothing to add — check the pasted list.
              </p>
            )}
          </>
        )}
      </div>

      {step === 'input' && (
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-primary"
            onClick={runImport}
            disabled={isLoading || !pasteText.trim() || !online}
          >
            <Download width={14} height={14} strokeWidth={1.8} aria-hidden />
            <span>Parse list</span>
          </button>
        </div>
      )}

      {step === 'review' && plan && (
        <div className="modal-footer">
          <button type="button" className="btn" onClick={() => setStep('input')}>
            Back
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={plan.addedCount === 0}
          >
            Add {plan.addedCount} card{plan.addedCount === 1 ? '' : 's'}
          </button>
        </div>
      )}
    </Modal>
  );
}
