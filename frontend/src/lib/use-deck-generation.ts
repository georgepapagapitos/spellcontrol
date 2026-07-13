import { logger } from '@/lib/logger';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { haptics } from './haptics';
import { toast } from '../store/toasts';
import { useDeckBuilderStore } from '@/deck-builder/store';
import { buildCommanderProfile } from '@/deck-builder/services/deckBuilder/commanderProfile';
import { generateDeck } from '@/deck-builder/services/deckBuilder/deckGenerator';
import { fetchCommanderData } from '@/deck-builder/services/edhrec/client';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { useCubeStore } from '../store/cube';
import { saveGeneratedDeck } from './save-generated-deck';
import {
  buildAvailableCollection,
  buildBasicPrintingAvailability,
  countCommittedExcluded,
  type BasicPrintingAvail,
} from './collection-availability';
import { validateGeneratedDeck } from './deck-validation';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { SubstituteCandidate } from '@/deck-builder/services/deckBuilder/substituteFinder';
import type {
  ScryfallCard,
  EDHRECTheme,
  ThemeResult,
  GeneratedDeck,
  DeckFormatConfig,
} from '@/deck-builder/types';

/**
 * Hard gate a freshly generated deck before it's ever saved (E128): illegal
 * cards, color-identity violations, over/under size, copy-limit violations,
 * and an absurdly-low land count are all rejected here, not just flagged
 * afterward on the saved deck's display badge. Pure and exported so it's
 * unit-testable without mounting the store-heavy build() flow — mirrors
 * resolveGenerationDestination below.
 */
export function checkGenerationGate(
  generated: GeneratedDeck,
  config: DeckFormatConfig
): { ok: true } | { ok: false; message: string } {
  const mainboard = Object.values(generated.categories).flat();
  const issues = validateGeneratedDeck(mainboard, config, {
    commander: generated.commander,
    partnerCommander: generated.partnerCommander,
  });
  if (issues.length === 0) return { ok: true };
  return {
    ok: false,
    message: `Couldn't build a legal deck: ${issues.map((i) => `${i.cardName} — ${i.detail}`).join('; ')}`,
  };
}

interface Options {
  /** Seed themes (e.g. from a re-generate prefill). */
  initialThemes?: EDHRECTheme[];
  /** Fire a success haptic when the build lands (native guided flow). */
  haptic?: boolean;
  /** Optional page-owned exit animation before the generated deck route takes over. */
  beforeNavigate?: () => void | Promise<void>;
  /** Deck this build regenerated from — on completion, lands on the compare
   * diff (source vs new) instead of the new deck's editor. */
  sourceDeckId?: string;
}

/**
 * Where a completed build should land: the source-vs-new compare diff when
 * this was a regenerate and the source deck is still around, otherwise the
 * new deck's editor (also the fallback if the source was deleted mid-build).
 */
export function resolveGenerationDestination(
  newDeckId: string,
  sourceDeckId: string | undefined,
  existingDeckIds: Set<string>
): string {
  if (sourceDeckId && existingDeckIds.has(sourceDeckId)) {
    return `/decks/compare?a=${sourceDeckId}&b=${newDeckId}`;
  }
  return `/decks/${newDeckId}`;
}

/**
 * Shared orchestration for the two commander deck-generation surfaces
 * (the single-page "New deck" form and the step-by-step "Build together"
 * wizard). Both surfaces drive the same engine with identical EDHREC
 * pre-fetch, collection-mode handling, and progress lifecycle — keeping that
 * here is the only way the two stay in lockstep.
 * The pages own their own layout/chrome; this owns the generation logic.
 */
