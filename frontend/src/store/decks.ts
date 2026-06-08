import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  ScryfallCard,
  ThemeResult,
  DeckFormat,
  GapAnalysisCard,
  BuildReport,
} from '@/deck-builder/types';
import type { BracketEstimation } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import type { BracketFitPlan } from '@/deck-builder/services/deckBuilder/bracketFit';
import type { PlanScore } from '@/deck-builder/services/deckBuilder/planScore';
import type { OptimizeSwaps } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import type { CostPlan } from '@/deck-builder/services/deckBuilder/costAnalyzer';
import type { SynergyAnalysis } from '@/deck-builder/services/synergy/analysis';
import type { WinConditionAnalysis } from '@/deck-builder/services/winConditions/types';
import {
  dedupeDeckAllocations,
  isBasicLandName,
  pickCollectionCopy,
  type AllocationInfo,
} from '../lib/allocations';
import { createIndexedDbStorage } from '../lib/idb-storage';

const decksIdbStorage = createIndexedDbStorage('spellcontrol-decks');
import { pickRandomPresetColor } from './../lib/preset-colors';
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
  /** Unix ms timestamp when this slot was added. Absent on cards added before this field existed. */
  addedAt?: number;
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
    /** Build-time power-level target (EDHREC card-pool filter). */
    targetBracket: number | 'all';
    landCount: number;
    collectionMode: boolean;
  } | null;
  /**
   * Optional generator-derived stats. Only present on freshly generated decks
   * (and only when the tagger data file was reachable at build time). These
   * are snapshotted at generation and never recomputed — manual edits will
   * leave them slightly stale, but the toolbar still surfaces totals from
   * the live card list.
   *
   * NOTE: `bracketEstimation`/`deckGrade` below are the exception — they are
   * kept *live* for any commander deck by useCommanderBracketAnalysis (see
   * `gradeBracketSignature`), so they do recompute as cards change.
   */
  roleCounts?: Record<string, number>;
  rampSubtypeCounts?: Record<string, number>;
  removalSubtypeCounts?: Record<string, number>;
  boardwipeSubtypeCounts?: Record<string, number>;
  cardDrawSubtypeCounts?: Record<string, number>;
  bracketEstimation?: BracketEstimation;
  /**
   * Target role counts ("wanted N ramp") the analysis compares actuals against.
   * Kept live by useCommanderBracketAnalysis (recomputed as cards change), like
   * bracketEstimation — not a frozen generation snapshot.
   */
  roleTargets?: Record<string, number>;
  /**
   * Ranked "cards to consider" — owned/unowned upgrade candidates from EDHREC
   * not already in the deck. Recomputed live alongside the analysis.
   */
  gapAnalysis?: GapAnalysisCard[];
  /**
   * Per-card EDHREC inclusion % (cardName → 0-100) for cards in this deck —
   * powers the "why this card" rationale on rows/preview. Recomputed live by
   * the analysis hook, like roleTargets/gapAnalysis.
   */
  cardInclusionMap?: Record<string, number>;
  /**
   * 0-100 PlanScore (4 weighted dimensions: strategy/roles/curve/cardFit) with
   * its sub-scores. Kept live by useCommanderBracketAnalysis (recomputed as
   * cards change), like roleTargets/gapAnalysis — not a generation snapshot.
   */
  planScore?: PlanScore;
  /**
   * Balanced cut/add optimize suggestions (the "Optimize" surface). Kept live
   * by useCommanderBracketAnalysis like roleTargets/gapAnalysis/planScore.
   */
  optimizeSwaps?: OptimizeSwaps;
  /**
   * Budget downgrade suggestions (cheaper role-equivalents, USD-canonical).
   * Kept live by useCommanderBracketAnalysis like optimizeSwaps.
   */
  costPlan?: CostPlan;
  /**
   * Native synergy engine analysis (producer↔payoff balance + off-meta
   * suggestions). Kept live by useCommanderBracketAnalysis like optimizeSwaps.
   */
  synergyAnalysis?: SynergyAnalysis;
  /**
   * Win-condition detection (primary + secondary paths). Kept live by
   * useCommanderBracketAnalysis like synergyAnalysis.
   */
  winConditions?: WinConditionAnalysis;
  /**
   * How the generated deck measured up to its build intent (fill + flag).
   * Set once at generation; generated decks only. See {@link BuildReport}.
   */
  buildReport?: BuildReport;
  deckGrade?: { letter: string; headline: string };
  /**
   * User-pinned bracket (1–5), self-declared like the official Commander
   * bracket system. When set it wins over the auto `bracketEstimation` for
   * every surface (see {@link effectiveBracket}); the auto estimate is still
   * kept and shown as a secondary reference. `null`/absent means "use auto".
   */
  bracketOverride?: 1 | 2 | 3 | 4 | 5 | null;
  /**
   * Bracket Fit coaching plan — concrete card moves to reach the user's target
   * bracket. Computed (and kept live) by useCommanderBracketAnalysis only when
   * `bracketOverride` is set; folded into the deck signature so it recomputes
   * when the target changes as well as when cards change. `null`/absent means no
   * target set, a non-commander deck, or no estimation yet. When the deck is
   * `aligned` (estimate === target) the plan still carries a `direction` of
   * `'aligned'` with no moves so the panel can show its confirmation.
   */
  bracketFit?: BracketFitPlan | null;
  /**
   * Hash of the inputs (commander + mainboard card names) the persisted
   * deckGrade/bracketEstimation were last computed from. Set for any commander
   * deck once its grade/bracket has been computed; the analysis hook recomputes
   * (and updates this) whenever the signature changes, so the estimate stays
   * live as cards are added/removed — generated and manual decks alike.
   */
  gradeBracketSignature?: string;
  /** Mean EDHREC salt score across non-land cards. Snapshotted at generation. */
  averageSalt?: number;
  saltiestCards?: Array<{ name: string; salt: number }>;
  /**
   * Provenance for decks materialized from a known MTG product (T17) — e.g. a
   * preconstructed Commander deck imported by search. Absent for hand-built or
   * generated decks. `source` stays `'manual'`; this is an additive tag.
   */
  sourceProduct?: { code: string; fileName: string; name: string };
  /** User-chosen accent color (hex). Defaults to a random preset on create. */
  color: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * The bracket to show for a deck everywhere it surfaces: the user's manual
 * override when set, otherwise the live auto estimate. Returns undefined when
 * neither exists (no override and the estimate hasn't been computed yet).
 */
export function effectiveBracket(
  deck: Pick<Deck, 'bracketOverride' | 'bracketEstimation'>
): number | undefined {
  return deck.bracketOverride ?? deck.bracketEstimation?.bracket;
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
    color?: string;
    generationContext?: Deck['generationContext'];
    roleCounts?: Record<string, number>;
    rampSubtypeCounts?: Record<string, number>;
    removalSubtypeCounts?: Record<string, number>;
    boardwipeSubtypeCounts?: Record<string, number>;
    cardDrawSubtypeCounts?: Record<string, number>;
    bracketEstimation?: BracketEstimation;
    roleTargets?: Record<string, number>;
    gapAnalysis?: GapAnalysisCard[];
    cardInclusionMap?: Record<string, number>;
    buildReport?: BuildReport;
    deckGrade?: { letter: string; headline: string };
    bracketOverride?: 1 | 2 | 3 | 4 | 5 | null;
    gradeBracketSignature?: string;
    averageSalt?: number;
    saltiestCards?: Array<{ name: string; salt: number }>;
    sourceProduct?: { code: string; fileName: string; name: string };
  }): string;

  updateDeck(id: string, updates: Partial<Omit<Deck, 'id' | 'createdAt'>>): void;
  renameDeck(id: string, name: string): void;
  deleteDeck(id: string): void;
  /** Delete every deck. Used by the admin "Wipe all decks" button. */
  deleteAllDecks(): void;
  /** Deep-clone a deck. Allocations reset — the original still claims those copies. */
  duplicateDeck(id: string): string | null;

  addCard(deckId: string, card: ScryfallCard, allocatedCopyId?: string | null): string;
  removeCard(deckId: string, slotId: string): void;
  setCardAllocation(deckId: string, slotId: string, allocatedCopyId: string | null): void;

  /**
   * Atomic mainboard swap: remove the slot `outSlotId` and add `inCard` in a
   * single state update (one `set()` → one persisted row), so the deck never
   * passes through a transient "card removed" state that a debounced push or a
   * peer-tab pull could observe mid-swap. Returns the new slot's id. No-op
   * (returns '') if the deck or the out-slot is gone.
   */
  swapCard(
    deckId: string,
    outSlotId: string,
    inCard: ScryfallCard,
    allocatedCopyId?: string | null
  ): string;

  /**
   * Replace a deck wholesale with a prior snapshot. Used only by the undo/redo
   * history (`store/deck-history.ts`) to restore a before/after snapshot — the
   * resulting upsert wins under last-write-wins, which is how an undo's
   * compensating mutation rides the normal sync queue. No-op if the id is gone.
   */
  replaceDeck(deckId: string, deck: Deck): void;

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
          roleTargets: input.roleTargets,
          gapAnalysis: input.gapAnalysis,
          cardInclusionMap: input.cardInclusionMap,
          buildReport: input.buildReport,
          deckGrade: input.deckGrade,
          bracketOverride: input.bracketOverride ?? null,
          gradeBracketSignature: input.gradeBracketSignature,
          averageSalt: input.averageSalt,
          saltiestCards: input.saltiestCards,
          sourceProduct: input.sourceProduct,
          color: input.color ?? pickRandomPresetColor(),
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

      deleteDeck: (id) => {
        set((s) => ({ decks: s.decks.filter((d) => d.id !== id) }));
      },

      deleteAllDecks: () => {
        set({ decks: [] });
      },

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
                  cards: [...d.cards, { slotId, card, allocatedCopyId, addedAt: Date.now() }],
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

      swapCard: (deckId, outSlotId, inCard, allocatedCopyId = null) => {
        const slotId = newId('slot');
        let applied = false;
        set((s) => ({
          decks: s.decks.map((d) => {
            if (d.id !== deckId) return d;
            if (!d.cards.some((c) => c.slotId === outSlotId)) return d;
            applied = true;
            return touch({
              ...d,
              cards: [
                ...d.cards.filter((c) => c.slotId !== outSlotId),
                { slotId, card: inCard, allocatedCopyId, addedAt: Date.now() },
              ],
            });
          }),
        }));
        return applied ? slotId : '';
      },

      replaceDeck: (deckId, deck) =>
        set((s) => ({
          decks: s.decks.map((d) => (d.id === deckId ? touch({ ...deck, id: d.id }) : d)),
        })),

      addSideboardCard: (deckId, card, allocatedCopyId = null) => {
        const slotId = newId('slot');
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId
              ? touch({
                  ...d,
                  sideboard: [
                    ...d.sideboard,
                    { slotId, card, allocatedCopyId, addedAt: Date.now() },
                  ],
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
          // Stability rule: if a slot's current allocatedCopyId still exists
          // in the new collection and isn't already claimed by an earlier slot,
          // keep it. Only re-pick when the prior binding is truly broken
          // (copy was deleted or got stolen by an earlier slot in this pass).
          //
          // This is what makes "card in deck = card in binder" stay consistent
          // across reloads, imports, and edits: we don't reshuffle bindings
          // the user (or a prior allocation) already established.
          const byCopyId = new Map<string, EnrichedCard>();
          for (const c of newCollection) byCopyId.set(c.copyId, c);

          const allocated = new Map<string, AllocationInfo>();
          const claim = (
            copyId: string,
            deckId: string,
            deckName: string,
            deckColor: string,
            cardName: string
          ): void => {
            allocated.set(copyId, { deckId, deckName, deckColor, cardName });
          };

          // Two passes: first preserve every still-valid binding so they get
          // first dibs, then fill in the gaps. Otherwise a deck earlier in
          // the array could pick up a copy that a later deck had a stable
          // binding to.
          interface SlotRef {
            deckId: string;
            deckName: string;
            deckColor: string;
            cardName: string;
            scryfallId: string | undefined;
            currentCopyId: string | null;
            apply: (copyId: string | null) => void;
          }
          const slots: SlotRef[] = [];

          // Snapshot mutations into placeholders first; apply at the end.
          const updates = new Map<
            string,
            {
              commanderAllocatedCopyId: string | null;
              partnerCommanderAllocatedCopyId: string | null;
              cards: { slotId: string; allocatedCopyId: string | null }[];
              sideboard: { slotId: string; allocatedCopyId: string | null }[];
            }
          >();
          for (const deck of s.decks) {
            updates.set(deck.id, {
              commanderAllocatedCopyId: deck.commanderAllocatedCopyId,
              partnerCommanderAllocatedCopyId: deck.partnerCommanderAllocatedCopyId,
              cards: deck.cards.map((c) => ({
                slotId: c.slotId,
                allocatedCopyId: c.allocatedCopyId,
              })),
              sideboard: deck.sideboard.map((c) => ({
                slotId: c.slotId,
                allocatedCopyId: c.allocatedCopyId,
              })),
            });
          }

          for (const deck of s.decks) {
            const u = updates.get(deck.id)!;
            if (deck.commander) {
              slots.push({
                deckId: deck.id,
                deckName: deck.name,
                deckColor: deck.color,
                cardName: deck.commander.name,
                scryfallId: deck.commander.id,
                currentCopyId: deck.commanderAllocatedCopyId,
                apply: (copyId) => {
                  u.commanderAllocatedCopyId = copyId;
                },
              });
            }
            if (deck.partnerCommander) {
              slots.push({
                deckId: deck.id,
                deckName: deck.name,
                deckColor: deck.color,
                cardName: deck.partnerCommander.name,
                scryfallId: deck.partnerCommander.id,
                currentCopyId: deck.partnerCommanderAllocatedCopyId,
                apply: (copyId) => {
                  u.partnerCommanderAllocatedCopyId = copyId;
                },
              });
            }
            for (const c of deck.cards) {
              const slotId = c.slotId;
              slots.push({
                deckId: deck.id,
                deckName: deck.name,
                deckColor: deck.color,
                cardName: c.card.name,
                scryfallId: c.card.id,
                currentCopyId: c.allocatedCopyId,
                apply: (copyId) => {
                  const target = u.cards.find((x) => x.slotId === slotId);
                  if (target) target.allocatedCopyId = copyId;
                },
              });
            }
            for (const c of deck.sideboard ?? []) {
              const slotId = c.slotId;
              slots.push({
                deckId: deck.id,
                deckName: deck.name,
                deckColor: deck.color,
                cardName: c.card.name,
                scryfallId: c.card.id,
                currentCopyId: c.allocatedCopyId,
                apply: (copyId) => {
                  const target = u.sideboard.find((x) => x.slotId === slotId);
                  if (target) target.allocatedCopyId = copyId;
                },
              });
            }
          }

          // Index free copies by name → scryfallId → list, so pass 2 can
          // cheaply ask "is there a free copy of name N with printing P?"
          // without rescanning the whole collection per slot.
          const freeByNameByPrinting = new Map<string, Map<string, EnrichedCard[]>>();
          for (const c of newCollection) {
            if (allocated.has(c.copyId)) continue;
            let byPrinting = freeByNameByPrinting.get(c.name);
            if (!byPrinting) {
              byPrinting = new Map();
              freeByNameByPrinting.set(c.name, byPrinting);
            }
            const list = byPrinting.get(c.scryfallId) ?? [];
            list.push(c);
            byPrinting.set(c.scryfallId, list);
          }
          const removeFromFree = (copy: EnrichedCard): void => {
            const byPrinting = freeByNameByPrinting.get(copy.name);
            if (!byPrinting) return;
            const list = byPrinting.get(copy.scryfallId);
            if (!list) return;
            const idx = list.indexOf(copy);
            if (idx >= 0) list.splice(idx, 1);
            if (list.length === 0) byPrinting.delete(copy.scryfallId);
            if (byPrinting.size === 0) freeByNameByPrinting.delete(copy.name);
          };

          // Pass 1 — exact preserve: keep the current binding when the copy
          // exists, still has the same name, and (if the slot expresses a
          // preferred printing) the current copy is that printing. This is
          // the strongest signal of "the user already chose this," so it
          // gets first dibs on copies.
          const needsPick: SlotRef[] = [];
          for (const slot of slots) {
            const current = slot.currentCopyId ? byCopyId.get(slot.currentCopyId) : undefined;
            // Basic lands are fungible — any printing satisfies the slot's
            // preference, so the current binding is "OK" regardless of
            // scryfallId. Without this, every basic-land slot churns to
            // whatever printing pass 2 happens to find first.
            const printingOk =
              !slot.scryfallId ||
              isBasicLandName(slot.cardName) ||
              (current ? current.scryfallId === slot.scryfallId : false);
            if (
              slot.currentCopyId &&
              current &&
              current.name === slot.cardName &&
              printingOk &&
              !allocated.has(slot.currentCopyId)
            ) {
              claim(slot.currentCopyId, slot.deckId, slot.deckName, slot.deckColor, slot.cardName);
              removeFromFree(current);
            } else {
              needsPick.push(slot);
            }
          }

          // Pass 2 — printing upgrade: a slot bound to a wrong-printing copy
          // (or unbound) gets a free same-printing copy if one exists. This
          // is the corrective step that unsticks the basic-lands case where
          // pre-fix randomness left slots on whatever Plains was cheap.
          const stillNeedsPick: SlotRef[] = [];
          for (const slot of needsPick) {
            // No preferred printing or basic land → skip the printing-match
            // upgrade and let pass 3/4 distribute across whatever's free.
            if (!slot.scryfallId || isBasicLandName(slot.cardName)) {
              stillNeedsPick.push(slot);
              continue;
            }
            const byPrinting = freeByNameByPrinting.get(slot.cardName);
            const list = byPrinting?.get(slot.scryfallId);
            if (list && list.length > 0) {
              // Match pickCollectionCopy's secondary preferences: nonfoil > foil,
              // then cheapest. Same scryfallId means same printing, but finish
              // and price still vary.
              list.sort((a, b) => {
                const finishRank = { nonfoil: 0, foil: 1, etched: 2 } as const;
                const aRank = finishRank[a.finish] ?? (a.foil ? 1 : 0);
                const bRank = finishRank[b.finish] ?? (b.foil ? 1 : 0);
                if (aRank !== bRank) return aRank - bRank;
                return (a.purchasePrice ?? 0) - (b.purchasePrice ?? 0);
              });
              const pick = list[0];
              claim(pick.copyId, slot.deckId, slot.deckName, slot.deckColor, slot.cardName);
              removeFromFree(pick);
              slot.apply(pick.copyId);
            } else {
              stillNeedsPick.push(slot);
            }
          }

          // Pass 3 — preserve fallback: no matching-printing copy was free, but
          // the current binding (wrong printing) is still a valid name match.
          // Keep it rather than churning to a different wrong-printing copy.
          const needsFreshPick: SlotRef[] = [];
          for (const slot of stillNeedsPick) {
            const current = slot.currentCopyId ? byCopyId.get(slot.currentCopyId) : undefined;
            if (
              slot.currentCopyId &&
              current &&
              current.name === slot.cardName &&
              !allocated.has(slot.currentCopyId)
            ) {
              claim(slot.currentCopyId, slot.deckId, slot.deckName, slot.deckColor, slot.cardName);
              removeFromFree(current);
            } else {
              needsFreshPick.push(slot);
            }
          }

          // Pass 4 — fresh pick: anything left has no usable current binding
          // and no preferred printing available; fall back to pickCollectionCopy's
          // name-only heuristic (cheapest non-foil).
          for (const slot of needsFreshPick) {
            const pick = pickCollectionCopy(
              slot.cardName,
              newCollection,
              allocated,
              slot.scryfallId
            );
            if (pick) {
              claim(pick.copyId, slot.deckId, slot.deckName, slot.deckColor, slot.cardName);
              removeFromFree(pick);
              slot.apply(pick.copyId);
            } else {
              slot.apply(null);
            }
          }

          const remappedDecks = s.decks.map((deck) => {
            const u = updates.get(deck.id)!;
            const cardsChanged =
              u.commanderAllocatedCopyId !== deck.commanderAllocatedCopyId ||
              u.partnerCommanderAllocatedCopyId !== deck.partnerCommanderAllocatedCopyId ||
              deck.cards.some((c, i) => u.cards[i]?.allocatedCopyId !== c.allocatedCopyId) ||
              deck.sideboard.some((c, i) => u.sideboard[i]?.allocatedCopyId !== c.allocatedCopyId);
            if (!cardsChanged) return deck;
            return touch({
              ...deck,
              commanderAllocatedCopyId: u.commanderAllocatedCopyId,
              partnerCommanderAllocatedCopyId: u.partnerCommanderAllocatedCopyId,
              cards: deck.cards.map((c, i) => ({
                ...c,
                allocatedCopyId: u.cards[i].allocatedCopyId,
              })),
              sideboard: deck.sideboard.map((c, i) => ({
                ...c,
                allocatedCopyId: u.sideboard[i].allocatedCopyId,
              })),
            });
          });

          // Belt-and-suspenders: the 4 passes above already enforce
          // first-claim-wins via `allocated`, but funnel the result through
          // the shared dedupe so the no-double-claim invariant holds by
          // construction (and stays green if the pass logic ever regresses).
          return { decks: dedupeDeckAllocations(remappedDecks).decks };
        }),
    }),
    {
      name: 'mtg-decks',
      version: 5,
      storage: createJSONStorage(() => decksIdbStorage),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.hydrated = true;
          // Self-heal a persisted cross-deck double-claim from a prior session
          // (introduced by a manual allocation mutation or generated-deck save,
          // which — unlike collection replace — never ran the remap). Pure and
          // collection-independent, so it is safe here even though the
          // collection store hydrates separately.
          state.decks = dedupeDeckAllocations(state.decks).decks;
        }
      },
      // Synced data lives in entity-store now and is rehydrated by `lib/sync.ts`.
      // Persist nothing so zustand-persist no longer races with the sync-driven
      // rehydrate on boot. The persist middleware stays in place so legacy
      // `migrate` continues to run on the old IDB rows during the one boot
      // before `deleteLegacyDatabasesOnce()` removes the `spellcontrol-decks`
      // DB out from under it.
      partialize: () => ({}),
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
        if (fromVersion < 4 && Array.isArray(state.decks)) {
          state.decks = (state.decks as Array<Record<string, unknown>>).map((d) => ({
            ...d,
            color: typeof d.color === 'string' ? d.color : pickRandomPresetColor(),
          }));
        }
        // v4→v5: generationContext.bracketLevel → targetBracket. The renamed
        // field is the EDHREC card-pool filter (build-time target), now
        // distinguished from the computed bracket estimation in
        // bracketEstimation.bracket. Preserves prior value verbatim.
        if (fromVersion < 5 && Array.isArray(state.decks)) {
          state.decks = (state.decks as Array<Record<string, unknown>>).map((d) => {
            const gc = d.generationContext as Record<string, unknown> | null | undefined;
            if (!gc || typeof gc !== 'object') return d;
            if (!('bracketLevel' in gc)) return d;
            const { bracketLevel, ...rest } = gc as { bracketLevel: unknown } & Record<
              string,
              unknown
            >;
            return {
              ...d,
              generationContext: { ...rest, targetBracket: bracketLevel },
            };
          });
        }
        return state as never;
      },
    }
  )
);

export function newDeckCard(card: ScryfallCard, allocatedCopyId: string | null = null): DeckCard {
  return { slotId: newId('slot'), card, allocatedCopyId, addedAt: Date.now() };
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

/**
 * Sync subscriber: every in-memory change to the decks array flows through
 * the per-row sync layer. See store/collection.ts for the broader pattern.
 */
useDecksStore.subscribe((state, prev) => {
  if (state.decks === prev.decks) return;
  void import('../lib/sync')
    .then((sync) => {
      if (sync.isApplyingServer()) return;
      return sync.persistDecksState(state.decks);
    })
    .catch(() => {});
});
