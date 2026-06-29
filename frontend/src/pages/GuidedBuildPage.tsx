import { useEffect, useState } from 'react';
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
import type { DeckCategory } from '@/deck-builder/types';

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
  const resetDeckBuilder = useDeckBuilderStore((s) => s.reset);

  const {
    commander,
    partnerCommander,
    setPartnerCommander,
    colorIdentity,
    customization,
    updateCustomization,
    commanderProfile,
    selectedThemes,
    selectedThemeSlugs,
    toggleTheme,
    selectCommander,
    build,
    isBuilding,
    progress,
    error,
    progressRef,
  } = useDeckGeneration({ haptic: true });

  const [step, setStep] = useState(0);

  useEffect(() => {
    resetDeckBuilder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Art Theme can't build without a motif chosen, so block leaving its config step.
  const artNeedsMotif =
    customization.generationMode === 'art-theme' && !customization.artThemeTag.trim();
  const canAdvance = step === 0 ? !!commander : step === 1 ? !artNeedsMotif : true;

  const isLastStep = step === STEPS.length - 1;
  const current = STEPS[step];

  // Step 1 means "themes" for EDHREC but "tune your approach" for the other modes.
  const stepBlurb =
    step === 1 && customization.generationMode !== 'edhrec'
      ? 'Tune the approach you picked — choose a motif, an era, or leave the defaults. No EDHREC themes needed here.'
      : current.blurb;

  // Commander art for the takeover panel.
  const commanderArtUrl =
    commander?.image_uris?.art_crop ?? commander?.card_faces?.[0]?.image_uris?.art_crop;

  // The takeover replaces the page body while generation runs. On a successful
  // build the page navigates away (the route change masks the unmount); on an
  // error/early-out it just flips false — which used to teleport-vanish the
  // takeover back to the form. Hold it mounted through a fade-out instead.
  const showTakeover = isBuilding && !!progress;

  // Derive the exit from the showTakeover transition during render (React's
  // endorsed "adjust state on prop change" pattern — no effect, no ref): when
  // it flips off we start exiting; a fresh build flips it back on and cancels
  // any in-flight exit. `onExited` (the fade's animationend) finally unmounts.
  const [takeoverExiting, setTakeoverExiting] = useState(false);
  const [prevShowTakeover, setPrevShowTakeover] = useState(showTakeover);
  if (showTakeover !== prevShowTakeover) {
    setPrevShowTakeover(showTakeover);
    setTakeoverExiting(!showTakeover);
  }

  // Remember the last progress frame so the exit fade keeps rendering the final
  // state after the hook clears `progress` to null.
  const [lastFrame, setLastFrame] = useState(progress);
  if (progress && progress !== lastFrame) setLastFrame(progress);

  if ((showTakeover || takeoverExiting) && lastFrame) {
    return (
      <div className="deck-builder-page" data-testid="guided-build-page">
        <BackLink to="/decks/new" label="New deck" />
        <div ref={progressRef} className="guided-takeover-wrap">
          <GenerationTakeover
            commanderName={commander?.name}
            commanderImageUrl={commanderArtUrl}
            message={lastFrame.message}
            percent={lastFrame.percent}
            isExiting={takeoverExiting}
            onExited={() => setTakeoverExiting(false)}
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
        <p className="guided-blurb">{stepBlurb}</p>
      </section>

      {step === 0 && (
        <>
          <section className="deck-builder-section">
            <h2 className="deck-builder-section-title">Commander</h2>
            <CommanderSearch value={commander} onSelect={selectCommander} />
          </section>
          {commander && commanderProfile && (
            <CommanderProfileCard profile={commanderProfile} themesLocation="next-step" />
          )}
          {commander && (
            <GenerationModePicker
              section="cards"
              customization={customization}
              update={updateCustomization}
              colorIdentity={colorIdentity}
              commanderName={commander.name}
            />
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

      {step === 1 &&
        commander &&
        (customization.generationMode === 'edhrec' ? (
          <ThemePicker
            commanderName={commander.name}
            selectedSlugs={selectedThemeSlugs}
            onToggle={toggleTheme}
          />
        ) : (
          <section className="deck-builder-section">
            <GenerationModePicker
              section="config"
              customization={customization}
              update={updateCustomization}
              colorIdentity={colorIdentity}
              commanderName={commander.name}
            />
          </section>
        ))}

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

            {/* Approach — themes for EDHREC, the chosen Scryfall mode otherwise */}
            <div className="guided-review-row">
              <span className="guided-review-label">
                {customization.generationMode === 'edhrec' ? 'Themes' : 'Approach'}
              </span>
              <span className="guided-review-value">
                {customization.generationMode === 'art-theme'
                  ? `Art theme — ${customization.artThemeTag.trim() || 'choose a motif'}`
                  : customization.generationMode === 'historical'
                    ? `Historical — through ${customization.historicalYear}`
                    : customization.generationMode === 'oracle-role'
                      ? `By function${customization.permanentsOnly ? ' — permanents only' : ''}`
                      : selectedThemes.length > 0
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
                    : customization.collectionStrategy === 'prefer'
                      ? 'Owned-first (best deck)'
                      : customization.collectionStrategy === 'available'
                        ? 'Available only'
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
              onClick={build}
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
