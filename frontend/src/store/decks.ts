import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ScryfallCard, ThemeResult } from '@/deck-builder/types';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';

/**
 * Persisted deck shape. Stores full ScryfallCard payloads so a saved deck
 * survives offline/backend-down without a Scryfall round-trip on load.
 *
 * Each `DeckCard` carries an `allocatedScryfallId`: the specific physical
 * copy claimed from the user's collection (by Scryfall printing). null
 * means the card is not allocated to any owned copy — either because the
 * user does not own it (status: 'unowned') or because the originally
 * allocated copy was removed from the collection (status: 'orphan').
 *
 * Status is computed at render time from the collection store; we do not
 * persist it, so deck JSON stays a function of the deck plus the current
 * collection.
 */

export type DeckSource = 'generated' | 'manual';

export interface DeckCard {
  /** Stable per-row id so removals do not depend on array index. */
  slotId: string;
  card: ScryfallCard;
  allocatedScryfallId: string | null;
}

export interface Deck {
  id: string;
  name: string;
  source: DeckSource;
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null;
  /** Allocations for the commander(s), parallel to the commander fields. */
  commanderAllocatedScryfallId: string | null;
  partnerCommanderAllocatedScryfallId: string | null;
  cards: DeckCard[];
  /** For generated decks: snapshot enough context to regenerate. Null otherwise. */
  generationContext: {
    selectedThemes: ThemeResult[];
    bracketLevel: number | 'all';
    landCount: number;
    collectionMode: boolean;
  } | null;
  /**
   * Optional generator-derived stats. Only present on freshly generated decks
   * (and only when the tagger data file was reachable at build time). These
   * are snapshotted at generation and never recomputed — manual edits will
   * leave them slightly stale, but the toolbar still surfaces totals from
   * the live card list.
   */
  roleCounts?: Record<string, number>;
  rampSubtypeCounts?: Record<string, number>;
  removalSubtypeCounts?: Record<string, number>;
  boardwipeSubtypeCounts?: Record<string, number>;
  cardDrawSubtypeCounts?: Record<string, number>;
  bracketEstimation?: BracketEstimation;
  deckGrade?: { letter: string; headline: string };
  createdAt: number;
  updatedAt: number;
}

interface DecksState {
  decks: Deck[];
  hydrated: boolean;

  createDeck(input: {
    name?: string;
    source: DeckSource;
    commander: ScryfallCard | null;
    partnerCommander?: ScryfallCard | null;
    cards?: DeckCard[];
    commanderAllocatedScryfallId?: string | null;
    partnerCommanderAllocatedScryfallId?: string | null;
    generationContext?: Deck['generationContext'];
    roleCounts?: Record<string, number>;
    rampSubtypeCounts?: Record<string, number>;
    removalSubtypeCounts?: Record<string, number>;
    boardwipeSubtypeCounts?: Record<string, number>;
    cardDrawSubtypeCounts?: Record<string, number>;
    bracketEstimation?: BracketEstimation;
    deckGrade?: { letter: string; headline: string };
  }): string;

  updateDeck(id: string, updates: Partial<Omit<Deck, 'id' | 'createdAt'>>): void;
  renameDeck(id: string, name: string): void;
  deleteDeck(id: string): void;
  /** Deep-clone a deck. Allocations reset — the original still claims those copies. */
  duplicateDeck(id: string): string | null;

  addCard(deckId: string, card: ScryfallCard, allocatedScryfallId?: string | null): string;
  removeCard(deckId: string, slotId: string): void;
  setCardAllocation(deckId: string, slotId: string, allocatedScryfallId: string | null): void;

  setCommander(deckId: string, card: ScryfallCard | null, allocated?: string | null): void;
  setPartnerCommander(deckId: string, card: ScryfallCard | null, allocated?: string | null): void;

  /** Replace the whole card list — used when committing a generated deck. */
  replaceCards(deckId: string, cards: DeckCard[]): void;
}

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function touch(deck: Deck): Deck {
  return { ...deck, updatedAt: Date.now() };
}

