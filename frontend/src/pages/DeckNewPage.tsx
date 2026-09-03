import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Zap } from 'lucide-react';
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
import { useGenerationTakeoverExit } from '../lib/use-generation-takeover-exit';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { buildAllocationMap, pickCollectionCopy } from '../lib/allocations';
import { usePublishOnCreate, type PublishOutcome } from '../lib/use-publish-on-create';
import type { ScryfallCard, DeckFormat, EDHRECTheme } from '@/deck-builder/types';
import type { ComboSeedContext } from '../types/combos';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';

/**
 * Router-state seed for a build. Two shapes share it:
 *
 *  - **Regenerate** (ReadinessSpotlight / DecksIndexPage) replays a saved
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
    needsDisplayName,
    displayNameDraft,
    setDisplayNameDraft,
    publishAfterCreate,
    saveDisplayNameAndPublish,
    cancelDisplayName,
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
      if (visibility !== 'public' || !canPublish) return false;
      pendingDestination.current = { path: destination, state: navState };
      await publishAfterCreate(id);
      return true;
    },
    [visibility, canPublish, publishAfterCreate]
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
  });

  const [showImport, setShowImport] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<DeckFormat>(prefill?.format ?? 'commander');
  // Radios group by shared `name` — scope each group to this page instance.
  const visibilityGroup = useId();
  const formatGroup = useId();
  const formatConfig = DECK_FORMAT_CONFIGS[selectedFormat];
  const isPdh = selectedFormat === 'paupercommander';

  // Keep the store's build-format in lockstep with the pill so generation and
  // the saved deck both know the format. Only PDH generates as its own format
  // today — every other commander-family pill builds the standard 100.
  const applyFormat = useCallback(
    (fmt: DeckFormat) => {
      setSelectedFormat(fmt);
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
      updateCustomizationStore({
        // Regenerate supplies these; a combo seed doesn't and must keep the
        // page's defaults, so each is written only when actually present.
        ...(prefill.targetBracket !== undefined && {
          targetBracket: prefill.targetBracket as 'all' | 1 | 2 | 3 | 4 | 5,
        }),
        ...(prefill.landCount !== undefined && { landCount: prefill.landCount }),
        ...(prefill.collectionMode !== undefined && { collectionMode: prefill.collectionMode }),
        ...(prefill.mustIncludeCards?.length ? { mustIncludeCards: prefill.mustIncludeCards } : {}),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Start-blank ───────────────────────────────────────────────────────
  const handleStartBlank = useCallback(async () => {
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
    if (visibility === 'public' && canPublish) {
      await publishAfterCreate(id);
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
            ? 'Builds a full 100 from Pauper Commander–legal cards, chosen by card function (EDHREC has no PDH data).'
            : 'Generate uses EDHREC data to draft a full 100.';

  // Commander art for the takeover panel.
  const commanderArtUrl =
    commander?.image_uris?.art_crop ?? commander?.card_faces?.[0]?.image_uris?.art_crop;

  // ── Visibility fieldset — shared by both manual-create action sections
  // below (commander formats' "Start blank" and non-commander formats'
  // "Create deck") so the same choice + ladder styling isn't duplicated.
  // Reuses ShareDialog's own ladder classes (share-audience/-option) per the
  // established visibility-ladder pattern, rather than inventing a new one.
  const visibilityFieldset = (
    <section className="deck-builder-section">
      <h2 className="deck-builder-section-title">Visibility</h2>
      <fieldset className="share-audience" aria-label="Deck visibility">
        {(
          [
            { value: 'private', label: 'Private', disabled: false },
            { value: 'public', label: 'Public', disabled: !canPublish },
          ] as const
        ).map((opt) => (
          <label
            key={opt.value}
            className={`share-audience-option${visibility === opt.value ? ' is-active' : ''}`}
          >
            <input
              type="radio"
              name={visibilityGroup}
              value={opt.value}
              checked={visibility === opt.value}
              disabled={opt.disabled}
              onChange={() => setVisibility(opt.value)}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </fieldset>
      <p className="format-pill-hint">
        {visibility === 'public'
          ? 'Anyone can find it at a stable link and on your profile.'
          : 'Only you can see this deck.'}
        {!canPublish && ` ${publicDisabledReason}`}
      </p>
    </section>
  );

  // Inline set-name substep — same pattern ShareDialog falls back to on a
  // display_name_required 400 (a minimal inline field + Cancel/Save, rather
  // than extracting a shared component: the two flows differ enough — a
  // whole page here vs. a modal sub-step there — that lifting one out isn't
  // cheap). Replaces the action row until resolved; the deck is already
  // created either way, so Cancel still lands on the (private) editor.
  const displayNameSubstep = (
    <section className="deck-builder-section deck-builder-actions">
      <p className="deck-builder-actions-hint">
        Publishing shows your display name on the deck page — set one to continue.
      </p>
      <div className="field">
        <label htmlFor="deck-new-display-name">Display name</label>
        <input
          id="deck-new-display-name"
          type="text"
          className="name-input-field"
          value={displayNameDraft}
          maxLength={40}
          disabled={publishing}
          onChange={(e) => setDisplayNameDraft(e.target.value)}
        />
      </div>
      <button type="button" className="btn" onClick={cancelDisplayName} disabled={publishing}>
        Cancel
      </button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void saveDisplayNameAndPublish()}
        disabled={publishing || !displayNameDraft.trim()}
      >
        {publishing ? 'Saving…' : 'Save & continue'}
      </button>
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
            commanderImageUrl={commanderArtUrl}
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
                ? 'Pick an uncommon creature to lead, then generate a deck of commons, start blank and add cards by hand, or '
                : 'Pick a commander, then generate a deck from EDHREC data, start blank and add cards by hand, or '}
            </>
          ) : (
            <>Create a {formatConfig.label} deck and add cards manually, or </>
          )}
          <button type="button" className="btn-link" onClick={() => setShowImport(true)}>
            import an existing deck list.
          </button>
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
            These cards are pinned as must-includes below — generation will do everything it can to
            seat all of them.
          </p>
        </section>
      )}

      {showImport && (
        <ImportDeckDialog onClose={() => setShowImport(false)} format={selectedFormat} />
      )}

      <section className="deck-builder-section">
        <h2 className="deck-builder-section-title">Format</h2>
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
          />
        </section>
      )}

      {/* Brew walks the EDHREC-driven Commander flow — no PDH data there. It
          sits BELOW the commander picker, not above it: the subtitle's first
          instruction is "Pick a commander", and on a 360px phone the promo
          box used to push the picker under the tab bar, so the first thing
          in reach was a secondary mode. A commander already picked here
          rides along (router state) — brew resets the builder store on mount
          and used to ask for the same commander a second time. */}
      {formatConfig.hasCommander && !isPdh && (
        <section className="deck-builder-section guided-cta">
          <div className="guided-cta-text">
            <strong>Prefer to pick every card?</strong>
            <span>
              Brew mode walks the deck slot by slot — ramp, draw, removal, wipes, your theme,
              finishers — dealing you a hand of candidates to add or pass at each stop.
            </span>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() =>
              navigate('/decks/new/brew', commander ? { state: { commander } } : undefined)
            }
          >
            Start brewing →
          </button>
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

      {/* Themes only steer the EDHREC generator — the Scryfall-driven modes
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

      {formatConfig.hasCommander ? (
        commander && (
          <>
            {visibilityFieldset}
            {needsDisplayName ? (
              displayNameSubstep
            ) : (
              <section className="deck-builder-section deck-builder-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={build}
                  disabled={isBuilding || publishing || !modeReady}
                >
                  {isBuilding ? 'Building…' : publishing ? 'Publishing…' : generateLabel}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleStartBlank()}
                  disabled={isBuilding || publishing}
                >
                  {publishing ? 'Creating…' : 'Start blank'}
                </button>
                <p className="deck-builder-actions-hint">
                  {generateHint} Start blank gives you just the commander so you can pick every card
                  by hand.
                </p>
                {error && <div className="error-banner deck-builder-error">{error}</div>}
              </section>
            )}
          </>
        )
      ) : (
        <>
          {visibilityFieldset}
          {needsDisplayName ? (
            displayNameSubstep
          ) : (
            <section className="deck-builder-section deck-builder-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleStartBlank()}
                disabled={publishing}
              >
                {publishing ? 'Creating…' : 'Create deck'}
              </button>
              <p className="deck-builder-actions-hint">
                Create an empty {formatConfig.label} deck ({formatConfig.mainboardSize}-card
                mainboard
                {formatConfig.sideboardSize > 0
                  ? ` with ${formatConfig.sideboardSize}-card sideboard`
                  : ''}
                ). Add cards manually in the editor.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
