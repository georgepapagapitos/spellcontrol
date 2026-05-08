import { useCallback, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDeckBuilderStore } from '@/deck-builder/store';
import { CommanderSearch } from '../components/deck/CommanderSearch';
import { generateDeck } from '@/deck-builder/services/deckBuilder/deckGenerator';
import { fetchCommanderData } from '@/deck-builder/services/edhrec/client';
import { useCollectionStore } from '../store/collection';
import { useDecksStore, newDeckCard } from '../store/decks';
import { buildAllocationMap, pickCollectionCopy, type AllocationInfo } from '../lib/allocations';
import type { ScryfallCard, GeneratedDeck, DeckCategory } from '@/deck-builder/types';

export function DeckNewPage() {
  const navigate = useNavigate();
  const commander = useDeckBuilderStore((s) => s.commander);
  const setCommander = useDeckBuilderStore((s) => s.setCommander);
  const colorIdentity = useDeckBuilderStore((s) => s.colorIdentity);
  const customization = useDeckBuilderStore((s) => s.customization);
  const setEdhrecStats = useDeckBuilderStore((s) => s.setEdhrecStats);
  const setEdhrecLandSuggestion = useDeckBuilderStore((s) => s.setEdhrecLandSuggestion);
  const updateCustomization = useDeckBuilderStore((s) => s.updateCustomization);

  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const createDeck = useDecksStore((s) => s.createDeck);

  const [progress, setProgress] = useState<{ message: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // ── Start-blank ───────────────────────────────────────────────────────
  const handleStartBlank = useCallback(() => {
    if (!commander) return;
    const allocated = pickCollectionCopy(
      commander.name,
      collectionCards,
      buildAllocationMap(decks)
    );
    const id = createDeck({
      source: 'manual',
      commander,
      commanderAllocatedScryfallId: allocated?.scryfallId ?? null,
    });
    navigate(`/decks/${id}`);
  }, [commander, collectionCards, decks, createDeck, navigate]);

  // ── Generate ──────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!commander) return;
    setError(null);
    setIsGenerating(true);
    setProgress({ message: 'Loading commander data', percent: 5 });
    try {
      const bracket = customization.bracketLevel !== 'all' ? customization.bracketLevel : undefined;
      const data = await fetchCommanderData(commander.name, undefined, bracket).catch(() => null);
      if (data) {
        setEdhrecStats(data.stats);
        const total = data.stats.landDistribution?.total ?? 37;
        const nonbasic = data.stats.landDistribution?.nonbasic ?? 15;
        setEdhrecLandSuggestion({ landCount: total, nonBasicLandCount: nonbasic });
      }

      let collectionNames: Set<string> | undefined;
      if (customization.collectionMode) {
        collectionNames = new Set(collectionCards.map((c) => c.name));
        if (collectionNames.size === 0) {
          setError(
            'Your collection is empty. Import cards on the Collection page before constraining the build to owned cards.'
          );
          setIsGenerating(false);
          setProgress(null);
          return;
        }
      }

      const deck = await generateDeck({
        commander,
        partnerCommander: null,
        colorIdentity,
        customization,
        selectedThemes: [],
        collectionNames,
        onProgress: (message, percent) => setProgress({ message, percent }),
      });

      updateCustomization({ tempBannedCards: [], tempMustIncludeCards: [] });

      // Persist the generated deck and navigate to its editor.
      const id = saveGeneratedDeck(deck, customization, decks, collectionCards, createDeck);
      navigate(`/decks/${id}`);
    } catch (e) {
      console.error('[DeckBuilder] generation failed:', e);
      setError(e instanceof Error ? e.message : 'Could not build the deck.');
    } finally {
      setIsGenerating(false);
      setProgress(null);
    }
  }, [
    commander,
    customization,
    colorIdentity,
    collectionCards,
    decks,
    createDeck,
    setEdhrecStats,
    setEdhrecLandSuggestion,
    updateCustomization,
    navigate,
  ]);

  return (
    <div className="deck-builder-page">
      <header className="deck-builder-header">
        <Link to="/decks" className="btn-link">
          ← All decks
        </Link>
        <h1>New deck</h1>
        <p className="deck-builder-subtitle">
          Pick a commander, then either generate a 100-card deck from EDHREC data or start blank and
          add cards by hand from your collection.
        </p>
      </header>

      <section className="deck-builder-section">
        <h2 className="deck-builder-section-title">Commander</h2>
        <CommanderSearch value={commander} onSelect={setCommander} />
      </section>

      {commander && (
        <section className="deck-builder-section">
          <h2 className="deck-builder-section-title">Build settings</h2>
          <div className="deck-builder-options">
            <label className="field-checkbox">
              <input
                type="checkbox"
                checked={customization.collectionMode}
                onChange={(e) => updateCustomization({ collectionMode: e.target.checked })}
              />
              <span>Limit to cards in my collection</span>
            </label>
            <label className="deck-builder-field">
              <span>Bracket</span>
              <select
                value={String(customization.bracketLevel)}
                onChange={(e) => {
                  const v = e.target.value;
                  updateCustomization({
                    bracketLevel: v === 'all' ? 'all' : (Number(v) as 1 | 2 | 3 | 4 | 5),
                  });
                }}
              >
                <option value="all">Any</option>
                <option value="1">1 — Exhibition</option>
                <option value="2">2 — Core</option>
                <option value="3">3 — Upgraded</option>
                <option value="4">4 — Optimized</option>
                <option value="5">5 — cEDH</option>
              </select>
            </label>
            <label className="deck-builder-field">
              <span>Lands</span>
              <span className="number-stepper">
                <button
                  type="button"
                  className="number-stepper-btn"
                  aria-label="Decrease lands"
                  onClick={() =>
                    updateCustomization({ landCount: Math.max(20, customization.landCount - 1) })
                  }
                  disabled={customization.landCount <= 20}
                >
                  −
                </button>
                <input
                  type="number"
                  min={20}
                  max={45}
                  value={customization.landCount}
                  onChange={(e) =>
                    updateCustomization({
                      landCount: Math.max(20, Math.min(45, Number(e.target.value) || 0)),
                    })
                  }
                />
                <button
                  type="button"
                  className="number-stepper-btn"
                  aria-label="Increase lands"
                  onClick={() =>
                    updateCustomization({ landCount: Math.min(45, customization.landCount + 1) })
                  }
                  disabled={customization.landCount >= 45}
                >
                  +
                </button>
              </span>
            </label>
          </div>
        </section>
      )}

      {commander && (
        <section className="deck-builder-section deck-builder-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? 'Building…' : 'Generate deck'}
          </button>
          <button type="button" className="btn" onClick={handleStartBlank} disabled={isGenerating}>
            Start blank
          </button>
          <p className="deck-builder-actions-hint">
            Generate uses EDHREC data to draft a full 100. Start blank gives you just the commander
            so you can pick every card by hand.
          </p>
          {progress && (
            <div className="deck-builder-progress" role="status" aria-live="polite">
              <div className="deck-builder-progress-bar">
                <div
                  className="deck-builder-progress-fill"
                  style={{ width: `${Math.max(2, progress.percent)}%` }}
                />
              </div>
              <div className="deck-builder-progress-msg">{progress.message}</div>
            </div>
          )}
          {error && <div className="error-banner deck-builder-error">{error}</div>}
        </section>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function saveGeneratedDeck(
  generated: GeneratedDeck,
  customization: ReturnType<typeof useDeckBuilderStore.getState>['customization'],
  existingDecks: ReturnType<typeof useDecksStore.getState>['decks'],
  collection: ReturnType<typeof useCollectionStore.getState>['cards'],
  createDeck: ReturnType<typeof useDecksStore.getState>['createDeck']
): string {
  // Build a running allocation map so we never claim the same physical
  // copy twice within a single deck (e.g. when the deck contains
  // duplicates of a non-basic — rare in EDH but possible).
  const claimed = new Map<string, AllocationInfo>(buildAllocationMap(existingDecks));

  const allocateFor = (cardName: string): string | null => {
    const pick = pickCollectionCopy(cardName, collection, claimed);
    if (!pick) return null;
    claimed.set(pick.scryfallId, {
      deckId: '__pending__',
      deckName: '__pending__',
      cardName,
    });
    return pick.scryfallId;
  };

  const commander = generated.commander;
  const partner = generated.partnerCommander;
  const commanderAlloc = commander ? allocateFor(commander.name) : null;
  const partnerAlloc = partner ? allocateFor(partner.name) : null;

  const cards = [];
  for (const cat of Object.keys(generated.categories) as DeckCategory[]) {
    for (const card of generated.categories[cat]) {
      cards.push(newDeckCard(card, allocateFor(card.name)));
    }
  }

  return createDeck({
    source: 'generated',
    commander,
    partnerCommander: partner,
    commanderAllocatedScryfallId: commanderAlloc,
    partnerCommanderAllocatedScryfallId: partnerAlloc,
    cards,
    generationContext: {
      selectedThemes: [],
      bracketLevel: customization.bracketLevel,
      landCount: customization.landCount,
      collectionMode: customization.collectionMode,
    },
    roleCounts: generated.roleCounts,
    rampSubtypeCounts: generated.rampSubtypeCounts,
    removalSubtypeCounts: generated.removalSubtypeCounts,
    boardwipeSubtypeCounts: generated.boardwipeSubtypeCounts,
    cardDrawSubtypeCounts: generated.cardDrawSubtypeCounts,
    bracketEstimation: generated.bracketEstimation,
    deckGrade: generated.deckGrade,
  });
}

// Suppress unused-import lint when ScryfallCard isn't directly named in JSX.
export type _Unused = ScryfallCard;
