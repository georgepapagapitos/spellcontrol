import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { ImportDeckDialog } from '../components/deck/ImportDeckDialog';
import { useDeckBuilderStore } from '@/deck-builder/store';
import { CommanderSearch } from '../components/deck/CommanderSearch';
import { ThemePicker } from '../components/deck/ThemePicker';
import { DeckCustomizer } from '../components/deck/DeckCustomizer';
import { generateDeck } from '@/deck-builder/services/deckBuilder/deckGenerator';
import { fetchCommanderData } from '@/deck-builder/services/edhrec/client';
import { useCollectionStore } from '../store/collection';
import { useDecksStore, newDeckCard } from '../store/decks';
import { buildAllocationMap, pickCollectionCopy, type AllocationInfo } from '../lib/allocations';
import type {
  ScryfallCard,
  GeneratedDeck,
  DeckCategory,
  EDHRECTheme,
  ThemeResult,
} from '@/deck-builder/types';

interface PrefillState {
  commander: ScryfallCard;
  themes: EDHRECTheme[];
  bracketLevel: number | 'all';
  landCount: number;
  collectionMode: boolean;
}

export function DeckNewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state as { prefill?: PrefillState } | null)?.prefill;
  const commander = useDeckBuilderStore((s) => s.commander);
  const setCommander = useDeckBuilderStore((s) => s.setCommander);
  const colorIdentity = useDeckBuilderStore((s) => s.colorIdentity);
  const customization = useDeckBuilderStore((s) => s.customization);
  const setEdhrecStats = useDeckBuilderStore((s) => s.setEdhrecStats);
  const setEdhrecLandSuggestion = useDeckBuilderStore((s) => s.setEdhrecLandSuggestion);
  const updateCustomization = useDeckBuilderStore((s) => s.updateCustomization);
  const resetDeckBuilder = useDeckBuilderStore((s) => s.reset);

  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const createDeck = useDecksStore((s) => s.createDeck);

  const [progress, setProgress] = useState<{ message: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedThemes, setSelectedThemes] = useState<EDHRECTheme[]>(() => prefill?.themes ?? []);
  const [showImport, setShowImport] = useState(false);

  // Reset the deck-builder store on mount so opening "New deck" after
  // creating a deck always starts at a blank commander search — the
  // store is in-memory and would otherwise retain the previous run's
  // commander, themes, and EDHREC data.
  useEffect(() => {
    resetDeckBuilder();
    if (prefill) {
      setCommander(prefill.commander);
      updateCustomization({
        bracketLevel: prefill.bracketLevel as 'all' | 1 | 2 | 3 | 4 | 5,
        landCount: prefill.landCount,
        collectionMode: prefill.collectionMode,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const selectedThemeSlugs = useMemo(
    () => new Set(selectedThemes.map((t) => t.slug)),
    [selectedThemes]
  );

  const handleToggleTheme = useCallback(
    (theme: EDHRECTheme) => {
      setSelectedThemes((prev) => {
        const exists = prev.some((t) => t.slug === theme.slug);
        return exists ? prev.filter((t) => t.slug !== theme.slug) : [...prev, theme];
      });
    },
    [setSelectedThemes]
  );

  // Pre-fetch EDHREC land suggestion when commander is picked so the
  // customizer can show the "✓ suggested" badge before generation.
  useEffect(() => {
    if (!commander) return;
    let cancelled = false;
    fetchCommanderData(commander.name)
      .then((data) => {
        if (cancelled || !data) return;
        const total = data.stats.landDistribution?.total ?? 37;
        const nonbasic = data.stats.landDistribution?.nonbasic ?? 15;
        setEdhrecLandSuggestion({ landCount: total, nonBasicLandCount: nonbasic });
        setEdhrecStats(data.stats);
        // Auto-apply suggestion if user hasn't manually changed lands yet.
        if (!useDeckBuilderStore.getState().userEditedLands) {
          updateCustomization({ landCount: total, nonBasicLandCount: nonbasic });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [commander, setEdhrecLandSuggestion, setEdhrecStats, updateCustomization]);

  // ── Start-blank ───────────────────────────────────────────────────────
  const handleStartBlank = useCallback(() => {
    if (!commander) return;
    const allocated = pickCollectionCopy(
      commander.name,
      collectionCards,
      buildAllocationMap(decks),
      commander.id
    );
    const id = createDeck({
      source: 'manual',
      commander,
      commanderAllocatedCopyId: allocated?.copyId ?? null,
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

      const themesForGenerator: ThemeResult[] = selectedThemes.map((t) => ({
        name: t.name,
        source: 'edhrec',
        slug: t.slug,
        deckCount: t.count,
        popularityPercent: t.popularityPercent,
        isSelected: true,
      }));

      const deck = await generateDeck({
        commander,
        partnerCommander: null,
        colorIdentity,
        customization,
        selectedThemes: themesForGenerator,
        collectionNames,
        onProgress: (message, percent) => setProgress({ message, percent }),
      });

      updateCustomization({ tempBannedCards: [], tempMustIncludeCards: [] });

      // Persist the generated deck and navigate to its editor.
      const id = saveGeneratedDeck(
        deck,
        customization,
        themesForGenerator,
        decks,
        collectionCards,
        createDeck
      );
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
    selectedThemes,
    collectionCards,
    decks,
    createDeck,
    setEdhrecStats,
    setEdhrecLandSuggestion,
    updateCustomization,
    navigate,
  ]);

  const handleSelectCommander = useCallback(
    (card: ScryfallCard | null) => {
      setCommander(card);
      setSelectedThemes([]);
    },
    [setCommander, setSelectedThemes]
  );

  return (
    <div className="deck-builder-page">
      <header className="deck-builder-header">
        <Link to="/decks" className="btn-link">
          ← All decks
        </Link>
        <h1>New deck</h1>
        <p className="deck-builder-subtitle">
          Pick a commander, then generate a 100-card deck from EDHREC data, start blank and add
          cards by hand, or
          <button type="button" className="btn-link" onClick={() => setShowImport(true)}>
            import an existing deck list.
          </button>
        </p>
      </header>

      {showImport && <ImportDeckDialog onClose={() => setShowImport(false)} />}

      <section className="deck-builder-section">
        <h2 className="deck-builder-section-title">Commander</h2>
        <CommanderSearch value={commander} onSelect={handleSelectCommander} />
      </section>

      {commander && (
        <ThemePicker
          commanderName={commander.name}
          selectedSlugs={selectedThemeSlugs}
          onToggle={handleToggleTheme}
        />
      )}

      {commander && <DeckCustomizer customization={customization} update={updateCustomization} />}

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
  selectedThemes: ThemeResult[],
  existingDecks: ReturnType<typeof useDecksStore.getState>['decks'],
  collection: ReturnType<typeof useCollectionStore.getState>['cards'],
  createDeck: ReturnType<typeof useDecksStore.getState>['createDeck']
): string {
  // Build a running allocation map so we never claim the same physical
  // copy twice within a single deck (e.g. when the deck contains
  // duplicates of a non-basic — rare in EDH but possible).
  const claimed = new Map<string, AllocationInfo>(buildAllocationMap(existingDecks));

  const allocateFor = (card: ScryfallCard): string | null => {
    const pick = pickCollectionCopy(card.name, collection, claimed);
    if (!pick) return null;
    claimed.set(pick.copyId, {
      deckId: '__pending__',
      deckName: '__pending__',
      cardName: card.name,
    });
    return pick.copyId;
  };

  const commander = generated.commander;
  const partner = generated.partnerCommander;
  const commanderAlloc = commander ? allocateFor(commander) : null;
  const partnerAlloc = partner ? allocateFor(partner) : null;

  const cards = [];
  for (const cat of Object.keys(generated.categories) as DeckCategory[]) {
    for (const card of generated.categories[cat]) {
      cards.push(newDeckCard(card, allocateFor(card)));
    }
  }

  return createDeck({
    source: 'generated',
    commander,
    partnerCommander: partner,
    commanderAllocatedCopyId: commanderAlloc,
    partnerCommanderAllocatedCopyId: partnerAlloc,
    cards,
    generationContext: {
      selectedThemes,
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
