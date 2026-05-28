import { logger } from '@/lib/logger';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ImportDeckDialog } from '../components/deck/ImportDeckDialog';
import { BackLink } from '../components/BackLink';
import { ProgressBar } from '../components/ProgressBar';
import { useDeckBuilderStore } from '@/deck-builder/store';
import { CommanderSearch } from '../components/deck/CommanderSearch';
import { CommanderProfileCard } from '../components/deck/CommanderProfileCard';
import { PartnerCommanderSelector } from '../components/deck/PartnerCommanderSelector';
import { ThemePicker } from '../components/deck/ThemePicker';
import { buildCommanderProfile } from '@/deck-builder/services/deckBuilder/commanderProfile';
import { DeckCustomizer } from '../components/deck/DeckCustomizer';
import { generateDeck } from '@/deck-builder/services/deckBuilder/deckGenerator';
import { fetchCommanderData } from '@/deck-builder/services/edhrec/client';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { buildAllocationMap, pickCollectionCopy } from '../lib/allocations';
import { saveGeneratedDeck } from '../lib/save-generated-deck';
import type { ScryfallCard, DeckFormat, EDHRECTheme, ThemeResult } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';

interface PrefillState {
  commander: ScryfallCard;
  themes: EDHRECTheme[];
  targetBracket: number | 'all';
  landCount: number;
  collectionMode: boolean;
}