export const useDecksStore = create<DecksState>()(
  persist(
    (set) => ({
      decks: [],
      hydrated: false,

      createDeck: (input) => {
        const id = newId('deck');
        const now = Date.now();
        const deck: Deck = {
          id,
          name: input.name ?? defaultDeckName(input.commander),
          source: input.source,
          commander: input.commander,
          partnerCommander: input.partnerCommander ?? null,
          commanderAllocatedScryfallId: input.commanderAllocatedScryfallId ?? null,
          partnerCommanderAllocatedScryfallId: input.partnerCommanderAllocatedScryfallId ?? null,
          cards: input.cards ?? [],
          generationContext: input.generationContext ?? null,
          roleCounts: input.roleCounts,
          rampSubtypeCounts: input.rampSubtypeCounts,
          removalSubtypeCounts: input.removalSubtypeCounts,
          boardwipeSubtypeCounts: input.boardwipeSubtypeCounts,
          cardDrawSubtypeCounts: input.cardDrawSubtypeCounts,
          bracketEstimation: input.bracketEstimation,
          deckGrade: input.deckGrade,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ decks: [deck, ...s.decks] }));
        return id;
      },

      updateDeck: (id, updates) =>
        set((s) => ({
          decks: s.decks.map((d) => (d.id === id ? touch({ ...d, ...updates }) : d)),
        })),

      renameDeck: (id, name) =>
        set((s) => ({
          decks: s.decks.map((d) => (d.id === id ? touch({ ...d, name }) : d)),
        })),

      deleteDeck: (id) => set((s) => ({ decks: s.decks.filter((d) => d.id !== id) })),

      duplicateDeck: (id) => {
        const state = useDecksStore.getState();
        const original = state.decks.find((d) => d.id === id);
        if (!original) return null;
        const newDeckId = newId('deck');
        const now = Date.now();
        const copy: Deck = {
          ...original,
          id: newDeckId,
          name: `${original.name} (copy)`,
          // Reset commander allocations — duplicated deck does not claim
          // the same physical copies the original is using.
          commanderAllocatedScryfallId: null,
          partnerCommanderAllocatedScryfallId: null,
          cards: original.cards.map((c) => ({
            slotId: newId('slot'),
            card: c.card,
            allocatedScryfallId: null,
          })),
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ decks: [copy, ...s.decks] }));
        return newDeckId;
      },

      addCard: (deckId, card, allocatedScryfallId = null) => {
        const slotId = newId('slot');
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId
              ? touch({
                  ...d,
                  cards: [...d.cards, { slotId, card, allocatedScryfallId }],
                })
              : d
          ),
        }));
        return slotId;
      },

      removeCard: (deckId, slotId) =>
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId ? touch({ ...d, cards: d.cards.filter((c) => c.slotId !== slotId) }) : d
          ),
        })),

      setCardAllocation: (deckId, slotId, allocatedScryfallId) =>
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId
              ? touch({
                  ...d,
                  cards: d.cards.map((c) =>
                    c.slotId === slotId ? { ...c, allocatedScryfallId } : c
                  ),
                })
              : d
          ),
        })),

      setCommander: (deckId, card, allocated = null) =>
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId
              ? touch({ ...d, commander: card, commanderAllocatedScryfallId: allocated })
              : d
          ),
        })),

      setPartnerCommander: (deckId, card, allocated = null) =>
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId
              ? touch({
                  ...d,
                  partnerCommander: card,
                  partnerCommanderAllocatedScryfallId: allocated,
                })
              : d
          ),
        })),

      replaceCards: (deckId, cards) =>
        set((s) => ({
          decks: s.decks.map((d) => (d.id === deckId ? touch({ ...d, cards }) : d)),
        })),
    }),
    {
      name: 'mtg-decks',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
      partialize: (s) => ({ decks: s.decks }),
    }
  )
);

export function newDeckCard(
  card: ScryfallCard,
  allocatedScryfallId: string | null = null
): DeckCard {
  return { slotId: newId('slot'), card, allocatedScryfallId };
}

function defaultDeckName(commander: ScryfallCard | null): string {
  if (!commander) return 'Untitled deck';
  // Take everything before the first comma for two-name commanders ("Korvold,
  // Fae-Cursed King" → "Korvold").
  return commander.name.split(',')[0].trim();
}

/** Look up a deck by id (selector helper). */
export function selectDeck(id: string | undefined): (state: DecksState) => Deck | null {
  return (s) => s.decks.find((d) => d.id === id) ?? null;
}
