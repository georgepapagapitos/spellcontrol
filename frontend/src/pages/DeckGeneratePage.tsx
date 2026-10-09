import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Zap } from 'lucide-react';
// Generate-only stylesheets ship with this chunk, not the boot payload (E265).
import '@/styles/deck-builder-guided.css';
import '@/styles/deck-builder-customizer.css';
import '@/styles/deck-builder-commander-profile.css';
import './DeckGeneratePage.css';
import { BackLink } from '@/components/app-shell/BackLink';
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
import { useDeckGeneration } from '@/lib/deck/use-deck-generation';
import { useGenerationTakeoverExit } from '@/lib/deck/use-generation-takeover-exit';
import { imageFromCard } from '@/lib/cards/card-thumbs';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { useCubeStore } from '../store/cube';
import { buildAllocationMap, pickCollectionCopy } from '@/lib/collection/allocations';
import { usePublishOnCreate, type PublishOutcome } from '@/lib/social/use-publish-on-create';
import { VisibilityChoice } from '@/components/share/VisibilityChoice';
import type { ScryfallCard, DeckFormat, EDHRECTheme, Customization } from '@/deck-builder/types';
import type { ComboSeedContext } from '../types/combos';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { Button } from '@/components/shared/Button';
import { KeepEditsToggle } from '@/components/deck/KeepEditsToggle';
import { keepEditsPatch, type DeckEdits } from '@/lib/deck/regenerate-edits';
import { parseDeckFormat } from '@/lib/deck/deck-format-param';
import { fillFormatSettings } from '@/lib/coach/fill-deck';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import { commanderIneligibility } from '@/deck-builder/services/deckBuilder/commanderEligibility';
import { buildsFromOwnedCards } from '@/deck-builder/services/deckBuilder/deckFilters';

/**
 * Router-state seed for a build. Two shapes share it:
 *
 *  - **Regenerate** (DecksIndexPage, DeckEditorPage) replays a saved
 *    deck's settings, so it supplies the full set.
 *  - **Combo seed** (the collection combos view) knows only a commander and
 *    the cards that must survive, and wants this page's own defaults for
 *    everything else — hence the regenerate-only fields are optional. An
 *    absent field means "leave it alone", never "reset it".
 */
export interface GeneratePrefill {
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
  /** What the player added and cut since the source deck was generated;
   *  absent when there is nothing to carry. */
  edits?: DeckEdits;
}

/** Router state /decks/new/generate reads. The format itself rides in `?format=`. */
export interface GenerateRouteState {
  prefill?: GeneratePrefill;
  /** The Decks index's "New deck from my collection" door: open the picker on
   *  the collection. */
  commanderSource?: 'binder';
}

const METHOD_LABEL: Record<Customization['generationMode'], string> = {
  edhrec: 'EDHREC',
  'oracle-role': 'By function',
  'art-theme': 'By art',
  historical: 'From a year',
};

/**
 * `/decks/new/generate` — pick a commander and draft a full deck from it. The
 * start page (`/decks/new`) is where you choose to generate at all; this page
 * is only the generator, so every other way to start lives there and not here.
 */
