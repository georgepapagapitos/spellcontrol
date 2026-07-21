import { useCallback, useEffect, useState } from 'react';
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
import { useGenerationTakeoverExit } from '../lib/use-generation-takeover-exit';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { buildAllocationMap, pickCollectionCopy } from '../lib/allocations';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';
import { updateProfile } from '../lib/auth-api';
import { isOnline, onSyncedChange } from '../lib/sync';
import { DisplayNameRequiredError, publicationUrl, publishDeck } from '../lib/publications-client';
import type { ScryfallCard, DeckFormat, EDHRECTheme } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';

interface PrefillState {
  commander: ScryfallCard;
  themes: EDHRECTheme[];
  targetBracket: number | 'all';
  landCount: number;
  collectionMode: boolean;
  /** The deck this regenerate ran from — lands the completed build on the compare diff instead of the editor. */
  sourceDeckId?: string;
  /** Format of the source deck — a PDH regenerate must stay PDH. */
  format?: DeckFormat;
  /** Variety roll the source deck was built with — restoring it makes
   *  Regenerate reproduce the same build; absent clears any lingering roll. */
  varietySeed?: number;
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
  });

  const [showImport, setShowImport] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<DeckFormat>(prefill?.format ?? 'commander');
  const formatConfig = DECK_FORMAT_CONFIGS[selectedFormat];
  const isPdh = selectedFormat === 'paupercommander';

  // ── Visibility (creation-time choice) ──────────────────────────────────
  const isGuest = useAuth((s) => s.status === 'guest');
  const [, forceOnlineTick] = useState(0);
  useEffect(() => onSyncedChange(() => forceOnlineTick((n) => n + 1)), []);
  const online = isOnline();
  const canPublish = !isGuest && online;
  const publicDisabledReason = isGuest
    ? 'Sign in to publish.'
    : !online
      ? "You're offline — reconnect to publish."
      : null;

  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  // Never leave Public selected-but-disabled (e.g. connectivity drops after
  // it was chosen) — snap back to Private during render (React's "adjusting
  // state when a value changes" pattern, not an effect: this is a guarded,
  // terminating setState call during render, so react-hooks/set-state-in-effect
  // doesn't apply — there's no effect here to begin with).
  if (!canPublish && visibility === 'public') {
    setVisibility('private');
  }

  const [publishing, setPublishing] = useState(false);
  const [needsDisplayName, setNeedsDisplayName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [pendingPublishId, setPendingPublishId] = useState<string | null>(null);

  const announcePublished = (slug: string) => {
    toast.show({
      message: `Published — anyone can view it at ${publicationUrl(slug)}`,
      tone: 'success',
    });
  };

  /** Publish a just-created deck. On display_name_required, hold off
   *  navigating and show the same inline set-name substep ShareDialog uses;
   *  any other failure just toasts a warning — the deck already exists, so
   *  a failed publish never blocks getting to the editor. */
  const publishAfterCreate = useCallback(
    async (id: string) => {
      setPublishing(true);
      try {
        const pub = await publishDeck(id);
        announcePublished(pub.slug);
        navigate(`/decks/${id}`);
      } catch (err) {
        if (err instanceof DisplayNameRequiredError) {
          setPendingPublishId(id);
          setNeedsDisplayName(true);
        } else {
          toast.show({
            message: err instanceof Error ? err.message : 'Failed to publish deck.',
            tone: 'warn',
          });
          navigate(`/decks/${id}`);
        }
      } finally {
        setPublishing(false);
      }
    },
    [navigate]
  );

  const handleSaveDisplayNameAndPublish = async () => {
    const trimmed = displayNameDraft.trim();
    if (!trimmed || !pendingPublishId || publishing) return;
    setPublishing(true);
    try {
      const updated = await updateProfile({ displayName: trimmed });
      useAuth.setState((s) => (s.profile ? { profile: { ...s.profile, ...updated } } : s));
      const pub = await publishDeck(pendingPublishId); // exactly one retry
      announcePublished(pub.slug);
      navigate(`/decks/${pendingPublishId}`);
    } catch (err) {
      toast.show({
        message: err instanceof Error ? err.message : "Couldn't publish the deck.",
        tone: 'warn',
      });
      navigate(`/decks/${pendingPublishId}`);
    } finally {
      setPublishing(false);
      setNeedsDisplayName(false);
    }
  };

  const handleCancelDisplayName = () => {
    // Deck stays created + private — never blocks creation.
    setNeedsDisplayName(false);
    if (pendingPublishId) navigate(`/decks/${pendingPublishId}`);
  };

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
      setCommander(prefill.commander);
      updateCustomizationStore({
        targetBracket: prefill.targetBracket as 'all' | 1 | 2 | 3 | 4 | 5,
        landCount: prefill.landCount,
        collectionMode: prefill.collectionMode,
        // Explicitly undefined for pre-feature decks: a lingering roll from an
        // unrelated session must not leak into this regenerate.
        varietySeed: prefill.varietySeed,
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
      <div className="share-audience" role="radiogroup" aria-label="Deck visibility">
        <button
          type="button"
          role="radio"
          aria-checked={visibility === 'private'}
          className={`share-audience-option${visibility === 'private' ? ' is-active' : ''}`}
          onClick={() => setVisibility('private')}
        >
          Private
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={visibility === 'public'}
          className={`share-audience-option${visibility === 'public' ? ' is-active' : ''}`}
          onClick={() => setVisibility('public')}
          disabled={!canPublish}
        >
          Public
        </button>
      </div>
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
      <button type="button" className="btn" onClick={handleCancelDisplayName} disabled={publishing}>
        Cancel
      </button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void handleSaveDisplayNameAndPublish()}
        disabled={publishing || !displayNameDraft.trim()}
      >
        {publishing ? 'Saving…' : 'Save & continue'}
      </button>
    </section>
  );

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
                onClick={() => applyFormat(fmt)}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
        <p className="format-pill-hint">{formatConfig.description}</p>
      </section>

      {/* Guided/Brew walk the EDHREC-driven Commander flow — no PDH data there. */}
      {formatConfig.hasCommander && !isPdh && (
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

      {formatConfig.hasCommander && !isPdh && (
        <section className="deck-builder-section guided-cta">
          <div className="guided-cta-text">
            <strong>Prefer to pick every card?</strong>
            <span>
              Brew mode walks the deck slot by slot — ramp, draw, removal, wipes, your theme,
              finishers — dealing you a hand of candidates to add or pass at each stop.
            </span>
          </div>
          <button type="button" className="btn" onClick={() => navigate('/decks/new/brew')}>
            Start brewing →
          </button>
        </section>
      )}

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
                  disabled={isBuilding || !modeReady}
                >
                  {isBuilding ? 'Building…' : generateLabel}
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
