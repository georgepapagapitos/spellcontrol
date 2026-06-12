import { logger } from '@/lib/logger';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BackLink } from '../components/BackLink';
import { useDeckBuilderStore } from '@/deck-builder/store';
import { CommanderSearch } from '../components/deck/CommanderSearch';
import { PlaystylePicker } from '../components/deck/PlaystylePicker';
import { CommanderProfileCard } from '../components/deck/CommanderProfileCard';
import { PartnerCommanderSelector } from '../components/deck/PartnerCommanderSelector';
import { ThemePicker } from '../components/deck/ThemePicker';
import { DeckCustomizer } from '../components/deck/DeckCustomizer';
import { GenerationTakeover } from '../components/deck/GenerationTakeover';
import { buildCommanderProfile } from '@/deck-builder/services/deckBuilder/commanderProfile';
import { generateDeck } from '@/deck-builder/services/deckBuilder/deckGenerator';
import { fetchCommanderData } from '@/deck-builder/services/edhrec/client';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { saveGeneratedDeck } from '../lib/save-generated-deck';
import type { ScryfallCard, EDHRECTheme, ThemeResult, DeckCategory } from '@/deck-builder/types';

interface Step {
  title: string;
  blurb: string;
}

// Mirrors the seven-step deck-building philosophy, collapsed into the
// decisions the engine actually needs from the player. The generator
// handles card advantage, ramp, interaction, lands and cuts internally
// once these inputs are locked in.
const STEPS: Step[] = [
  {
    title: 'Pick your commander',
    blurb:
      'Your commander is the most impactful choice — every other card has to live in its color identity and ideally feed its abilities. Pick the one that looks the most fun.',
  },
  {
    title: 'Lock in the game plan',
    blurb:
      "These are the themes your commander's abilities point at. The build leans the card pool toward them, then fills in card advantage, ramp and interaction around that core.",
  },
  {
    title: 'Tune power & budget',
    blurb:
      'Set the power level, budget and whether to build from cards you own. Higher brackets pull in faster mana, tutors and combos.',
  },
  {
    title: 'Build the deck',
    blurb:
      'Review the plan, then build a full 100. You can swap, cut and test-hand everything in the editor afterward.',
  },
];

/** Human-readable label per DeckCategory for the structured Review step. */
const CATEGORY_LABELS: Partial<Record<DeckCategory, string>> = {
  lands: 'Lands',
  ramp: 'Ramp',
  cardDraw: 'Card draw',
  singleRemoval: 'Removal',
  boardWipes: 'Board wipes',
  creatures: 'Creatures',
  synergy: 'Synergy',
  utility: 'Utility',
};

