import { useEffect, useMemo, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import './BrewBuildPage.css';
import { BackLink } from '../components/BackLink';
import { useDeckBuilderStore } from '@/deck-builder/store';
import { CommanderSearch } from '../components/deck/CommanderSearch';
import { CommanderProfileCard } from '../components/deck/CommanderProfileCard';
import { ThemePicker } from '../components/deck/ThemePicker';
import { useDeckGeneration } from '../lib/use-deck-generation';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { saveGeneratedDeck } from '../lib/save-generated-deck';
import { getDeckFormatConfig } from '@/deck-builder/lib/constants/archetypes';
import { routeCardByType } from '@/deck-builder/services/deckBuilder/categorize';
import { calculateStats } from '@/deck-builder/services/deckBuilder/deckStats';
import { computeRoleCounts } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import {
  useBrewStore,
  peekBrewDraft,
  clearBrewDraft,
  type BrewDraft,
} from '@/deck-builder/store/brew';
import { fetchCommanderData, fetchCommanderThemeData } from '@/deck-builder/services/edhrec/client';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { BrewProgressRail } from '@/deck-builder/components/brew/BrewProgressRail';
import { BrewSlotPanel } from '@/deck-builder/components/brew/BrewSlotPanel';
import { BrewRunningDeck } from '@/deck-builder/components/brew/BrewRunningDeck';
import { BrewManabaseStep } from '@/deck-builder/components/brew/BrewManabaseStep';
import type { DeckCategory, GeneratedDeck, ThemeResult, ScryfallCard } from '@/deck-builder/types';

const ALL_CATEGORIES: DeckCategory[] = [
  'lands',
  'ramp',
  'cardDraw',
  'singleRemoval',
  'boardWipes',
  'creatures',
  'synergy',
  'utility',
];

function relativeTime(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Brew mode: build the 99 slot by slot instead of one-shot generation. Reuses
 * the guided flow's commander/theme preamble, then hands off to the Brew
 * store's own slot loop. Self-contained — doesn't touch Customization or the
 * main deck-builder store beyond reading commander/colorIdentity/customization
 * (all already-existing state), so it can't conflict with concurrent edits to
 * DeckCustomizer/Customization defaults elsewhere.
 */
export function BrewBuildPage(): JSX.Element {
  const navigate = useNavigate();
  const resetDeckBuilder = useDeckBuilderStore((s) => s.reset);
  useEffect(() => {
    resetDeckBuilder();
    // Mount-only reset, mirrors DeckNewPage/GuidedBuildPage — resetDeckBuilder
    // is a stable Zustand action reference, safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    commander,
    partnerCommander,
    colorIdentity,
    customization,
    commanderProfile,
    selectedThemes,
    selectedThemeSlugs,
    toggleTheme,
    selectCommander,
  } = useDeckGeneration();

  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const createDeck = useDecksStore((s) => s.createDeck);

  const active = useBrewStore((s) => s.active);
  const phase = useBrewStore((s) => s.phase);
  const loading = useBrewStore((s) => s.loading);
  const error = useBrewStore((s) => s.error);
  const slots = useBrewStore((s) => s.slots);
  const slotIndex = useBrewStore((s) => s.slotIndex);
  const accepted = useBrewStore((s) => s.accepted);
  const goToSlot = useBrewStore((s) => s.goToSlot);
  const start = useBrewStore((s) => s.start);
  const resumeFromDraft = useBrewStore((s) => s.resumeFromDraft);
  const landPlan = useBrewStore((s) => s.landPlan);
  const resolvedNonlandCards = useBrewStore((s) => s.resolvedNonlandCards);
  const brewReset = useBrewStore((s) => s.reset);

  // Lazy initializer — a synchronous localStorage read, not an effect.
  const [draft, setDraft] = useState<BrewDraft | null>(() => peekBrewDraft());
  const [resuming, setResuming] = useState(false);
  const [saving, setSaving] = useState(false);

  async function resumeDraft(d: BrewDraft) {
    setResuming(true);
    try {
      const commanderResult = await getCardsByNames([d.commanderName]);
      const commanderCard = commanderResult.get(d.commanderName);
      if (commanderCard) selectCommander(commanderCard);
      const edhrecData = d.themeSlug
        ? await fetchCommanderThemeData(d.commanderName, d.themeSlug)
        : await fetchCommanderData(d.commanderName);
      const collectionNames = new Set(collectionCards.map((c) => c.name));
      resumeFromDraft(d, edhrecData, collectionNames);
    } finally {
      setResuming(false);
      setDraft(null);
    }
  }

  async function startBrewing() {
    if (!commander) return;
    const formatConfig = getDeckFormatConfig(customization.deckFormat);
    const collectionNames = new Set(collectionCards.map((c) => c.name));
    const themeLabel = selectedThemes.length ? selectedThemes.map((t) => t.name).join(' + ') : null;
    await start({
      commander,
      colorIdentity,
      themeLabel,
      themeSlug: selectedThemes[0]?.slug ?? null,
      deckFormatSize: formatConfig.mainboardSize,
      landCountTarget: customization.landCount,
      nonBasicLandTarget: customization.nonBasicLandCount,
      collectionNames,
    });
  }

  async function finishBrew() {
    if (!commander || !landPlan) return;
    setSaving(true);
    try {
      const categories = Object.fromEntries(
        ALL_CATEGORIES.map((k) => [k, [] as ScryfallCard[]])
      ) as unknown as Record<DeckCategory, ScryfallCard[]>;
      for (const card of resolvedNonlandCards) routeCardByType(card, categories);
      categories.lands = landPlan;
      const stats = calculateStats(categories);
      const roleResult = computeRoleCounts(resolvedNonlandCards);
      const generated: GeneratedDeck = {
        commander,
        partnerCommander: partnerCommander ?? null,
        categories,
        stats,
        roleCounts: roleResult.roleCounts,
        rampSubtypeCounts: roleResult.rampSubtypeCounts,
        removalSubtypeCounts: roleResult.removalSubtypeCounts,
        boardwipeSubtypeCounts: roleResult.boardwipeSubtypeCounts,
        cardDrawSubtypeCounts: roleResult.cardDrawSubtypeCounts,
      };
      const themesForGenerator: ThemeResult[] = selectedThemes.map((t) => ({
        name: t.name,
        source: 'edhrec',
        slug: t.slug,
        deckCount: t.count,
        popularityPercent: t.popularityPercent,
        isSelected: true,
      }));
      const id = saveGeneratedDeck(
        generated,
        customization,
        themesForGenerator,
        decks,
        collectionCards,
        createDeck
      );
      clearBrewDraft();
      brewReset();
      navigate(`/decks/${id}`, { state: { justGenerated: true } });
    } finally {
      setSaving(false);
    }
  }

  const acceptedCounts = useMemo(
    () => slots.map((s) => accepted[s.key]?.length ?? 0),
    [slots, accepted]
  );
  const totalAccepted = acceptedCounts.reduce((a, b) => a + b, 0);
  const totalTarget = slots.reduce((a, s) => a + s.target, 0);

  return (
    <div className="deck-builder-page brew-page">
      <BackLink to="/decks/new" label="New deck" />
      <header className="deck-builder-header">
        <h1>Brew mode</h1>
        <p className="deck-builder-subtitle">
          Build the 99 slot by slot — the app proposes, you decide. Ramp, card draw, removal, board
          wipes, your theme, finishers, then a manabase you review before it's saved.
        </p>
      </header>

      {draft && !active && (
        <section className="deck-builder-section brew-resume-banner">
          <div>
            <strong>Resume your brew of {draft.commanderName}?</strong>
            <span> Saved {relativeTime(draft.savedAt)}.</span>
          </div>
          <div className="brew-resume-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void resumeDraft(draft)}
              disabled={resuming}
            >
              {resuming ? 'Loading…' : 'Resume'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                clearBrewDraft();
                setDraft(null);
              }}
            >
              Discard
            </button>
          </div>
        </section>
      )}

      {!active && (
        <>
          <section className="deck-builder-section">
            <h2 className="deck-builder-section-title">Commander</h2>
            <CommanderSearch value={commander} onSelect={selectCommander} />
          </section>

          {commander && commanderProfile && <CommanderProfileCard profile={commanderProfile} />}

          {commander && (
            <ThemePicker
              commanderName={commander.name}
              selectedSlugs={selectedThemeSlugs}
              onToggle={toggleTheme}
            />
          )}

          {commander && (
            <section className="deck-builder-section deck-builder-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void startBrewing()}
                disabled={loading}
              >
                {loading ? 'Loading EDHREC data…' : 'Start brewing →'}
              </button>
              {error && <div className="error-banner deck-builder-error">{error}</div>}
            </section>
          )}
        </>
      )}

      {active && phase === 'brewing' && (
        <div className="brew-layout">
          <div className="brew-main">
            <BrewProgressRail
              slots={slots}
              slotIndex={slotIndex}
              acceptedCounts={acceptedCounts}
              totalAccepted={totalAccepted}
              totalTarget={totalTarget}
              onSelectSlot={goToSlot}
            />
            <BrewSlotPanel />
          </div>
          <BrewRunningDeck commander={commander} />
        </div>
      )}

      {active && phase === 'manabase' && (
        <div className="brew-layout">
          <div className="brew-main">
            <BrewManabaseStep onAccept={() => void finishBrew()} />
            {saving && <p className="brew-saving-note">Saving your deck…</p>}
          </div>
          <BrewRunningDeck commander={commander} />
        </div>
      )}
    </div>
  );
}
