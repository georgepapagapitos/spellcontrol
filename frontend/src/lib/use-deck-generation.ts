import { logger } from '@/lib/logger';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { haptics } from './haptics';
import { useDeckBuilderStore } from '@/deck-builder/store';
import { buildCommanderProfile } from '@/deck-builder/services/deckBuilder/commanderProfile';
import { generateDeck } from '@/deck-builder/services/deckBuilder/deckGenerator';
import { fetchCommanderData } from '@/deck-builder/services/edhrec/client';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { saveGeneratedDeck } from './save-generated-deck';
import { buildAvailableCollection } from './collection-availability';
import type { SubstituteCandidate } from '@/deck-builder/services/deckBuilder/substituteFinder';
import type { ScryfallCard, EDHRECTheme, ThemeResult } from '@/deck-builder/types';

interface Options {
  /** Seed themes (e.g. from a re-generate prefill). */
  initialThemes?: EDHRECTheme[];
  /** Fire a success haptic when the build lands (native guided flow). */
  haptic?: boolean;
}

/**
 * Shared orchestration for the two commander deck-generation surfaces
 * (the single-page "New deck" form and the step-by-step "Build together"
 * wizard). Both surfaces drive the same engine with identical EDHREC
 * pre-fetch, theme preselection, collection-mode handling, and progress
 * lifecycle — keeping that here is the only way the two stay in lockstep.
 * The pages own their own layout/chrome; this owns the generation logic.
 */
export function useDeckGeneration({ initialThemes, haptic = false }: Options = {}) {
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

  // Pre-fetch EDHREC land suggestion when a commander is picked so the
  // customizer can show the "✓ suggested" badge before generation, and
  // preselect the themes the commander's abilities point at.
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
        // Preselect the commander's suggested themes, but never clobber a
        // selection the user (or a prefill) already made.
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
      if (customization.collectionMode) {
        if (customization.collectionStrategy === 'available') {
          const available = buildAvailableCollection(collectionCards, decks);
          collectionNames = available.names;
          collectionAvailableCounts = available.counts;
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
        collectionPool,
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
      if (haptic) haptics.success();
      // justGenerated → the editor auto-shows the build report once (incl. the
      // "committed to other decks" conflict note).
      navigate(`/decks/${id}`, { state: { justGenerated: true } });
    } catch (e) {
      logger.error('[DeckBuilder] generation failed:', e);
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
    haptic,
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
