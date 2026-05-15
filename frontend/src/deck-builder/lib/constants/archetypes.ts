import type { DeckComposition, DeckFormat, DeckFormatConfig, DeckSize } from '@/deck-builder/types';

export const BASE_DECK_COMPOSITION: DeckComposition = {
  lands: 37,
  ramp: 10,
  cardDraw: 10,
  singleRemoval: 8,
  boardWipes: 3,
  creatures: 20,
  synergy: 8,
  utility: 3,
};

// Format configurations keyed by MTG format name
export const DECK_FORMAT_CONFIGS: Record<DeckFormat, DeckFormatConfig> = {
  commander: {
    format: 'commander',
    label: 'Commander',
    description: '99 cards + commander, optional sideboard',
    deckSize: 100,
    mainboardSize: 99,
    /* Commander has no official sideboard cap, but kitchen-table /
       bracket-style groups commonly run swap piles. Infinity opens the
       sideboard UI without claiming an arbitrary limit (the header
       reads "Sideboard (N)" instead of "Sideboard (N/10)"). Card
       validation already counts copies across main + side, so the
       singleton rule still holds across the combined deck. */
    sideboardSize: Number.POSITIVE_INFINITY,
    defaultLands: 37,
    landRange: [32, 42],
    hasCommander: true,
    isSingleton: true,
    maxCopies: 1,
    legalityKey: 'commander',
    supportsGeneration: true,
  },
  brawl: {
    format: 'brawl',
    label: 'Brawl',
    description: '59 cards + commander, optional sideboard',
    deckSize: 60,
    mainboardSize: 59,
    /* Same treatment as Commander — no enforced limit; the UI renders
       "Sideboard (N)" without a max. */
    sideboardSize: Number.POSITIVE_INFINITY,
    defaultLands: 23,
    landRange: [19, 27],
    hasCommander: true,
    isSingleton: true,
    maxCopies: 1,
    legalityKey: 'brawl',
    supportsGeneration: true,
  },
  standard: {
    format: 'standard',
    label: 'Standard',
    description: '60-card constructed with 15-card sideboard',
    deckSize: 60,
    mainboardSize: 60,
    sideboardSize: 15,
    defaultLands: 24,
    landRange: [20, 26],
    hasCommander: false,
    isSingleton: false,
    maxCopies: 4,
    legalityKey: 'standard',
    supportsGeneration: false,
  },
  pauper: {
    format: 'pauper',
    label: 'Pauper',
    description: '60-card constructed (commons only) with 15-card sideboard',
    deckSize: 60,
    mainboardSize: 60,
    sideboardSize: 15,
    defaultLands: 24,
    landRange: [20, 26],
    hasCommander: false,
    isSingleton: false,
    maxCopies: 4,
    legalityKey: 'pauper',
    supportsGeneration: false,
  },
};

// Legacy helper for the generation engine — accepts a deck size and returns
// a config suitable for commander/brawl generation scaling.
export function getDeckFormatConfig(size: number): DeckFormatConfig {
  if (size === 99 || size === 100) return DECK_FORMAT_CONFIGS.commander;
  if (size === 59 || size === 60) return DECK_FORMAT_CONFIGS.brawl;
  if (size === 40) {
    return {
      format: 'brawl',
      label: 'Brawl (40)',
      description: '39 cards + commander',
      deckSize: 40,
      mainboardSize: 39,
      sideboardSize: 0,
      defaultLands: 16,
      landRange: [14, 18],
      hasCommander: true,
      isSingleton: true,
      maxCopies: 1,
      legalityKey: 'brawl',
      supportsGeneration: true,
    };
  }
  // Interpolate sensible defaults for custom sizes
  const landRatio = size <= 50 ? 0.4 : size <= 70 ? 0.38 : 0.37;
  const defaultLands = Math.round((size - 1) * landRatio);
  return {
    format: 'commander',
    label: `Custom (${size})`,
    description: `${size - 1} cards + commander`,
    deckSize: size + 1,
    mainboardSize: size,
    sideboardSize: 0,
    defaultLands,
    landRange: [Math.max(1, Math.floor(defaultLands * 0.8)), Math.ceil(defaultLands * 1.2)] as [
      number,
      number,
    ],
    hasCommander: true,
    isSingleton: true,
    maxCopies: 1,
    legalityKey: 'commander',
    supportsGeneration: true,
  };
}

// Base deck composition for different deck sizes (generation engine only)
export const FORMAT_BASE_COMPOSITION: Record<DeckSize, DeckComposition> = {
  40: {
    lands: 17,
    ramp: 2,
    cardDraw: 2,
    singleRemoval: 3,
    boardWipes: 0,
    creatures: 14,
    synergy: 2,
    utility: 0,
  },
  60: {
    lands: 24,
    ramp: 4,
    cardDraw: 4,
    singleRemoval: 4,
    boardWipes: 2,
    creatures: 16,
    synergy: 4,
    utility: 2,
  },
  99: BASE_DECK_COMPOSITION,
};