export function DeckGeneratePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const routerState = location.state as GenerateRouteState | null;
  const prefill = routerState?.prefill;
  const commanderSource = routerState?.commanderSource;
  // `?format=` wins (it's what the start page and the "change format" link
  // write); a regenerate from an older link carries it in the prefill only.
  const format: DeckFormat =
    parseDeckFormat(searchParams.get('format')) ?? prefill?.format ?? 'commander';
  const formatConfig = DECK_FORMAT_CONFIGS[format];
  const isPdh = format === 'paupercommander';

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
  // has to obey the same fieldset as "Start blank".
  //
  // The fieldset/network/display-name-substep logic itself is shared with
  // ImportDeckDialog's single-deck path (E150) — see usePublishOnCreate's
  // own doc comment for why it hands off rather than firing the seal here:
  // this page navigates away the instant a publish resolves.
  // Where a publish-on-create should land once it settles. Null for "Start
  // blank" — the new deck's own editor is the only destination there. Set by
  // the generate hand-off below, which alone knows about the compare-diff
  // landing and the justGenerated build-report flag. A ref, not state: it's
  // written and read within a single async hand-off.
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
   * Apply the visibility choice to a freshly *generated* deck. Returns true
   * when it takes over navigation, so useDeckGeneration leaves routing alone —
   * including the display_name_required case, where publishAfterCreate shows
   * its inline substep and this page stays put until that resolves.
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
    selectedThemes,
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
  // E530: a commander this format won't accept (Llanowar Elves, Atraxa in
  // Pauper Commander, a pair that can't partner) holds both buttons and says
  // why, the same answer the generator's entry would throw.
  const ineligible = commander
    ? commanderIneligibility(commander, partnerCommander, customization.mtgFormat)
    : null;
  const buildReady = colorReady && !ineligible;

  // Reset the deck-builder store on mount so opening the generator after
  // creating a deck always starts at a blank commander search — the store is
  // in-memory and would otherwise retain the previous run's commander,
  // themes, and EDHREC data.
  useEffect(() => {
    resetDeckBuilder();
    // reset() keeps customization, so a stale mtgFormat from a previous visit
    // must be stamped back to match this page's format. The table is Fill's
    // (fillFormatSettings), so Brawl builds the 60-card deck here too; the
    // 99-card formats stamp only mtgFormat, as before.
    const formatSettings = fillFormatSettings(format);
    updateCustomizationStore(formatSettings);
    // The EDHREC land pre-fill describes a 100-card deck: a format that sets
    // its own land count must not have it overwritten when a commander loads.
    if (formatSettings.landCount !== undefined) setUserEditedLands(true);
    if (prefill) {
      // ORDER IS LOAD-BEARING: setCommander() clears mustIncludeCards (forced
      // picks are commander-specific, so a carried-over pick would warp the
      // next deck). The combo seed's must-includes therefore have to be
      // written AFTER it, never before — swapping these two lines silently
      // drops them, with no type error. Covered by DeckGeneratePage.prefill.test.
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
      // Keep-my-edits starts on: the regenerate carries what the player added
      // and cut. Written after setCommander for the same reason as above.
      if (prefill.edits) {
        const { customization: now } = useDeckBuilderStore.getState();
        updateCustomizationStore(
          keepEditsPatch(now, prefill.edits, true, prefill.customization?.mustIncludeCards)
        );
      }
      // A replayed land count is the build's own, not a suggestion: without
      // this the EDHREC land pre-fill (use-deck-generation) overwrites it as
      // soon as the commander's page loads.
      if (prefill.customization || prefill.landCount !== undefined) setUserEditedLands(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [keepEdits, setKeepEdits] = useState(true);
  const sourceEdits = prefill?.edits;
  const toggleKeepEdits = (edits: DeckEdits, keep: boolean) => {
    setKeepEdits(keep);
    const { customization: now } = useDeckBuilderStore.getState();
    updateCustomizationStore(
      keepEditsPatch(now, edits, keep, prefill?.customization?.mustIncludeCards)
    );
  };

  // `?commander=<name>` (the Trending rail's "Build with …" tiles) lands with
  // that commander picked. The param is dropped once applied, so a later
  // Change survives a reload. A name that doesn't resolve leaves the finder
  // open, which is where the player would have started anyway. A prefill
  // (regenerate, combo seed) already names its commander and wins.
  const commanderParam = searchParams.get('commander');
  useEffect(() => {
    if (!commanderParam || prefill) return;
    let cancelled = false;
    void (async () => {
      try {
        const card = await getCardByName(commanderParam);
        if (!cancelled) selectCommander(card);
      } catch {
        /* unresolved: the finder stays open */
      }
      if (!cancelled) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete('commander');
            return next;
          },
          { replace: true, state: location.state }
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commanderParam, prefill, selectCommander, setSearchParams, location.state]);

  // ── Start blank: this commander, no cards ──────────────────────────────
  const handleStartBlank = useCallback(async () => {
    if (!commander || !buildReady) return;
    const allocationMap = buildAllocationMap(decks, useCubeStore.getState().saved);
    const commanderAlloc =
      pickCollectionCopy(commander.name, collectionCards, allocationMap, commander.id)?.copyId ??
      null;
    const partnerAlloc = partnerCommander
      ? (pickCollectionCopy(
          partnerCommander.name,
          collectionCards,
          allocationMap,
          partnerCommander.id
        )?.copyId ?? null)
      : null;
    const id = createDeck({
      format,
      source: 'manual',
      commander,
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
    format,
    visibility,
    canPublish,
    publishAfterCreate,
    shareWithFriendsAfterCreate,
    buildReady,
  ]);

  // A format with no commander has nothing to generate: the start page is
  // where those decks begin.
  if (!formatConfig.hasCommander) {
    return <Navigate to={`/decks/new?format=${format}`} replace />;
  }

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

  // The bar's one-line recap, so the choices made above stay in view while
  // the page scrolls: who, how, the first theme, the bracket and who sees it.
  const methodLabel = isPdh && genMode === 'edhrec' ? 'By function' : METHOD_LABEL[genMode];
  const bracket = customization.targetBracket;
  const summary = commander
    ? [
        commander.name.split(',')[0].split(' // ')[0],
        genMode === 'historical' ? `From ${customization.historicalYear}` : methodLabel,
        genMode === 'edhrec' && !isPdh ? selectedThemes[0]?.name : undefined,
        bracket === 'all' ? 'Any bracket' : `Bracket ${bracket}`,
        visibility === 'public' ? 'Public' : visibility === 'friends' ? 'Friends' : 'Private',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  // Full card images for the takeover panel — it shows the actual card(s).
  const commanderCardUrl = commander ? imageFromCard(commander, 'normal') : undefined;
  const partnerCardUrl = partnerCommander ? imageFromCard(partnerCommander, 'normal') : undefined;
  const startPage = `/decks/new?format=${format}`;

  // While generating, replace the page body with the shared takeover so the
  // build feels deliberate.
  if (isBuilding && progress) {
    return (
      <div className="deck-builder-page">
        <BackLink to={startPage} label="New deck" />
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
    <div className="deck-builder-page deck-generate-page">
      <BackLink to={startPage} label="New deck" />
      <header className="deck-builder-header">
        <h1>Generate a deck</h1>
        <p className="deck-builder-subtitle">
          {formatConfig.label} ·{' '}
          <Button variant="link" to={startPage}>
            Change format
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
            <Zap width={14} height={14} strokeWidth={1.8} aria-hidden />
            Building around a combo
          </p>
          <p className="combo-seed-banner-pieces">{prefill.comboContext.pieceNames.join(' + ')}</p>
          {prefill.comboContext.produces.length > 0 && (
            <p className="combo-seed-banner-produces">
              {prefill.comboContext.produces.slice(0, 3).join(' · ')}
            </p>
          )}
          <p className="combo-seed-banner-hint">Pinned as must-includes.</p>
        </section>
      )}

      {sourceEdits && (
        <KeepEditsToggle
          edits={sourceEdits}
          checked={keepEdits}
          onChange={(keep) => toggleKeepEdits(sourceEdits, keep)}
        />
      )}

      <section className="deck-builder-section">
        <h2 className="deck-builder-section-title">Find a commander</h2>
        <CommanderSearch
          key={format}
          value={commander}
          onSelect={selectCommander}
          format={format}
          initialSearchMode={commanderSource}
          onSelectFromBinder={(card) => {
            // E283: a "From my collection" pick is a build-from-what-I-own
            // intent, so land with collection mode on and "Only my cards".
            updateCustomization({ collectionMode: true, collectionStrategy: 'full' });
            selectCommander(card);
          }}
        />
      </section>

      {choosesColorBeforeGame(commander) && (
        <ChosenColorPicker commander={commander} partner={null} onChoose={setChosenColor} />
      )}

      {commander && commanderProfile && <CommanderProfileCard profile={commanderProfile} />}

      {commander && (
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
      {!isPdh && commander && customization.generationMode === 'edhrec' && (
        <ThemePicker
          commanderName={commander.name}
          selectedSlugs={selectedThemeSlugs}
          onToggle={toggleTheme}
        />
      )}

      {/* Customizer sits ahead of the partner picker so collection-mode is
          decided before partner selection — the picker filters its
          suggestions (and warns) based on what's owned. */}
      {commander && <DeckCustomizer customization={customization} update={updateCustomization} />}

      {/* Partner picker searches legendary partner mechanics — not a PDH surface. */}
      {!isPdh && commander && (
        <PartnerCommanderSelector
          key={commander.id}
          commander={commander}
          partner={partnerCommander}
          onSelect={setPartnerCommander}
          collectionMode={buildsFromOwnedCards(customization)}
        />
      )}

      {!choosesColorBeforeGame(commander) && choosesColorBeforeGame(partnerCommander) && (
        <ChosenColorPicker commander={null} partner={partnerCommander} onChoose={setChosenColor} />
      )}

      {commander && (
        <>
          {/* The full choice, every hint visible (STYLE_GUIDE "Visibility is
              one choice"): a compact menu in the bar would hide the reason
              Public is unavailable. The bar echoes the pick instead. */}
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
          <p className="deck-generate-hint">{generateHint}</p>

          <div className="deck-generate-bar" role="group" aria-label="Build this deck">
            <p className={`deck-generate-bar-summary${buildReady ? '' : ' is-blocking'}`}>
              {ineligible
                ? ineligible.message
                : colorChooser && !colorReady
                  ? `Choose ${colorChooser.name.split(' // ')[0]}'s color above to build.`
                  : summary}
            </p>
            {error && (
              <div className="error-banner deck-builder-error deck-generate-bar-error" role="alert">
                {error}
              </div>
            )}
            <div className="deck-generate-bar-actions">
              <Button
                onClick={() => void handleStartBlank()}
                disabled={isBuilding || publishing || !buildReady}
              >
                {publishing ? 'Creating…' : 'Start blank'}
              </Button>
              <Button
                variant="primary"
                onClick={build}
                disabled={isBuilding || publishing || !modeReady || !buildReady}
              >
                {isBuilding ? 'Building…' : publishing ? 'Publishing…' : generateLabel}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
