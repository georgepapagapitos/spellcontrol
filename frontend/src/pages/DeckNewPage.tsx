import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Zap } from 'lucide-react';
// New-deck-only stylesheets ship with this chunk, not the boot payload (E265).
import '@/styles/deck-builder-customizer.css';
import '@/styles/deck-builder-import-dialog.css';
import '@/styles/deck-builder-commander-profile.css';
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
import { ChosenColorPicker, colorChooserOf } from '../components/deck/ChosenColorPicker';
import { choosesColorBeforeGame, chosenColorOf } from '@/deck-builder/lib/partnerUtils';
import { useDeckGeneration } from '../lib/use-deck-generation';
import { useGenerationTakeoverExit } from '../lib/use-generation-takeover-exit';
import { imageFromCard } from '@/lib/card-thumbs';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { buildAllocationMap, pickCollectionCopy } from '../lib/allocations';
import { usePublishOnCreate, type PublishOutcome } from '../lib/use-publish-on-create';
import { VisibilityChoice } from '../components/VisibilityChoice';
import type { ScryfallCard, DeckFormat, EDHRECTheme, Customization } from '@/deck-builder/types';
import type { ComboSeedContext } from '../types/combos';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { Button } from '@/components/shared/Button';

/**
 * Router-state seed for a build. Two shapes share it:
 *
 *  - **Regenerate** (DecksIndexPage) replays a saved
 *    deck's settings, so it supplies the full set.
 *  - **Combo seed** (the collection combos view) knows only a commander and
 *    the cards that must survive, and wants this page's own defaults for
 *    everything else — hence the regenerate-only fields are optional. An
 *    absent field means "leave it alone", never "reset it".
 */
interface PrefillState {
  commander: ScryfallCard;
  themes?: EDHRECTheme[];
  targetBracket?: number | 'all';
  landCount?: number;
  collectionMode?: boolean;
  /** Card names the build must keep — the pieces of a combo being built
   *  around. Commander-scoped build intent; never persisted. */
  mustIncludeCards?: string[];
  /** Set alongside `mustIncludeCards` when this build was seeded from a
   *  combo — names the combo so this page and the post-build summary can
   *  disclose it. Absent for a plain must-include (e.g. a future non-combo
   *  caller) and for every other prefill shape. Never persisted. */
  comboContext?: ComboSeedContext;
  /** The deck this regenerate ran from — lands the completed build on the compare diff instead of the editor. */
  sourceDeckId?: string;
  /** Format of the source deck — a PDH regenerate must stay PDH. */
  format?: DeckFormat;
  /** The source deck's partner — a partner deck must regenerate with both. */
  partnerCommander?: ScryfallCard | null;
  /** The source deck's full build settings (absent on older decks, which
   *  fall back to the three fields above). */
  customization?: Partial<Customization>;
}