export function useDeckGeneration({
  initialThemes,
  haptic = false,
  beforeNavigate,
  sourceDeckId,
}: Options = {}) {
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

  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const savedCubes = useCubeStore((s) => s.saved);
  const createDeck = useDecksStore((s) => s.createDeck);

  const [progress, setProgress] = useState<{ message: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [selectedThemes, setSelectedThemes] = useState<EDHRECTheme[]>(() => initialThemes ?? []);
  const progressRef = useRef<HTMLDivElement>(null);

  // Scroll the progress takeover into view the moment generation begins —
  // it can fire from the bottom of a long form, behind the native nav FAB.
  const showProgress = progress !== null;
  useEffect(() => {
    if (!showProgress) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    progressRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, [showProgress]);

  const commanderProfile = useMemo(
    () => (commander ? buildCommanderProfile(commander) : null),
    [commander]
  );

  const selectedThemeSlugs = useMemo(
    () => new Set(selectedThemes.map((t) => t.slug)),
    [selectedThemes]
  );

  const toggleTheme = useCallback((theme: EDHRECTheme) => {
    setSelectedThemes((prev) => {
      const exists = prev.some((t) => t.slug === theme.slug);
      return exists ? prev.filter((t) => t.slug !== theme.slug) : [...prev, theme];
    });
  }, []);

  const selectCommander = useCallback(
    (card: ScryfallCard | null) => {
      setCommander(card);
      setSelectedThemes([]);
    },
    [setCommander]
  );

  // Pre-fetch the EDHREC land suggestion when a commander is picked, so the
  // customizer can show the "✓ suggested" land counts before generation.
  // Themes are intentionally NOT auto-selected: an oracle-derived guess was
  // often wrong (it steered off the commander's actual popular archetypes), so
  // a wrong default was worse than none. The picker (sorted by deck count) +
  // the no-theme hint cover the empty state instead.
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
        // Auto-apply suggestion if the user hasn't manually changed lands yet.
        if (!useDeckBuilderStore.getState().userEditedLands) {
          updateCustomization({ landCount: total, nonBasicLandCount: nonbasic });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [commander, setEdhrecLandSuggestion, setEdhrecStats, updateCustomization]);

  const build = useCallback(async () => {
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
      let collectionAvailableCounts: Map<string, number> | undefined;
      let committedExcluded: number | undefined;
      // Per-printing breakdown of free owned basics, so generation pulls real
      // groups of the player's basic-land printings (built for any owned-aware
      // mode; based on free copies so we never stamp a printing they can't supply).
      let collectionBasicPrintings: Map<string, BasicPrintingAvail[]> | undefined;
      if (customization.collectionMode) {
        collectionBasicPrintings = buildBasicPrintingAvailability(
          collectionCards,
          decks,
          savedCubes
        );
        if (customization.collectionStrategy === 'available') {
          const available = buildAvailableCollection(collectionCards, decks, savedCubes);
          collectionNames = available.names;
          collectionAvailableCounts = available.counts;
          const excluded = countCommittedExcluded(collectionCards, available.names, colorIdentity);
          if (excluded > 0) committedExcluded = excluded;
        } else {
          collectionNames = new Set(collectionCards.map((c) => c.name));
        }
        if (collectionNames.size === 0) {
          setError(
            customization.collectionStrategy === 'available'
              ? 'All your cards are committed to other decks. Free up copies or switch to "Only my cards" mode.'
              : customization.collectionStrategy === 'prefer'
                ? 'Your collection is empty. Import cards on the Collection page to enable owned-first bias.'
                : 'Your collection is empty. Import cards on the Collection page before constraining the build to owned cards.'
          );
          setIsBuilding(false);
          setProgress(null);
          return;
        }
      }

      // Lean owned pool (one entry per available card name) so the owned-only
      // relaxation can substitute the closest owned card rather than reaching
      // outside the collection. `collectionNames` already reflects the chosen
      // strategy (free copies for 'available', all owned for 'full'), so keying
      // off it keeps the pool strategy-correct.
      let collectionPool: SubstituteCandidate[] | undefined;
      if (collectionNames) {
        const byName = new Map<string, SubstituteCandidate>();
        for (const c of collectionCards) {
          if (!collectionNames.has(c.name) || byName.has(c.name)) continue;
          byName.set(c.name, {
            name: c.name,
            colorIdentity: c.colorIdentity ?? [],
            cmc: c.cmc,
            typeLine: c.typeLine,
          });
        }
        if (byName.size > 0) collectionPool = [...byName.values()];
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
        collectionAvailableCounts,
        collectionBasicPrintings,
        collectionPool,
        onProgress: (message, percent) => setProgress({ message, percent }),
      });

      const formatConfig = DECK_FORMAT_CONFIGS[customization.mtgFormat ?? 'commander'];
      const gate = checkGenerationGate(deck, formatConfig);
      if (!gate.ok) {
        throw new Error(gate.message);
      }

      updateCustomization({ tempBannedCards: [], tempMustIncludeCards: [] });

      const id = saveGeneratedDeck(
        deck,
        customization,
        themesForGenerator,
        decks,
        collectionCards,
        createDeck,
        committedExcluded
      );
      if (haptic) haptics.success();
      await beforeNavigate?.();
      // Read the store directly rather than the closed-over `decks` —
      // generation can run long enough for it to go stale.
      const existingDeckIds = new Set(useDecksStore.getState().decks.map((d) => d.id));
      const destination = resolveGenerationDestination(id, sourceDeckId, existingDeckIds);
      const landedOnCompare = sourceDeckId != null && existingDeckIds.has(sourceDeckId);
      if (landedOnCompare) {
        toast.show({ message: 'Comparing your previous build with the new one.', tone: 'info' });
        navigate(destination);
      } else {
        // justGenerated → the editor auto-shows the build report once (incl.
        // the "committed to other decks" conflict note).
        navigate(destination, { state: { justGenerated: true } });
      }
    } catch (e) {
      logger.error('[DeckBuilder] generation failed:', e);
      setError(e instanceof Error ? e.message : "Couldn't build the deck.");
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
    savedCubes,
    createDeck,
    setEdhrecStats,
    setEdhrecLandSuggestion,
    updateCustomization,
    navigate,
    haptic,
    beforeNavigate,
    sourceDeckId,
  ]);

  return {
    // store-derived values the pages render with
    commander,
    partnerCommander,
    setPartnerCommander,
    colorIdentity,
    customization,
    updateCustomization,
    commanderProfile,
    // theme state
    selectedThemes,
    selectedThemeSlugs,
    toggleTheme,
    // actions + lifecycle
    selectCommander,
    build,
    isBuilding,
    progress,
    error,
    progressRef,
  };
}