export function GuidedBuildPage() {
  const navigate = useNavigate();

  const commander = useDeckBuilderStore((s) => s.commander);
  const setCommander = useDeckBuilderStore((s) => s.setCommander);
  const partnerCommander = useDeckBuilderStore((s) => s.partnerCommander);
  const setPartnerCommander = useDeckBuilderStore((s) => s.setPartnerCommander);
  const colorIdentity = useDeckBuilderStore((s) => s.colorIdentity);
  const customization = useDeckBuilderStore((s) => s.customization);
  const updateCustomization = useDeckBuilderStore((s) => s.updateCustomization);
  const setEdhrecStats = useDeckBuilderStore((s) => s.setEdhrecStats);
  const setEdhrecLandSuggestion = useDeckBuilderStore((s) => s.setEdhrecLandSuggestion);
  const resetDeckBuilder = useDeckBuilderStore((s) => s.reset);

  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const createDeck = useDecksStore((s) => s.createDeck);

  const [step, setStep] = useState(0);
  const [pickMode, setPickMode] = useState<'commander' | 'playstyle'>('commander');
  const [selectedThemes, setSelectedThemes] = useState<EDHRECTheme[]>([]);
  const [progress, setProgress] = useState<{ message: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // Scroll the takeover into view when generation begins.
  const showProgress = progress !== null;
  useEffect(() => {
    if (!showProgress) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    progressRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, [showProgress]);

  const [isBuilding, setIsBuilding] = useState(false);

  useEffect(() => {
    resetDeckBuilder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commanderProfile = useMemo(
    () => (commander ? buildCommanderProfile(commander) : null),
    [commander]
  );

  const selectedThemeSlugs = useMemo(
    () => new Set(selectedThemes.map((t) => t.slug)),
    [selectedThemes]
  );

  const handleToggleTheme = useCallback((theme: EDHRECTheme) => {
    setSelectedThemes((prev) => {
      const exists = prev.some((t) => t.slug === theme.slug);
      return exists ? prev.filter((t) => t.slug !== theme.slug) : [...prev, theme];
    });
  }, []);

  // Prefetch EDHREC stats + preselect the commander's suggested themes.
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
        if (!useDeckBuilderStore.getState().userEditedLands) {
          updateCustomization({ landCount: total, nonBasicLandCount: nonbasic });
        }
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

  const handleSelectCommander = useCallback(
    (card: ScryfallCard | null) => {
      setCommander(card);
      setSelectedThemes([]);
    },
    [setCommander]
  );

  const handleBuild = useCallback(async () => {
    if (!commander) return;
    setError(null);
    setIsBuilding(true);
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
          setIsBuilding(false);
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

      const id = saveGeneratedDeck(
        deck,
        customization,
        themesForGenerator,
        decks,
        collectionCards,
        createDeck
      );
      // justGenerated gates the one-shot Build Report sheet — without it,
      // every pre-existing generated deck would pop the sheet once on its
      // next open (the seen-set only guards against repeats).
      navigate(`/decks/${id}`, { state: { justGenerated: true } });
    } catch (e) {
      logger.error('[GuidedBuild] build failed:', e);
      setError(e instanceof Error ? e.message : 'Could not build the deck.');
    } finally {
      setIsBuilding(false);
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

  const canAdvance = step === 0 ? !!commander : true;
  const isLastStep = step === STEPS.length - 1;
  const current = STEPS[step];

  // Commander art for the takeover panel.
  const commanderArtUrl =
    commander?.image_uris?.art_crop ?? commander?.card_faces?.[0]?.image_uris?.art_crop;

  // If generation is running, replace the whole page body with the takeover.
  if (isBuilding && progress) {
    return (
      <div className="deck-builder-page" data-testid="guided-build-page">
        <BackLink to="/decks/new" label="New deck" />
        <div ref={progressRef} className="guided-takeover-wrap">
          <GenerationTakeover
            commanderName={commander?.name}
            commanderImageUrl={commanderArtUrl}
            message={progress.message}
            percent={progress.percent}
          />
        </div>
        {error && <div className="error-banner deck-builder-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="deck-builder-page" data-testid="guided-build-page">
      <BackLink to="/decks/new" label="New deck" />
      <header className="deck-builder-header">
        <h1>Build together</h1>
        <p className="deck-builder-subtitle">
          A guided, step-by-step Commander build. We explain each decision as we go.
        </p>
      </header>

      <ol className="guided-stepper" aria-label="Build steps">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className={`guided-step${i === step ? ' is-active' : ''}${i < step ? ' is-done' : ''}`}
            aria-current={i === step ? 'step' : undefined}
          >
            <span className="guided-step-num">{i < step ? '✓' : i + 1}</span>
            <span className="guided-step-label">{s.title}</span>
          </li>
        ))}
      </ol>

      <section className="deck-builder-section">
        <h2 className="deck-builder-section-title">
          Step {step + 1}. {current.title}
        </h2>
        <p className="guided-blurb">{current.blurb}</p>
      </section>

      {step === 0 && (
        <>
          <section className="deck-builder-section">
            <h2 className="deck-builder-section-title">Commander</h2>
            {!commander && (
              <div
                className="pick-mode-toggle"
                role="radiogroup"
                aria-label="How to find your commander"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={pickMode === 'commander'}
                  className={`pick-mode-btn${pickMode === 'commander' ? ' is-active' : ''}`}
                  onClick={() => setPickMode('commander')}
                >
                  By commander
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={pickMode === 'playstyle'}
                  className={`pick-mode-btn${pickMode === 'playstyle' ? ' is-active' : ''}`}
                  onClick={() => setPickMode('playstyle')}
                >
                  By play style
                </button>
              </div>
            )}
            {commander || pickMode === 'commander' ? (
              <CommanderSearch value={commander} onSelect={handleSelectCommander} />
            ) : (
              <PlaystylePicker onSelectCommander={handleSelectCommander} />
            )}
          </section>
          {commander && commanderProfile && (
            <CommanderProfileCard profile={commanderProfile} themesLocation="next-step" />
          )}
          {commander && (
            <PartnerCommanderSelector
              key={commander.id}
              commander={commander}
              partner={partnerCommander}
              onSelect={setPartnerCommander}
              collectionMode={customization.collectionMode}
            />
          )}
        </>
      )}

      {step === 1 && commander && (
        <ThemePicker
          commanderName={commander.name}
          selectedSlugs={selectedThemeSlugs}
          onToggle={handleToggleTheme}
        />
      )}

      {step === 2 && <DeckCustomizer customization={customization} update={updateCustomization} />}

      {step === 3 && commander && (
        <section className="deck-builder-section">
          <h2 className="deck-builder-section-title">Review</h2>
          {/* Structured summary — counts by section, key configuration picks. */}
          <div className="guided-review-card">
            {/* Commander(s) */}
            <div className="guided-review-row">
              <span className="guided-review-label">
                {partnerCommander ? 'Commanders' : 'Commander'}
              </span>
              <span className="guided-review-value">
                {commander.name}
                {partnerCommander ? ` + ${partnerCommander.name}` : ''}
              </span>
            </div>

            {/* Themes */}
            <div className="guided-review-row">
              <span className="guided-review-label">Themes</span>
              <span className="guided-review-value">
                {selectedThemes.length > 0
                  ? selectedThemes.map((t) => t.name).join(', ')
                  : 'Commander core'}
              </span>
            </div>

            {/* Target bracket */}
            <div className="guided-review-row">
              <span className="guided-review-label">Bracket</span>
              <span className="guided-review-value">
                {customization.targetBracket === 'all'
                  ? 'Any power level'
                  : `Bracket ${customization.targetBracket}`}
              </span>
            </div>

            {/* Land count */}
            <div className="guided-review-row">
              <span className="guided-review-label">Lands</span>
              <span className="guided-review-value">{customization.landCount}</span>
            </div>

            {/* Collection mode */}
            <div className="guided-review-row">
              <span className="guided-review-label">Card pool</span>
              <span className="guided-review-value">
                {!customization.collectionMode
                  ? 'Any cards'
                  : customization.collectionStrategy === 'partial'
                    ? `Prioritize owned (~${customization.collectionOwnedPercent}%)`
                    : 'Only owned cards'}
              </span>
            </div>
          </div>

          {/* Target composition chips — what the generator will aim for */}
          <div className="guided-review-targets">
            <p className="guided-review-targets-label">Target composition</p>
            <ul className="guided-review-cats">
              {(Object.keys(CATEGORY_LABELS) as DeckCategory[]).map((cat) => (
                <li key={cat} className="guided-review-cat-chip">
                  <span className="guided-review-cat-name">{CATEGORY_LABELS[cat]}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="deck-builder-section deck-builder-actions">
        <div className="guided-nav">
          <button
            type="button"
            className="btn"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || isBuilding}
          >
            Back
          </button>
          {isLastStep ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleBuild}
              disabled={isBuilding || !commander}
            >
              Build my deck
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              disabled={!canAdvance}
            >
              Next
            </button>
          )}
        </div>
        {error && <div className="error-banner deck-builder-error">{error}</div>}
      </section>
    </div>
  );
}
