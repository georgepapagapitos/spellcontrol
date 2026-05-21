import { logger } from '@/lib/logger';
import { create } from 'zustand';
import type {
  AppState,
  Customization,
  ScryfallCard,
  GeneratedDeck,
  EDHRECTheme,
  ThemeResult,
  DeckHistoryEntry,
} from '@/deck-builder/types';
import { isEuropean } from '@/deck-builder/lib/region';
import { swapCard } from '@/deck-builder/services/deckBuilder/cardSwap';

const LS = {
  bannedCards: 'mtg-deck-builder-banned-cards',
  mustInclude: 'mtg-deck-builder-must-include-cards',
  currency: 'mtg-deck-builder-currency',
  banLists: 'mtg-deck-builder-ban-lists',
  excludeLists: 'mtg-deck-builder-applied-exclude-lists',
  includeLists: 'mtg-deck-builder-applied-include-lists',
  arenaOnly: 'mtg-deck-builder-arena-only',
};

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}
function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
function loadCurrency(): 'USD' | 'EUR' {
  const stored = (() => {
    try {
      return localStorage.getItem(LS.currency);
    } catch {
      return null;
    }
  })();
  if (stored === 'USD' || stored === 'EUR') return stored;
  return isEuropean() ? 'EUR' : 'USD';
}
function loadArenaOnly(): boolean {
  try {
    return localStorage.getItem(LS.arenaOnly) === 'true';
  } catch {
    return false;
  }
}

const defaultCustomization: Customization = {
  deckFormat: 99,
  landCount: 37,
  nonBasicLandCount: 15,
  bannedCards: loadJSON<string[]>(LS.bannedCards, []),
  banLists: loadJSON(LS.banLists, []),
  mustIncludeCards: loadJSON<string[]>(LS.mustInclude, []),
  tempBannedCards: [],
  tempMustIncludeCards: [],
  maxCardPrice: null,
  deckBudget: null,
  budgetOption: 'any',
  gameChangerLimit: 'unlimited',
  bracketLevel: 'all',
  maxRarity: null,
  tinyLeaders: false,
  ignoreOwnedBudget: false,
  ignoreOwnedRarity: false,
  collectionMode: false,
  collectionStrategy: 'full',
  collectionOwnedPercent: 75,
  arenaOnly: loadArenaOnly(),
  scryfallQuery: '',
  comboCount: 1,
  hyperFocus: false,
  balancedRoles: true,
  currency: loadCurrency(),
  appliedExcludeLists: loadJSON(LS.excludeLists, []),
  appliedIncludeLists: loadJSON(LS.includeLists, []),
  advancedTargets: {
    curvePercentages: null,
    typePercentages: null,
    roleTargets: null,
    edhrecBlendWeight: null,
    edhrecInclusionThreshold: null,
  },
  tempoAutoDetect: true,
  tempoPacing: 'balanced',
  saltTolerance: 2,
};