export function DeckNewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state as { prefill?: PrefillState } | null)?.prefill;
  const commander = useDeckBuilderStore((s) => s.commander);
  const setCommander = useDeckBuilderStore((s) => s.setCommander);
  const partnerCommander = useDeckBuilderStore((s) => s.partnerCommander);
  const setPartnerCommander = useDeckBuilderStore((s) => s.setPartnerCommander);
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
  const progressRef = useRef<HTMLDivElement>(null);
  // Generation can fire from the bottom of a long form; on native the nav FAB
  // floats over the page bottom, so the bar can land behind it. Scroll it into
  // view the moment it appears (mirrors the test-hand sim-report behavior).
  const showProgress = progress !== null;
  useEffect(() => {
    if (!showProgress) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    progressRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, [showProgress]);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedThemes, setSelectedThemes] = useState<EDHRECTheme[]>(() => prefill?.themes ?? []);
  const [showImport, setShowImport] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<DeckFormat>('commander');
  const formatConfig = DECK_FORMAT_CONFIGS[selectedFormat];

  // Reset the deck-builder store on mount so opening "New deck" after
  // creating a deck always starts at a blank commander search — the
  // store is in-memory and would otherwise retain the previous run's
  // commander, themes, and EDHREC data.
  useEffect(() => {
    resetDeckBuilder();
    if (prefill) {
      setCommander(prefill.commander);
      updateCustomization({
        targetBracket: prefill.targetBracket as 'all' | 1 | 2 | 3 | 4 | 5,
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

  const commanderProfile = useMemo(
    () => (commander ? buildCommanderProfile(commander) : null),
    [commander]
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
        // Preselect the themes the commander's abilities point at, but
        // never clobber a selection the user (or a prefill) already made.
        const profile = buildCommanderProfile(commander);
        if (profile.suggestedThemes.length > 0 && data.themes.length > 0) {
          const byName = new Map(data.themes.map((t) => [t.name.toLowerCase().trim(), t]));
          const picks: EDHRECTheme[] = [];
          for (const name of profile.suggestedThemes) {
            const match = byName.get(name);
            if (match && !picks.some((p) => p.slug === match.slug)) picks.push(match);
            if (picks.length >= 3) break;
          }
          if (picks.length > 0) {
            setSelectedThemes((prev) => (prev.length > 0 ? prev : picks));
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [commander, setEdhrecLandSuggestion, setEdhrecStats, updateCustomization, setSelectedThemes]);

  // ── Start-blank ───────────────────────────────────────────────────────
  const handleStartBlank = useCallback(() => {
    if (formatConfig.hasCommander && !commander) return;
    const allocationMap = buildAllocationMap(decks);
    let commanderAlloc: string | null = null;
    if (commander) {
      const allocated = pickCollectionCopy(
        commander.name,
        collectionCards,
        allocationMap,
        commander.id
      );
      commanderAlloc = allocated?.copyId ?? null;
    }
    let partnerAlloc: string | null = null;
    if (partnerCommander) {
      const allocated = pickCollectionCopy(
        partnerCommander.name,
        collectionCards,
        allocationMap,
        partnerCommander.id
      );
      partnerAlloc = allocated?.copyId ?? null;
    }
    const id = createDeck({
      format: selectedFormat,
      source: 'manual',
      commander: commander ?? null,
      commanderAllocatedCopyId: commanderAlloc,
      partnerCommander: partnerCommander ?? null,
      partnerCommanderAllocatedCopyId: partnerAlloc,
    });
    navigate(`/decks/${id}`);
  }, [
    commander,
    partnerCommander,
    collectionCards,
    decks,
    createDeck,
    navigate,
    selectedFormat,
    formatConfig,
  ]);

  // ── Generate ──────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!commander) return;
    setError(null);
    setIsGenerating(true);
    setProgress({ message: 'Consulting the Oracle…', percent: 5 });
    try {
      const bracket =
        customization.targetBracket !== 'all' ? customization.targetBracket : undefined;
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
        partnerCommander,
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
      logger.error('[DeckBuilder] generation failed:', e);
      setError(e instanceof Error ? e.message : 'Could not build the deck.');
    } finally {
      setIsGenerating(false);
      setProgress(null);
    }
  }, [
    commander,
    partnerCommander,
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
      <BackLink to="/decks" label="All decks" />
      <header className="deck-builder-header">
        <h1>New deck</h1>
        <p className="deck-builder-subtitle">
          {formatConfig.hasCommander ? (
            <>
              Pick a commander, then generate a deck from EDHREC data, start blank and add cards by
              hand, or{' '}
            </>
          ) : (
            <>Create a {formatConfig.label} deck and add cards manually, or </>
          )}
          <button type="button" className="btn-link" onClick={() => setShowImport(true)}>
            import an existing deck list.
          </button>
        </p>
      </header>

      {showImport && (
        <ImportDeckDialog onClose={() => setShowImport(false)} format={selectedFormat} />
      )}

      <section className="deck-builder-section">
        <h2 className="deck-builder-section-title">Format</h2>
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
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
        <p className="format-pill-hint">{formatConfig.description}</p>
      </section>

      {formatConfig.hasCommander && (
        <section className="deck-builder-section guided-cta">
          <div className="guided-cta-text">
            <strong>Not sure where to start?</strong>
            <span>
              Build together — a guided, step-by-step Commander build that explains each decision as
              you go.
            </span>
          </div>
          <button type="button" className="btn" onClick={() => navigate('/decks/new/guided')}>
            Build together →
          </button>
        </section>
      )}

      {formatConfig.hasCommander && (
        <section className="deck-builder-section">
          <h2 className="deck-builder-section-title">Commander</h2>
          <CommanderSearch value={commander} onSelect={handleSelectCommander} />
        </section>
      )}

      {formatConfig.hasCommander && commander && commanderProfile && (
        <CommanderProfileCard profile={commanderProfile} />
      )}

      {/* Customizer sits ahead of the partner picker so collection-mode is
          decided before partner selection — the picker filters its
          suggestions (and warns) based on what's owned. */}
      {formatConfig.hasCommander && commander && (
        <DeckCustomizer customization={customization} update={updateCustomization} />
      )}

      {formatConfig.hasCommander && commander && (
        <PartnerCommanderSelector
          key={commander.id}
          commander={commander}
          partner={partnerCommander}
          onSelect={setPartnerCommander}
          collectionMode={customization.collectionMode}
        />
      )}

      {formatConfig.hasCommander && commander && (
        <ThemePicker
          commanderName={commander.name}
          selectedSlugs={selectedThemeSlugs}
          onToggle={handleToggleTheme}
        />
      )}

      {formatConfig.hasCommander ? (
        commander && (
          <section className="deck-builder-section deck-builder-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? 'Building…' : 'Generate deck'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleStartBlank}
              disabled={isGenerating}
            >
              Start blank
            </button>
            <p className="deck-builder-actions-hint">
              Generate uses EDHREC data to draft a full 100. Start blank gives you just the
              commander so you can pick every card by hand.
            </p>
            {progress && (
              <div ref={progressRef} className="deck-builder-progress">
                <ProgressBar percent={progress.percent} message={progress.message} />
              </div>
            )}
            {error && <div className="error-banner deck-builder-error">{error}</div>}
          </section>
        )
      ) : (
        <section className="deck-builder-section deck-builder-actions">
          <button type="button" className="btn btn-primary" onClick={handleStartBlank}>
            Create deck
          </button>
          <p className="deck-builder-actions-hint">
            Create an empty {formatConfig.label} deck ({formatConfig.mainboardSize}-card mainboard
            {formatConfig.sideboardSize > 0
              ? ` with ${formatConfig.sideboardSize}-card sideboard`
              : ''}
            ). Add cards manually in the editor.
          </p>
        </section>
      )}
    </div>
  );
}
