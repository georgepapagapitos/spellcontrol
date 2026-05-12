import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ScryfallCard, ThemeResult, DeckFormat } from '@/deck-builder/types';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import { pickCollectionCopy, type AllocationInfo } from '../lib/allocations';
import type { EnrichedCard } from '../types';

/**
 * Persisted deck shape. Stores full ScryfallCard payloads so a saved deck
 * survives offline/backend-down without a Scryfall round-trip on load.
 *
 * Each `DeckCard` carries an `allocatedCopyId`: the specific physical
 * copy claimed from the user's collection (by unique copy identifier). null
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
  allocatedCopyId: string | null;
}

export interface Deck {
  id: string;
  name: string;
  format: DeckFormat;
  source: DeckSource;
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null;
  /** Allocations for the commander(s), parallel to the commander fields. */
  commanderAllocatedCopyId: string | null;
  partnerCommanderAllocatedCopyId: string | null;
  cards: DeckCard[];
  sideboard: DeckCard[];
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
    format?: DeckFormat;
    source: DeckSource;
    commander: ScryfallCard | null;
    partnerCommander?: ScryfallCard | null;
    cards?: DeckCard[];
    sideboard?: DeckCard[];
    commanderAllocatedCopyId?: string | null;
    partnerCommanderAllocatedCopyId?: string | null;
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

  addCard(deckId: string, card: ScryfallCard, allocatedCopyId?: string | null): string;
  removeCard(deckId: string, slotId: string): void;
  setCardAllocation(deckId: string, slotId: string, allocatedCopyId: string | null): void;

  addSideboardCard(deckId: string, card: ScryfallCard, allocatedCopyId?: string | null): string;
  removeSideboardCard(deckId: string, slotId: string): void;
  moveBetweenZones(deckId: string, slotId: string, from: 'main' | 'side'): void;

  setCommander(deckId: string, card: ScryfallCard | null, allocated?: string | null): void;
  setPartnerCommander(deckId: string, card: ScryfallCard | null, allocated?: string | null): void;

  /** Swap the printing on a deck slot. Clears allocation since the new printing may not be owned. */
  updateCardPrinting(deckId: string, slotId: string, card: ScryfallCard): void;

  /** Replace the whole card list — used when committing a generated deck. */
  replaceCards(deckId: string, cards: DeckCard[]): void;

  /** Re-match all deck allocations against a new collection. Called when the
   *  collection is replaced so allocatedCopyIds stay valid. */
  remapAllocations(newCollection: EnrichedCard[]): void;
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
          format: input.format ?? 'commander',
          source: input.source,
          commander: input.commander,
          partnerCommander: input.partnerCommander ?? null,
          commanderAllocatedCopyId: input.commanderAllocatedCopyId ?? null,
          partnerCommanderAllocatedCopyId: input.partnerCommanderAllocatedCopyId ?? null,
          cards: input.cards ?? [],
          sideboard: input.sideboard ?? [],
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
          commanderAllocatedCopyId: null,
          partnerCommanderAllocatedCopyId: null,
          cards: original.cards.map((c) => ({
            slotId: newId('slot'),
            card: c.card,
            allocatedCopyId: null,
          })),
          sideboard: original.sideboard.map((c) => ({
            slotId: newId('slot'),
            card: c.card,
            allocatedCopyId: null,
          })),
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ decks: [copy, ...s.decks] }));
        return newDeckId;
      },

      addCard: (deckId, card, allocatedCopyId = null) => {
        const slotId = newId('slot');
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId
              ? touch({
                  ...d,
                  cards: [...d.cards, { slotId, card, allocatedCopyId }],
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

      setCardAllocation: (deckId, slotId, allocatedCopyId) =>
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId
              ? touch({
                  ...d,
                  cards: d.cards.map((c) => (c.slotId === slotId ? { ...c, allocatedCopyId } : c)),
                })
              : d
          ),
        })),

      addSideboardCard: (deckId, card, allocatedCopyId = null) => {
        const slotId = newId('slot');
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId
              ? touch({
                  ...d,
                  sideboard: [...d.sideboard, { slotId, card, allocatedCopyId }],
                })
              : d
          ),
        }));
        return slotId;
      },

      removeSideboardCard: (deckId, slotId) =>
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId
              ? touch({ ...d, sideboard: d.sideboard.filter((c) => c.slotId !== slotId) })
              : d
          ),
        })),

      moveBetweenZones: (deckId, slotId, from) =>
        set((s) => ({
          decks: s.decks.map((d) => {
            if (d.id !== deckId) return d;
            if (from === 'main') {
              const card = d.cards.find((c) => c.slotId === slotId);
              if (!card) return d;
              return touch({
                ...d,
                cards: d.cards.filter((c) => c.slotId !== slotId),
                sideboard: [...d.sideboard, card],
              });
            } else {
              const card = d.sideboard.find((c) => c.slotId === slotId);
              if (!card) return d;
              return touch({
                ...d,
                sideboard: d.sideboard.filter((c) => c.slotId !== slotId),
                cards: [...d.cards, card],
              });
            }
          }),
        })),

      setCommander: (deckId, card, allocated = null) =>
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId
              ? touch({ ...d, commander: card, commanderAllocatedCopyId: allocated })
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
                  partnerCommanderAllocatedCopyId: allocated,
                })
              : d
          ),
        })),

      updateCardPrinting: (deckId, slotId, card) =>
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId
              ? touch({
                  ...d,
                  cards: d.cards.map((c) =>
                    c.slotId === slotId ? { ...c, card, allocatedCopyId: null } : c
                  ),
                })
              : d
          ),
        })),

      replaceCards: (deckId, cards) =>
        set((s) => ({
          decks: s.decks.map((d) => (d.id === deckId ? touch({ ...d, cards }) : d)),
        })),

      remapAllocations: (newCollection) =>
        set((s) => {
          const allocated = new Map<string, AllocationInfo>();

          const remappedDecks = s.decks.map((deck) => {
            let commanderAllocatedCopyId = deck.commanderAllocatedCopyId;
            if (deck.commander) {
              const pick = pickCollectionCopy(
                deck.commander.name,
                newCollection,
                allocated,
                deck.commander.id
              );
              commanderAllocatedCopyId = pick?.copyId ?? null;
              if (pick) {
                allocated.set(pick.copyId, {
                  deckId: deck.id,
                  deckName: deck.name,
                  cardName: deck.commander.name,
                });
              }
            }

            let partnerCommanderAllocatedCopyId = deck.partnerCommanderAllocatedCopyId;
            if (deck.partnerCommander) {
              const pick = pickCollectionCopy(
                deck.partnerCommander.name,
                newCollection,
                allocated,
                deck.partnerCommander.id
              );
              partnerCommanderAllocatedCopyId = pick?.copyId ?? null;
              if (pick) {
                allocated.set(pick.copyId, {
                  deckId: deck.id,
                  deckName: deck.name,
                  cardName: deck.partnerCommander.name,
                });
              }
            }

            const cards = deck.cards.map((c) => {
              const pick = pickCollectionCopy(c.card.name, newCollection, allocated, c.card.id);
              if (pick) {
                allocated.set(pick.copyId, {
                  deckId: deck.id,
                  deckName: deck.name,
                  cardName: c.card.name,
                });
              }
              return { ...c, allocatedCopyId: pick?.copyId ?? null };
            });

            const sideboard = (deck.sideboard ?? []).map((c) => {
              const pick = pickCollectionCopy(c.card.name, newCollection, allocated, c.card.id);
              if (pick) {
                allocated.set(pick.copyId, {
                  deckId: deck.id,
                  deckName: deck.name,
                  cardName: c.card.name,
                });
              }
              return { ...c, allocatedCopyId: pick?.copyId ?? null };
            });

            return touch({
              ...deck,
              commanderAllocatedCopyId,
              partnerCommanderAllocatedCopyId,
              cards,
              sideboard,
            });
          });

          return { decks: remappedDecks };
        }),
    }),
    {
      name: 'mtg-decks',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
      partialize: (s) => ({ decks: s.decks }),
      /**
       * v1→v2: allocation tracking moved from `scryfallId` (which identifies a
       * printing) to `copyId` (which identifies a single physical card). Old
       * allocations point at scryfallIds that have no equivalent copyId in the
       * collection, so we clear them and let the user re-pick. Deck contents
       * are preserved.
       */
      migrate: (persistedState, fromVersion) => {
        const state = persistedState as Record<string, unknown> | undefined;
        if (!state) return state as never;
        if (fromVersion < 2 && Array.isArray(state.decks)) {
          state.decks = (state.decks as Array<Record<string, unknown>>).map((d) => {
            const {
              commanderAllocatedScryfallId: _c,
              partnerCommanderAllocatedScryfallId: _p,
              ...deckRest
            } = d as Record<string, unknown> & {
              commanderAllocatedScryfallId?: unknown;
              partnerCommanderAllocatedScryfallId?: unknown;
            };
            void _c;
            void _p;
            return {
              ...deckRest,
              commanderAllocatedCopyId: null,
              partnerCommanderAllocatedCopyId: null,
              cards: Array.isArray(d.cards)
                ? (d.cards as Array<Record<string, unknown>>).map((c) => {
                    const { allocatedScryfallId: _a, ...rest } = c as Record<string, unknown> & {
                      allocatedScryfallId?: unknown;
                    };
                    void _a;
                    return { ...rest, allocatedCopyId: null };
                  })
                : [],
            };
          });
        }
        if (fromVersion < 3 && Array.isArray(state.decks)) {
          state.decks = (state.decks as Array<Record<string, unknown>>).map((d) => ({
            ...d,
            format: d.format ?? 'commander',
            sideboard: d.sideboard ?? [],
          }));
        }
        return state as never;
      },
    }
  )
);

export function newDeckCard(card: ScryfallCard, allocatedCopyId: string | null = null): DeckCard {
  return { slotId: newId('slot'), card, allocatedCopyId };
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