export const useDeckBuilderStore = create<AppState>((set, get) => ({
  commander: null,
  partnerCommander: null,
  colorIdentity: [],

  edhrecThemes: [],
  selectedThemes: [],
  themesLoading: false,
  themesError: null,
  themeSource: 'local',
  edhrecNumDecks: null,
  edhrecLandSuggestion: null,
  edhrecStats: null,
  userEditedLands: false,

  customization: defaultCustomization,

  generatedDeck: null,
  deckHistory: [],

  isLoading: false,
  loadingMessage: '',
  error: null,

  setCommander: (card) =>
    set((state) => {
      const partnerIdentity = state.partnerCommander?.color_identity || [];
      const commanderIdentity = card?.color_identity || [];
      const combined = [...new Set([...commanderIdentity, ...partnerIdentity])];
      return {
        commander: card,
        colorIdentity: combined,
        generatedDeck: null,
        edhrecThemes: [],
        selectedThemes: [],
        themesLoading: false,
        themesError: null,
        themeSource: 'local',
        edhrecNumDecks: null,
        edhrecLandSuggestion: null,
        edhrecStats: null,
        userEditedLands: false,
        deckHistory: [],
      };
    }),

  setPartnerCommander: (card) =>
    set((state) => {
      const commanderIdentity = state.commander?.color_identity || [];
      const partnerIdentity = card?.color_identity || [];
      const combined = [...new Set([...commanderIdentity, ...partnerIdentity])];
      return {
        partnerCommander: card,
        colorIdentity: combined,
        generatedDeck: null,
        edhrecThemes: [],
        selectedThemes: [],
        themesLoading: false,
        themesError: null,
        themeSource: 'local',
        edhrecNumDecks: null,
        edhrecStats: null,
        deckHistory: [],
      };
    }),

  setEdhrecThemes: (themes: EDHRECTheme[]) =>
    set({ edhrecThemes: themes, themeSource: 'edhrec', themesError: null }),
  setEdhrecNumDecks: (count) => set({ edhrecNumDecks: count }),
  setEdhrecLandSuggestion: (suggestion) => set({ edhrecLandSuggestion: suggestion }),
  setEdhrecStats: (stats) => set({ edhrecStats: stats }),
  setUserEditedLands: (edited) => set({ userEditedLands: edited }),
  setSelectedThemes: (themes: ThemeResult[]) => set({ selectedThemes: themes }),
  toggleThemeSelection: (themeName: string) =>
    set((state) => ({
      selectedThemes: state.selectedThemes.map((t) =>
        t.name === themeName ? { ...t, isSelected: !t.isSelected } : t
      ),
    })),
  setThemesLoading: (loading) => set({ themesLoading: loading }),
  setThemesError: (error) =>
    set((state) => ({
      themesError: error,
      themeSource: error ? 'local' : state.themeSource,
    })),

  updateCustomization: (updates: Partial<Customization>) =>
    set((state) => {
      const next = { ...state.customization, ...updates };
      if (updates.bannedCards !== undefined) saveJSON(LS.bannedCards, next.bannedCards);
      if (updates.mustIncludeCards !== undefined) saveJSON(LS.mustInclude, next.mustIncludeCards);
      if (updates.banLists !== undefined) saveJSON(LS.banLists, next.banLists);
      if (updates.currency !== undefined) {
        try {
          localStorage.setItem(LS.currency, next.currency);
        } catch {
          /* ignore */
        }
      }
      if (updates.appliedExcludeLists !== undefined)
        saveJSON(LS.excludeLists, next.appliedExcludeLists);
      if (updates.appliedIncludeLists !== undefined)
        saveJSON(LS.includeLists, next.appliedIncludeLists);
      if (updates.arenaOnly !== undefined) {
        try {
          localStorage.setItem(LS.arenaOnly, String(next.arenaOnly));
        } catch {
          /* ignore */
        }
      }
      return { customization: next };
    }),

  setGeneratedDeck: (deck: GeneratedDeck | null) => set({ generatedDeck: deck }),

  swapDeckCard: (oldCard: ScryfallCard, newCard: ScryfallCard) => {
    const { generatedDeck } = get();
    if (!generatedDeck) return;
    const result = swapCard(generatedDeck, oldCard, newCard);
    if (result.success) {
      set({ generatedDeck: result.deck });
    } else {
      logger.warn('[DeckBuilder] swap failed:', result.error);
    }
  },

  pushDeckHistory: (entry) =>
    set((state) => {
      const newEntry: DeckHistoryEntry = {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
      };
      return { deckHistory: [newEntry, ...state.deckHistory].slice(0, 50) };
    }),

  clearDeckHistory: () => set({ deckHistory: [] }),

  setLoading: (loading, message = '') => set({ isLoading: loading, loadingMessage: message }),
  setError: (error) => set({ error }),

  reset: () =>
    set((state) => ({
      commander: null,
      partnerCommander: null,
      colorIdentity: [],
      edhrecThemes: [],
      selectedThemes: [],
      themesLoading: false,
      themesError: null,
      themeSource: 'local',
      edhrecNumDecks: null,
      userEditedLands: false,
      customization: state.customization,
      generatedDeck: null,
      deckHistory: [],
      isLoading: false,
      loadingMessage: '',
      error: null,
    })),
}));
