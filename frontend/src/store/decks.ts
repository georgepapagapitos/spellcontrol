import { create } from 'zustand';
import { isApplyingServer } from '../lib/applying-server';
import { isApplyingAnalysis } from '../lib/applying-analysis';
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
  pickCollectionCopy,
  compareCopyPreference,
  makeDeckAllocationInfo,
  type AllocationInfo,
} from '../lib/allocations';
import { createIndexedDbStorage } from '../lib/idb-storage';

const decksIdbStorage = createIndexedDbStorage('spellcontrol-decks');
import { pickRandomPresetColor } from './../lib/preset-colors';
import type { EnrichedCard } from '../types';
import { toast } from './toasts';
import { genId } from '../lib/id';

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
  /**
   * Legacy: user card tags from the retired radial-tagging feature. Nothing
   * reads or writes this anymore, but synced decks from older builds still
   * carry it — keep it typed so those rows round-trip untouched.
   */
  tags?: string[];
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
    /** Which generator built the deck — absent/'edhrec' for the default pipeline. */
    generationMode?: string;
    /** Mode-specific descriptor (art motif slug, or "year<=YYYY"). */
    generationModeDetail?: string;
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

  /**
   * `silent` skips the `updatedAt` bump — for background/derived writes
   * (grade/bracket/gap analysis) that aren't user edits, so viewing a deck
   * doesn't mark it "edited just now".
   */
  updateDeck(id: string, updates: Partial<Omit<Deck, 'id' | 'createdAt'>>, silent?: boolean): void;
  renameDeck(id: string, name: string): void;
  deleteDeck(id: string): void;
  /** Delete a set of decks in one shot (bulk-select), with a single undo toast. */
  deleteDecks(ids: string[]): void;
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

  /**
   * Swap the printing on a deck slot. Pass `allocatedCopyId` to bind a specific
   * physical copy (the caller resolves a free owned copy of the new printing);
   * omit it to leave the slot unallocated when the new printing isn't owned.
   */
  updateCardPrinting(
    deckId: string,
    slotId: string,
    card: ScryfallCard,
    allocatedCopyId?: string | null
  ): void;

  /** Replace the whole card list — used when committing a generated deck. */
  replaceCards(deckId: string, cards: DeckCard[]): void;

  /** Re-match all deck allocations against a new collection. Called when the
   *  collection is replaced so allocatedCopyIds stay valid. */
  remapAllocations(newCollection: EnrichedCard[]): void;
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
        const id = genId('deck');
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

      updateDeck: (id, updates, silent) =>
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === id ? (silent ? { ...d, ...updates } : touch({ ...d, ...updates })) : d
          ),
        })),

      renameDeck: (id, name) =>
        set((s) => ({
          decks: s.decks.map((d) => (d.id === id ? touch({ ...d, name }) : d)),
        })),

      deleteDeck: (id) => {
        // A deck is one whole synced row, so an undo is just re-inserting the
        // captured deck (a compensating upsert under LWW) — mirrors clearCards.
        const deck = useDecksStore.getState().decks.find((d) => d.id === id);
        if (!deck) return;
        set((s) => ({ decks: s.decks.filter((d) => d.id !== id) }));
        toast.show({
          message: `Deleted ${deck.name}`,
          tone: 'success',
          actionLabel: 'Undo',
          onAction: () => set((s) => ({ decks: [...s.decks, deck] })),
        });
      },

      deleteDecks: (ids) => {
        const idSet = new Set(ids);
        const removed = useDecksStore.getState().decks.filter((d) => idSet.has(d.id));
        if (removed.length === 0) return;
        set((s) => ({ decks: s.decks.filter((d) => !idSet.has(d.id)) }));
        toast.show({
          message: `Deleted ${removed.length} deck${removed.length === 1 ? '' : 's'}`,
          tone: 'success',
          actionLabel: 'Undo',
          // Re-insert the captured decks (compensating upserts under LWW),
          // keeping any decks created during the toast window.
          onAction: () => set((s) => ({ decks: [...removed, ...s.decks] })),
        });
      },

      deleteAllDecks: () => {
        const removed = useDecksStore.getState().decks;
        if (removed.length === 0) return;
        set({ decks: [] });
        toast.show({
          message: `Deleted ${removed.length} deck${removed.length === 1 ? '' : 's'}`,
          tone: 'success',
          actionLabel: 'Undo',
          // Keep any decks created during the toast window, then restore.
          onAction: () => set((s) => ({ decks: [...removed, ...s.decks] })),
        });
      },

      duplicateDeck: (id) => {
        const state = useDecksStore.getState();
        const original = state.decks.find((d) => d.id === id);
        if (!original) return null;
        const newDeckId = genId('deck');
        const now = Date.now();
        const copy: Deck = {
          ...original,
          id: newDeckId,
          name: `${original.name} (copy)`,
          commanderAllocatedCopyId: null,
          partnerCommanderAllocatedCopyId: null,
          cards: original.cards.map((c) => ({
            slotId: genId('slot'),
            card: c.card,
            allocatedCopyId: null,
          })),
          sideboard: original.sideboard.map((c) => ({
            slotId: genId('slot'),
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
        const slotId = genId('slot');
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
        const slotId = genId('slot');
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
        const slotId = genId('slot');
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

      updateCardPrinting: (deckId, slotId, card, allocatedCopyId = null) =>
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId
              ? touch({
                  ...d,
                  cards: d.cards.map((c) =>
                    c.slotId === slotId ? { ...c, card, allocatedCopyId } : c
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
            allocated.set(copyId, makeDeckAllocationInfo(deckId, deckName, deckColor, cardName));
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
              // `?? []` guards a partial/malformed persisted deck row (this now
              // also runs from sync.ts's rehydrate, which reads back whatever
              // shape actually landed in IDB) — must not crash on a missing array.
              cards: (deck.cards ?? []).map((c) => ({
                slotId: c.slotId,
                allocatedCopyId: c.allocatedCopyId,
              })),
              sideboard: (deck.sideboard ?? []).map((c) => ({
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
            for (const c of deck.cards ?? []) {
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
            // A slot's preferred printing is honored for every card, basics
            // included — special-art / foil basics (e.g. Secret Lair Mountains)
            // are a deliberate choice. Pass 3 below keeps the current binding
            // when no copy of the preferred printing is free, so this never
            // churns a generic basic the user owns only one printing of.
            const printingOk =
              !slot.scryfallId || (current ? current.scryfallId === slot.scryfallId : false);
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
            // No preferred printing → skip the printing-match upgrade and let
            // pass 3/4 distribute across whatever's free.
            if (!slot.scryfallId) {
              stillNeedsPick.push(slot);
              continue;
            }
            const byPrinting = freeByNameByPrinting.get(slot.cardName);
            const list = byPrinting?.get(slot.scryfallId);
            if (list && list.length > 0) {
              // Match pickCollectionCopy's secondary preferences: nonfoil > foil,
              // then cheapest. Same scryfallId means same printing, but finish
              // and price still vary.
              list.sort(compareCopyPreference);
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
              (deck.cards ?? []).some(
                (c, i) => u.cards[i]?.allocatedCopyId !== c.allocatedCopyId
              ) ||
              (deck.sideboard ?? []).some(
                (c, i) => u.sideboard[i]?.allocatedCopyId !== c.allocatedCopyId
              );
            if (!cardsChanged) return deck;
            return touch({
              ...deck,
              commanderAllocatedCopyId: u.commanderAllocatedCopyId,
              partnerCommanderAllocatedCopyId: u.partnerCommanderAllocatedCopyId,
              cards: (deck.cards ?? []).map((c, i) => ({
                ...c,
                allocatedCopyId: u.cards[i].allocatedCopyId,
              })),
              sideboard: (deck.sideboard ?? []).map((c, i) => ({
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
          // NOTE (E133): a self-heal used to run here too, but this hook is
          // dead weight — `partialize: () => ({})` below means nothing ever
          // writes to this legacy zustand-persist IDB anymore, and
          // `deleteLegacyDatabasesOnce()` (lib/sync.ts, called before every
          // boot's rehydrate) deletes the underlying `spellcontrol-decks` DB,
          // so `state.decks` here is always whatever the empty persisted blob
          // resolves to. Healing now happens once, centrally, in the
          // subscriber below — which also covers this path the moment
          // sync.ts's rehydrateStoresFromIdb sets real decks onto the store.
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
  return { slotId: genId('slot'), card, allocatedCopyId, addedAt: Date.now() };
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
 * Centralized allocation self-heal + sync subscriber (E133). EVERY write to
 * the decks array — a manual mutation, `remapAllocations`, deck-history
 * undo/redo replay (`replaceDeck`), the cross-deck-move undo path, delete-deck
 * undo, or a cross-device sync rehydrate (`rehydrateStoresFromIdb` in
 * lib/sync.ts, which sets two independent per-row LWW deck blobs onto the
 * store with no cross-deck dedupe) — funnels through zustand's `setState`,
 * so this one subscriber is the single chokepoint that enforces "no copyId is
 * claimed by two deck slots" by construction, instead of every call site
 * running `dedupeDeckAllocations` for itself. It's pure and reference-stable
 * (returns the SAME `decks` array when nothing was contested), so re-running
 * it after its own heal is a no-op and this cannot loop.
 *
 * applyingServer reasoning: a heal is a genuine LOCAL correction (not
 * server-sourced data we're just mirroring), so unlike a normal server-applied
 * change it SHOULD be pushed back — otherwise the fix never reaches the
 * device that still has the stale double-claim, and it keeps resurrecting.
 * But this subscriber fires *synchronously inside* `rehydrateStoresFromIdb`'s
 * `setState` call, before `setApplyingServer(false)` runs in its `finally`
 * (which only happens once that `setState` call returns) — so healing
 * synchronously here would see `isApplyingServer()` still true and the push
 * below would wrongly treat it as server data to skip. Deferring one
 * microtask sidesteps that: the `finally` is synchronous and runs before any
 * microtask can, so by the time the deferred heal's own `setState` fires,
 * the guard is down and it falls through to the normal push path.
 */
useDecksStore.subscribe((state, prev) => {
  if (state.decks === prev.decks) return;

  const { decks: healed, changed } = dedupeDeckAllocations(state.decks);
  if (changed) {
    if (isApplyingServer()) {
      queueMicrotask(() => {
        const resolved = dedupeDeckAllocations(useDecksStore.getState().decks);
        if (resolved.changed) useDecksStore.setState({ decks: resolved.decks });
      });
    } else {
      useDecksStore.setState({ decks: healed });
    }
    return;
  }

  // Synchronous guards — see store/collection.ts for why the async-import check
  // was too late and let pulled state re-persist.
  if (isApplyingServer()) return;
  // Analysis writes (bracket/grade/gap) are derived/cached data — skip sync so
  // merely opening a deck doesn't enqueue a full persistDecksState for all decks.
  if (isApplyingAnalysis()) return;
  void import('../lib/sync').then((sync) => sync.persistDecksState(state.decks)).catch(() => {});
});