export function DeckNewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const routerState = location.state as {
    prefill?: PrefillState;
    /** The Decks index's "From my binder" door: open the picker on that tab. */
    commanderSource?: 'binder';
  } | null;
  const prefill = routerState?.prefill;
  const commanderSource = routerState?.commanderSource;

  const setCommander = useDeckBuilderStore((s) => s.setCommander);
  const updateCustomizationStore = useDeckBuilderStore((s) => s.updateCustomization);
  const resetDeckBuilder = useDeckBuilderStore((s) => s.reset);
  const setChosenColor = useDeckBuilderStore((s) => s.setChosenColor);
  const setPartnerCommanderStore = useDeckBuilderStore((s) => s.setPartnerCommander);
  const setUserEditedLands = useDeckBuilderStore((s) => s.setUserEditedLands);

  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const createDeck = useDecksStore((s) => s.createDeck);

  const {
    isExiting: takeoverExiting,
    waitForExit: waitForTakeoverExit,
    finishExit: handleTakeoverExitComplete,
  } = useGenerationTakeoverExit();

  // ── Visibility (creation-time choice) ──────────────────────────────────
  // Declared ahead of useDeckGeneration because the generate hand-off below
  // (`onCreated`) needs `visibility`/`publishAfterCreate` — a generated deck
  // has to obey the same fieldset as "Start blank" (before this, Public was
  // silently dropped on the generate path).
  //
  // The fieldset/network/display-name-substep logic itself is shared with
  // ImportDeckDialog's single-deck path (E150) — see usePublishOnCreate's
  // own doc comment for why it hands off rather than firing the seal here:
  // this page navigates away the instant a publish resolves.
  // Where a publish-on-create should land once it settles. Null for "Start
  // blank" — the new deck's own editor is the only destination there. Set by
  // the generate hand-off below, which alone knows about the compare-diff
  // landing and the justGenerated build-report flag. A ref, not state: it's
  // written and read within a single async hand-off, and re-rendering the
  // whole form on it would be pure noise.
  const pendingDestination = useRef<{ path: string; state?: Record<string, unknown> } | null>(null);

  const onPublishSettled = useCallback(
    (id: string, outcome?: PublishOutcome) => {
      const pending = pendingDestination.current;
      pendingDestination.current = null;
      // Both flags can be live at once (generated AND first publish) — the
      // editor reads them independently, so merge rather than let one win.
      const state = {
        ...(pending?.state ?? {}),
        ...(outcome ? { justPublished: outcome.isFirstPublish } : {}),
      };
      navigate(
        pending?.path ?? `/decks/${id}`,
        Object.keys(state).length > 0 ? { state } : undefined
      );
    },
    [navigate]
  );
  const {
    canPublish,
    publicDisabledReason,
    visibility,
    setVisibility,
    publishing,
    publishAfterCreate,
    shareWithFriendsAfterCreate,
  } = usePublishOnCreate(onPublishSettled);

  /**
   * Apply the Private/Public fieldset to a freshly *generated* deck. Returns
   * true when it takes over navigation, so useDeckGeneration leaves routing
   * alone — including the display_name_required case, where publishAfterCreate
   * shows its inline substep and this page stays put until that resolves (the
   * substep's own Cancel still lands on `pendingDestination`).
   */
  const publishGeneratedDeck = useCallback(
    async (id: string, destination: string, navState?: Record<string, unknown>) => {
      if (visibility === 'private' || !canPublish) return false;
      pendingDestination.current = { path: destination, state: navState };
      if (visibility === 'friends') {
        await shareWithFriendsAfterCreate(id);
      } else {
        await publishAfterCreate(id);
      }
      return true;
    },
    [visibility, canPublish, publishAfterCreate, shareWithFriendsAfterCreate]
  );

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
  } = useDeckGeneration({
    initialThemes: prefill?.themes,
    sourceDeckId: prefill?.sourceDeckId,
    beforeNavigate: waitForTakeoverExit,
    onCreated: publishGeneratedDeck,
    comboContext: prefill?.comboContext,
    initialVisibility: visibility,
  });

  // The Prismatic Piper, Clara Oswald, Faceless One: no colors until one is
  // chosen, so both build buttons wait for it.
  const colorChooser = colorChooserOf(commander, partnerCommander);
  const colorReady = !colorChooser || chosenColorOf(colorChooser) !== null;

  const [showImport, setShowImport] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<DeckFormat>(prefill?.format ?? 'commander');
  // Below 600px the format grid claims most of the first screen before the
  // page's own first instruction (pick a commander); collapse it to the
  // active pill + a disclosure so Commander search fits in the first screen.
  const [formatExpanded, setFormatExpanded] = useState(false);
  // Radios group by shared `name` — scope each group to this page instance.
  const formatGroup = useId();
  const formatConfig = DECK_FORMAT_CONFIGS[selectedFormat];
  const isPdh = selectedFormat === 'paupercommander';

  // Keep the store's build-format in lockstep with the pill so generation and
  // the saved deck both know the format. Only PDH generates as its own format
  // today — every other commander-family pill builds the standard 100.
  const applyFormat = useCallback(
    (fmt: DeckFormat) => {
      setSelectedFormat(fmt);
      setFormatExpanded(false);
      updateCustomizationStore({
        mtgFormat: fmt === 'paupercommander' ? 'paupercommander' : 'commander',
      });
    },
    [updateCustomizationStore]
  );

  // Reset the deck-builder store on mount so opening "New deck" after
  // creating a deck always starts at a blank commander search — the
  // store is in-memory and would otherwise retain the previous run's
  // commander, themes, and EDHREC data.
  useEffect(() => {
    resetDeckBuilder();
    // reset() keeps customization, so a stale mtgFormat from a previous visit
    // must be stamped back to match the pill (prefill format for regenerates).
    updateCustomizationStore({
      mtgFormat: prefill?.format === 'paupercommander' ? 'paupercommander' : 'commander',
    });
    if (prefill) {
      // ORDER IS LOAD-BEARING: setCommander() clears mustIncludeCards (forced
      // picks are commander-specific, so a carried-over pick would warp the
      // next deck). The combo seed's must-includes therefore have to be
      // written AFTER it, never before — swapping these two lines silently
      // drops them, with no type error. Covered by DeckNewPage.prefill.test.
      setCommander(prefill.commander);
      // After setCommander, which clears any partner.
      if (prefill.partnerCommander) setPartnerCommanderStore(prefill.partnerCommander);
      updateCustomizationStore({
        // A regenerate replays every setting the source deck was built with;
        // the explicit fields below agree with it and cover older decks.
        ...prefill.customization,
        // Regenerate supplies these; a combo seed doesn't and must keep the
        // page's defaults, so each is written only when actually present.
        ...(prefill.targetBracket !== undefined && {
          targetBracket: prefill.targetBracket as 'all' | 1 | 2 | 3 | 4 | 5,
        }),
        ...(prefill.landCount !== undefined && { landCount: prefill.landCount }),
        ...(prefill.collectionMode !== undefined && { collectionMode: prefill.collectionMode }),
        ...(prefill.mustIncludeCards?.length ? { mustIncludeCards: prefill.mustIncludeCards } : {}),
      });
      // A replayed land count is the build's own, not a suggestion: without
      // this the EDHREC land pre-fill (use-deck-generation) overwrites it as
      // soon as the commander's page loads.
      if (prefill.customization || prefill.landCount !== undefined) setUserEditedLands(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Start-blank ───────────────────────────────────────────────────────
  const handleStartBlank = useCallback(async () => {
    if (formatConfig.hasCommander && !commander) return;
    if (!colorReady) return;
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
      initialVisibility: visibility,
    });
    if (visibility !== 'private' && canPublish) {
      if (visibility === 'friends') {
        await shareWithFriendsAfterCreate(id);
      } else {
        await publishAfterCreate(id);
      }
      return;
    }
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
    visibility,
    canPublish,
    publishAfterCreate,
    shareWithFriendsAfterCreate,
    colorReady,
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
          : isPdh
            ? 'Builds a full 100 from Pauper Commander–legal cards, chosen by card function. EDHREC has no PDH data.'
            : 'Generate uses EDHREC data to draft a full 100.';

  // Full card images for the takeover panel — it shows the actual card(s).
  const commanderCardUrl = commander ? imageFromCard(commander, 'normal') : undefined;
  const partnerCardUrl = partnerCommander ? imageFromCard(partnerCommander, 'normal') : undefined;

  // ── Visibility — shared by both manual-create action sections below
  // (commander formats' "Start blank" and non-commander formats' "Create
  // deck") so the same choice isn't duplicated.
  const visibilityFieldset = (
    <section className="deck-builder-section">
      <h2 className="deck-builder-section-title">Visibility</h2>
      <VisibilityChoice
        ariaLabel="Deck visibility"
        value={visibility}
        options={[
          {
            value: 'public',
            label: 'Public',
            hint: canPublish
              ? 'Anyone can find it at a stable link and on your profile.'
              : publicDisabledReason!,
            disabled: !canPublish,
          },
          {
            value: 'friends',
            label: 'Friends',
            hint: canPublish
              ? 'Only your friends can find it, on your page in their Friends list.'
              : publicDisabledReason!,
            disabled: !canPublish,
          },
          { value: 'private', label: 'Private', hint: 'Only you can see this deck.' },
        ]}
        onChange={setVisibility}
      />
    </section>
  );

  // While generating, replace the page body with the shared takeover so the
  // build feels deliberate.
  if (isBuilding && progress) {
    return (
      <div className="deck-builder-page">
        <BackLink to="/decks" label="All decks" />
        <div ref={progressRef} className="guided-takeover-wrap">
          <GenerationTakeover
            commanderName={commander?.name}
            commanderImageUrl={commanderCardUrl}
            partnerName={partnerCommander?.name}
            partnerImageUrl={partnerCardUrl}
            message={progress.message}
            percent={progress.percent}
            isExiting={takeoverExiting}
            onExitComplete={handleTakeoverExitComplete}
            colorIdentity={colorIdentity}
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
              {isPdh
                ? 'Pick an uncommon creature to lead, then generate a deck, start from scratch, or '
                : 'Pick a commander, then generate a deck, start from scratch, or '}
            </>
          ) : (
            <>Create a {formatConfig.label} deck and add cards, or </>
          )}
          <Button variant="link" onClick={() => setShowImport(true)}>
            import one you already have.
          </Button>
        </p>
      </header>

      {/* Combo-seed disclosure (E215) — the whole reason someone clicked a
          host commander on /collection/combos was to build around this combo;
          say so before anything else, not six sections down in a collapsed
          "Must-include cards" accordion. */}
      {prefill?.comboContext && (
        <section
          className="deck-builder-section combo-seed-banner"
          aria-label="Building around a combo"
        >
          <p className="combo-seed-banner-label">
            <Zap width={13} height={13} aria-hidden />
            Building around a combo
          </p>
          <p className="combo-seed-banner-pieces">{prefill.comboContext.pieceNames.join(' + ')}</p>
          {prefill.comboContext.produces.length > 0 && (
            <p className="combo-seed-banner-produces">
              {prefill.comboContext.produces.slice(0, 3).join(' · ')}
            </p>
          )}
          <p className="combo-seed-banner-hint">
            These cards are pinned as must-includes. Generation seats them first.
          </p>
        </section>
      )}

      {showImport && (
        <ImportDeckDialog onClose={() => setShowImport(false)} format={selectedFormat} />
      )}

      <section
        className={`deck-builder-section deck-new-format-section${
          formatExpanded ? ' is-expanded' : ''
        }`}
      >
        <h2 className="deck-builder-section-title">Format</h2>
        <div className="deck-new-format-summary">
          <span className="deck-new-format-summary-active">{formatConfig.label}</span>
          <Button variant="link" onClick={() => setFormatExpanded(true)}>
            Change format
          </Button>
        </div>
        <fieldset className="format-pill-row" aria-label="Deck format">
          {(Object.keys(DECK_FORMAT_CONFIGS) as DeckFormat[]).map((fmt) => {
            const cfg = DECK_FORMAT_CONFIGS[fmt];
            const active = selectedFormat === fmt;
            return (
              <label key={fmt} className={`format-pill${active ? ' active' : ''}`}>
                <input
                  type="radio"
                  name={formatGroup}
                  value={fmt}
                  checked={active}
                  onChange={() => applyFormat(fmt)}
                />
                <span>{cfg.label}</span>
              </label>
            );
          })}
        </fieldset>
        <p className="format-pill-hint">{formatConfig.description}</p>
      </section>

      {formatConfig.hasCommander && (
        <section className="deck-builder-section">
          <h2 className="deck-builder-section-title">Commander</h2>
          <CommanderSearch
            key={selectedFormat}
            value={commander}
            onSelect={selectCommander}
            format={selectedFormat}
            initialSearchMode={commanderSource}
            onSelectFromBinder={(card) => {
              // E283: a "From my binder" pick is a build-from-what-I-own
              // intent, so land with collection mode on and "Only my cards".
              updateCustomization({ collectionMode: true, collectionStrategy: 'full' });
              selectCommander(card);
            }}
          />
        </section>
      )}

      {formatConfig.hasCommander && choosesColorBeforeGame(commander) && (
        <ChosenColorPicker commander={commander} partner={null} onChoose={setChosenColor} />
      )}

      {/* Brew walks the EDHREC-driven Commander flow — no PDH data there. It
          sits BELOW the commander picker, not above it: the subtitle's first
          instruction is "Pick a commander", and on a 360px phone the promo
          box used to push the picker under the tab bar, so the first thing
          in reach was a secondary mode. A commander already picked here
          rides along (router state) — brew resets the builder store on mount
          and used to ask for the same commander a second time. */}
      {formatConfig.hasCommander && !isPdh && !commander && (
        <section className="deck-builder-section guided-cta">
          <div className="guided-cta-text">
            <strong>Prefer to pick every card?</strong>
            <span>
              Build the deck one slot at a time. Each stop deals you a hand of candidates to add or
              pass.
            </span>
          </div>
          <Button
            onClick={() =>
              navigate('/decks/new/brew', commander ? { state: { commander } } : undefined)
            }
            iconEnd={<ArrowRight width={14} height={14} />}
          >
            Start brewing
          </Button>
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
          pdh={isPdh}
        />
      )}

      {/* Themes come right after the build method they depend on, ahead of
          Customize: most builds pick a theme and never open the settings.
          Themes only steer the EDHREC generator — the Scryfall-driven modes
          define their own pool, so the theme picker is irrelevant there. */}
      {formatConfig.hasCommander &&
        !isPdh &&
        commander &&
        customization.generationMode === 'edhrec' && (
          <ThemePicker
            commanderName={commander.name}
            selectedSlugs={selectedThemeSlugs}
            onToggle={toggleTheme}
          />
        )}

      {/* Customizer sits ahead of the partner picker so collection-mode is
          decided before partner selection — the picker filters its
          suggestions (and warns) based on what's owned. */}
      {formatConfig.hasCommander && commander && (
        <DeckCustomizer customization={customization} update={updateCustomization} />
      )}

      {/* Partner picker searches legendary partner mechanics — not a PDH surface. */}
      {formatConfig.hasCommander && !isPdh && commander && (
        <PartnerCommanderSelector
          key={commander.id}
          commander={commander}
          partner={partnerCommander}
          onSelect={setPartnerCommander}
          collectionMode={customization.collectionMode}
        />
      )}

      {formatConfig.hasCommander &&
        !choosesColorBeforeGame(commander) &&
        choosesColorBeforeGame(partnerCommander) && (
          <ChosenColorPicker
            commander={null}
            partner={partnerCommander}
            onChoose={setChosenColor}
          />
        )}

      {formatConfig.hasCommander ? (
        commander && (
          <>
            {visibilityFieldset}
            <section className="deck-builder-section deck-builder-actions">
              <Button
                variant="primary"
                onClick={build}
                disabled={isBuilding || publishing || !modeReady || !colorReady}
              >
                {isBuilding ? 'Building…' : publishing ? 'Publishing…' : generateLabel}
              </Button>
              <Button
                onClick={() => void handleStartBlank()}
                disabled={isBuilding || publishing || !colorReady}
              >
                {publishing ? 'Creating…' : 'Start blank'}
              </Button>
              <p className="deck-builder-actions-hint">
                {colorChooser && !colorReady
                  ? `Choose ${colorChooser.name.split(' // ')[0]}'s color above to build.`
                  : `${generateHint} Start blank gives you just the commander so you can pick every card by hand.`}
              </p>
              {error && <div className="error-banner deck-builder-error">{error}</div>}
            </section>
            {/* Once a commander is picked, Brew sits with Generate and Start blank:
                the three ways to build, in one place. The commander rides along
                (router state). Before a pick, the promo sits under the picker. */}
            {formatConfig.hasCommander && !isPdh && commander && (
              <section className="deck-builder-section guided-cta">
                <div className="guided-cta-text">
                  <strong>Prefer to pick every card?</strong>
                  <span>
                    Build the deck one slot at a time. Each stop deals you a hand of candidates to
                    add or pass.
                  </span>
                </div>
                <Button
                  onClick={() =>
                    navigate('/decks/new/brew', commander ? { state: { commander } } : undefined)
                  }
                  iconEnd={<ArrowRight width={14} height={14} />}
                >
                  Start brewing
                </Button>
              </section>
            )}
          </>
        )
      ) : (
        <>
          {visibilityFieldset}
          <section className="deck-builder-section deck-builder-actions">
            <Button variant="primary" onClick={() => void handleStartBlank()} disabled={publishing}>
              {publishing ? 'Creating…' : 'Create deck'}
            </Button>
            <p className="deck-builder-actions-hint">
              Create an empty {formatConfig.label} deck ({formatConfig.mainboardSize}-card mainboard
              {formatConfig.sideboardSize > 0
                ? ` with ${formatConfig.sideboardSize}-card sideboard`
                : ''}
              ). Add cards manually in the editor.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
