import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ImportDeckDialog } from '../components/deck/ImportDeckDialog';
import { BackLink } from '../components/BackLink';
import { useDeckBuilderStore } from '@/deck-builder/store';
import { CommanderSearch } from '../components/deck/CommanderSearch';
import { CommanderProfileCard } from '../components/deck/CommanderProfileCard';
import { PartnerCommanderSelector } from '../components/deck/PartnerCommanderSelector';
import { ThemePicker } from '../components/deck/ThemePicker';
import { DeckCustomizer } from '../components/deck/DeckCustomizer';
import { GenerationModePicker } from '../components/deck/GenerationModePicker';
import { GenerationTakeover } from '../components/deck/GenerationTakeover';
import { useDeckGeneration } from '../lib/use-deck-generation';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { buildAllocationMap, pickCollectionCopy } from '../lib/allocations';
import type { ScryfallCard, DeckFormat, EDHRECTheme } from '@/deck-builder/types';
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

  const setCommander = useDeckBuilderStore((s) => s.setCommander);
  const updateCustomizationStore = useDeckBuilderStore((s) => s.updateCustomization);
  const resetDeckBuilder = useDeckBuilderStore((s) => s.reset);

  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const createDeck = useDecksStore((s) => s.createDeck);

  const [takeoverExiting, setTakeoverExiting] = useState(false);
  const takeoverExitResolveRef = useRef<(() => void) | null>(null);
  const waitForTakeoverExit = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
        if (reduce) {
          resolve();
          return;
        }
        takeoverExitResolveRef.current = resolve;
        setTakeoverExiting(true);
      }),
    []
  );
  const handleTakeoverExitComplete = useCallback(() => {
    takeoverExitResolveRef.current?.();
    takeoverExitResolveRef.current = null;
  }, []);

  const {
    commander,
    partnerCommander,
    setPartnerCommander,
    colorIdentity,
    customization,
    updateCustomization,
    commanderProfile,
    selectedThemeSlugs,
    toggleTheme,
    selectCommander,
    build,
    isBuilding,
    progress,
    error,
    progressRef,
  } = useDeckGeneration({ initialThemes: prefill?.themes, beforeNavigate: waitForTakeoverExit });

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
      updateCustomizationStore({
        targetBracket: prefill.targetBracket as 'all' | 1 | 2 | 3 | 4 | 5,
        landCount: prefill.landCount,
        collectionMode: prefill.collectionMode,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Per-mode CTA copy + readiness. Art Theme can't build without a motif chosen.
  const genMode = customization.generationMode;
  const modeReady = genMode !== 'art-theme' || customization.artThemeTag.trim().length > 0;
  const generateLabel =
    genMode === 'art-theme'
      ? 'Build by art'
      : genMode === 'historical'
        ? `Build from ${customization.historicalYear}`
        : genMode === 'oracle-role'
          ? 'Build by function'
          : 'Generate deck';
  const generateHint =
    genMode === 'art-theme'
      ? 'Builds a full 100 where every card depicts your motif.'
      : genMode === 'historical'
        ? `Builds a full 100 from cards printed through ${customization.historicalYear}.`
        : genMode === 'oracle-role'
          ? 'Builds a full 100 chosen by card function, not crowd data.'
          : 'Generate uses EDHREC data to draft a full 100.';

  // Commander art for the takeover panel.
  const commanderArtUrl =
    commander?.image_uris?.art_crop ?? commander?.card_faces?.[0]?.image_uris?.art_crop;

  // While generating, replace the page body with the shared takeover so the
  // build feels deliberate — identical to the guided "Build together" flow.
  if (isBuilding && progress) {
    return (
      <div className="deck-builder-page">
        <BackLink to="/decks" label="All decks" />
        <div ref={progressRef} className="guided-takeover-wrap">
          <GenerationTakeover
            commanderName={commander?.name}
            commanderImageUrl={commanderArtUrl}
            message={progress.message}
            percent={progress.percent}
            isExiting={takeoverExiting}
            onExitComplete={handleTakeoverExitComplete}
          />
        </div>
        {error && <div className="error-banner deck-builder-error">{error}</div>}
      </div>
    );
  }

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
          <CommanderSearch value={commander} onSelect={selectCommander} />
        </section>
      )}

      {formatConfig.hasCommander && commander && commanderProfile && (
        <CommanderProfileCard profile={commanderProfile} />
      )}

      {formatConfig.hasCommander && commander && (
        <GenerationModePicker
          customization={customization}
          update={updateCustomization}
          colorIdentity={colorIdentity}
          commanderName={commander.name}
        />
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

      {/* Themes only steer the EDHREC generator — the Scryfall-driven modes
          define their own pool, so the theme picker is irrelevant there. */}
      {formatConfig.hasCommander && commander && customization.generationMode === 'edhrec' && (
        <ThemePicker
          commanderName={commander.name}
          selectedSlugs={selectedThemeSlugs}
          onToggle={toggleTheme}
        />
      )}

      {formatConfig.hasCommander ? (
        commander && (
          <section className="deck-builder-section deck-builder-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={build}
              disabled={isBuilding || !modeReady}
            >
              {isBuilding ? 'Building…' : generateLabel}
            </button>
            <button type="button" className="btn" onClick={handleStartBlank} disabled={isBuilding}>
              Start blank
            </button>
            <p className="deck-builder-actions-hint">
              {generateHint} Start blank gives you just the commander so you can pick every card by
              hand.
            </p>
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
