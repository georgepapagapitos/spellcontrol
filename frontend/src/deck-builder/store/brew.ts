// Brew mode's session state — deliberately a SEPARATE store from
// useDeckBuilderStore (frontend/src/deck-builder/store/index.ts). That store
// is being edited concurrently by a sibling PR (Customization type + its
// defaults); a plain reducer-style slice here avoids any merge risk and
// mirrors the same `create<T>((set, get) => ...)` shape as the main store.
// Brew mode still READS the main store (commander, colorIdentity,
// customization.landCount, selectedThemes) from the page — it just doesn't
// own or mutate any of that.
import { create } from 'zustand';
import { logger } from '@/lib/logger';
import type { EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import { fetchCommanderData, fetchCommanderThemeData } from '@/deck-builder/services/edhrec/client';
import {
  searchCards,
  commanderSearchIdentity,
  getCardsByNames,
} from '@/deck-builder/services/scryfall/client';
import { generateLands } from '@/deck-builder/services/deckBuilder/landGenerator';
import {
  buildBrewSlotPlan,
  computeBrewRoleTargets,
  flattenAccepted,
  pickBrewCandidates,
  type BrewCandidate,
  type BrewSlotDef,
  type BrewSlotKey,
} from '@/deck-builder/services/deckBuilder/brewSlots';

const HAND_SIZE = 6;
const DRAFT_KEY = 'spellcontrol.brewDraft.v1';

type Phase = 'brewing' | 'manabase';

export interface BrewDraft {
  commanderName: string;
  colorIdentity: string[];
  themeLabel: string | null;
  themeSlug: string | null;
  deckFormatSize: number;
  landCountTarget: number;
  nonBasicLandTarget: number;
  nonlandTotal: number;
  slots: BrewSlotDef[];
  slotIndex: number;
  accepted: Record<string, BrewCandidate[]>;
  savedAt: number;
}

function saveDraft(state: BrewState): void {
  if (!state.commanderName) return;
  const draft: BrewDraft = {
    commanderName: state.commanderName,
    colorIdentity: state.colorIdentity,
    themeLabel: state.themeLabel,
    themeSlug: state.themeSlug,
    deckFormatSize: state.deckFormatSize,
    landCountTarget: state.landCountTarget,
    nonBasicLandTarget: state.nonBasicLandTarget,
    nonlandTotal: state.nonlandTotal,
    slots: state.slots,
    slotIndex: state.slotIndex,
    accepted: state.accepted,
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (err) {
    logger.warn('[Brew] Failed to persist draft:', err);
  }
}

/** Peek the persisted draft (for a "resume your brew?" banner) without
 * touching the store — the page needs `commanderName`/`themeSlug` from it to
 * refetch EDHREC data before handing it to `resumeFromDraft`. */
export function peekBrewDraft(): BrewDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BrewDraft;
  } catch {
    return null;
  }
}

export function clearBrewDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // best-effort
  }
}

/** Recompute the flex slot's target live: whatever's left of the nonland
 * budget once every other slot's actual accepted count is known — so a
 * skipped/under-filled role naturally leaves more room in flex, and an
 * over-filled one leaves less. */
function recomputeFlexTarget(
  slots: BrewSlotDef[],
  accepted: Record<string, BrewCandidate[]>,
  nonlandTotal: number
): BrewSlotDef[] {
  const otherAccepted = slots
    .filter((s) => s.key !== 'flex')
    .reduce((sum, s) => sum + (accepted[s.key]?.length ?? 0), 0);
  return slots.map((s) =>
    s.key === 'flex' ? { ...s, target: Math.max(0, nonlandTotal - otherAccepted) } : s
  );
}

export interface BrewState {
  active: boolean;
  phase: Phase;

  commanderName: string | null;
  colorIdentity: string[];
  themeLabel: string | null;
  themeSlug: string | null;
  deckFormatSize: number;
  landCountTarget: number;
  nonBasicLandTarget: number;
  nonlandTotal: number;

  edhrecData: EDHRECCommanderData | null;
  collectionNames: Set<string>;

  slots: BrewSlotDef[];
  slotIndex: number;
  accepted: Record<string, BrewCandidate[]>;
  excluded: Set<string>;
  handOffset: number;
  hand: BrewCandidate[];

  searchQuery: string;
  searchResults: BrewCandidate[] | null;
  searchLoading: boolean;
  searchError: string | null;

  loading: boolean;
  error: string | null;

  landPlan: ScryfallCard[] | null;
  landPlanLoading: boolean;
  landPlanError: string | null;
  resolvedNonlandCards: ScryfallCard[];

  start(opts: {
    commander: ScryfallCard;
    colorIdentity: string[];
    themeLabel: string | null;
    themeSlug: string | null;
    deckFormatSize: number;
    landCountTarget: number;
    nonBasicLandTarget: number;
    collectionNames: Set<string>;
  }): Promise<void>;
  resumeFromDraft(
    draft: BrewDraft,
    edhrecData: EDHRECCommanderData,
    collectionNames: Set<string>
  ): void;

  loadHand(): void;
  showMore(): void;
  goToSlot(index: number): void;
  accept(candidate: BrewCandidate): void;
  pass(name: string): void;
  reconsider(slotKey: BrewSlotKey, name: string): void;
  fillRest(): void;
  nextSlot(): Promise<void>;
  prevSlot(): void;

  search(query: string): Promise<void>;
  clearSearch(): void;

  setLandCountTarget(n: number): Promise<void>;
  goToManabase(): Promise<void>;

  reset(): void;
}

const initialState = {
  active: false,
  phase: 'brewing' as Phase,
  commanderName: null,
  colorIdentity: [],
  themeLabel: null,
  themeSlug: null,
  deckFormatSize: 99,
  landCountTarget: 37,
  nonBasicLandTarget: 15,
  nonlandTotal: 62,
  edhrecData: null,
  collectionNames: new Set<string>(),
  slots: [] as BrewSlotDef[],
  slotIndex: 0,
  accepted: {} as Record<string, BrewCandidate[]>,
  excluded: new Set<string>(),
  handOffset: 0,
  hand: [] as BrewCandidate[],
  searchQuery: '',
  searchResults: null,
  searchLoading: false,
  searchError: null,
  loading: false,
  error: null,
  landPlan: null,
  landPlanLoading: false,
  landPlanError: null,
  resolvedNonlandCards: [] as ScryfallCard[],
};

export const useBrewStore = create<BrewState>((set, get) => ({
  ...initialState,

  loadHand() {
    const state = get();
    const slot = state.slots[state.slotIndex];
    if (!slot || !state.edhrecData) {
      set({ hand: [] });
      return;
    }
    const ranked = pickBrewCandidates(
      state.edhrecData.cardlists.allNonLand,
      slot.key,
      state.excluded,
      state.collectionNames,
      state.handOffset + HAND_SIZE
    );
    set({ hand: ranked.slice(state.handOffset) });
  },

  async start(opts) {
    set({
      ...initialState,
      loading: true,
      error: null,
      commanderName: opts.commander.name,
      colorIdentity: opts.colorIdentity,
      themeLabel: opts.themeLabel,
      themeSlug: opts.themeSlug,
      deckFormatSize: opts.deckFormatSize,
      landCountTarget: opts.landCountTarget,
      nonBasicLandTarget: opts.nonBasicLandTarget,
      collectionNames: opts.collectionNames,
    });
    try {
      const edhrecData = opts.themeSlug
        ? await fetchCommanderThemeData(opts.commander.name, opts.themeSlug)
        : await fetchCommanderData(opts.commander.name);
      const nonlandTotal = Math.max(0, opts.deckFormatSize - opts.landCountTarget);
      const roleTargets = computeBrewRoleTargets(edhrecData, nonlandTotal);
      const slots = buildBrewSlotPlan({
        roleTargets,
        nonlandTotal,
        hasTheme: !!opts.themeLabel,
        themeLabel: opts.themeLabel ?? undefined,
      });
      const accepted: Record<string, BrewCandidate[]> = {};
      for (const s of slots) accepted[s.key] = [];
      set({
        edhrecData,
        nonlandTotal,
        slots,
        accepted,
        active: true,
        loading: false,
      });
      get().loadHand();
      saveDraft(get());
    } catch (err) {
      logger.warn('[Brew] Failed to start brew session:', err);
      set({ loading: false, error: 'Could not load EDHREC data for this commander. Try again?' });
    }
  },

  resumeFromDraft(draft, edhrecData, collectionNames) {
    try {
      // Passed-but-not-accepted names aren't persisted (only the accepted
      // list is) — a card you passed on can resurface after a resume.
      const excluded = new Set<string>();
      for (const cards of Object.values(draft.accepted)) {
        for (const c of cards) excluded.add(c.name);
      }
      set({
        ...initialState,
        active: true,
        commanderName: draft.commanderName,
        colorIdentity: draft.colorIdentity,
        themeLabel: draft.themeLabel,
        themeSlug: draft.themeSlug,
        deckFormatSize: draft.deckFormatSize,
        landCountTarget: draft.landCountTarget,
        nonBasicLandTarget: draft.nonBasicLandTarget,
        nonlandTotal: draft.nonlandTotal,
        edhrecData,
        collectionNames,
        slots: draft.slots,
        slotIndex: draft.slotIndex,
        accepted: draft.accepted,
        excluded,
      });
      get().loadHand();
    } catch (err) {
      logger.warn('[Brew] Failed to resume draft:', err);
      clearBrewDraft();
    }
  },

  showMore() {
    set((s) => ({ handOffset: s.handOffset + HAND_SIZE }));
    get().loadHand();
  },

  /** Progress-rail chip navigation — jump back to a slot already visited to
   * reconsider it. Doesn't jump forward (that's `nextSlot`'s job, which also
   * handles the flex-target recompute and the manabase handoff). */
  goToSlot(index) {
    set((s) => ({
      slotIndex: Math.max(0, Math.min(index, s.slotIndex)),
      handOffset: 0,
      searchResults: null,
      searchQuery: '',
    }));
    get().loadHand();
  },

  accept(candidate) {
    set((s) => {
      const slotKey = s.slots[s.slotIndex]?.key;
      if (!slotKey) return s;
      const excluded = new Set(s.excluded);
      excluded.add(candidate.name);
      return {
        accepted: { ...s.accepted, [slotKey]: [...(s.accepted[slotKey] ?? []), candidate] },
        excluded,
        searchResults: s.searchResults
          ? s.searchResults.filter((c) => c.name !== candidate.name)
          : null,
      };
    });
    get().loadHand();
    saveDraft(get());
  },

  pass(name) {
    set((s) => {
      const excluded = new Set(s.excluded);
      excluded.add(name);
      return {
        excluded,
        searchResults: s.searchResults ? s.searchResults.filter((c) => c.name !== name) : null,
      };
    });
    get().loadHand();
  },

  reconsider(slotKey, name) {
    set((s) => {
      const list = s.accepted[slotKey] ?? [];
      const excluded = new Set(s.excluded);
      excluded.delete(name);
      return {
        accepted: { ...s.accepted, [slotKey]: list.filter((c) => c.name !== name) },
        excluded,
      };
    });
    get().loadHand();
    saveDraft(get());
  },

  fillRest() {
    const s = get();
    const slot = s.slots[s.slotIndex];
    if (!slot || !s.edhrecData) return;
    const current = s.accepted[slot.key]?.length ?? 0;
    const deficit = Math.max(0, slot.target - current);
    // ponytail: simple top-N by the same priority order the hand already
    // uses — no extra pass-aware weighting. Upgrade if auto-fills feel samey.
    const picks =
      deficit > 0
        ? pickBrewCandidates(
            s.edhrecData.cardlists.allNonLand,
            slot.key,
            s.excluded,
            s.collectionNames,
            deficit
          )
        : [];
    const excluded = new Set(s.excluded);
    for (const p of picks) excluded.add(p.name);
    set({
      accepted: { ...s.accepted, [slot.key]: [...(s.accepted[slot.key] ?? []), ...picks] },
      excluded,
    });
    saveDraft(get());
    void get().nextSlot();
  },

  async nextSlot() {
    const s = get();
    const nextIndex = s.slotIndex + 1;
    if (nextIndex >= s.slots.length) {
      await get().goToManabase();
      return;
    }
    let slots = s.slots;
    if (slots[nextIndex]?.key === 'flex') {
      slots = recomputeFlexTarget(slots, s.accepted, s.nonlandTotal);
    }
    set({ slots, slotIndex: nextIndex, handOffset: 0, searchResults: null, searchQuery: '' });
    get().loadHand();
    saveDraft(get());
  },

  prevSlot() {
    set((s) => ({
      slotIndex: Math.max(0, s.slotIndex - 1),
      handOffset: 0,
      searchResults: null,
      searchQuery: '',
    }));
    get().loadHand();
  },

  async search(query) {
    set({ searchQuery: query, searchLoading: true, searchError: null });
    if (!query.trim()) {
      set({ searchResults: null, searchLoading: false });
      return;
    }
    try {
      const s = get();
      const res = await searchCards(query, commanderSearchIdentity(s.colorIdentity), {
        skipColorFilter: false,
      });
      const results: BrewCandidate[] = res.data
        .filter((c) => !s.excluded.has(c.name))
        .map((c) => {
          const role = getCardRole(c.name) as RoleKey | null;
          return {
            name: c.name,
            price: null,
            inclusion: 0,
            synergy: 0,
            typeLine: c.type_line ?? '',
            cmc: c.cmc,
            imageUrl: c.image_uris?.normal ?? c.image_uris?.small,
            isOwned: s.collectionNames.has(c.name),
            role: role ?? undefined,
          };
        });
      set({ searchResults: results, searchLoading: false });
    } catch (err) {
      logger.warn('[Brew] Mechanic search failed:', err);
      set({ searchLoading: false, searchError: "Couldn't search right now — try again." });
    }
  },

  clearSearch() {
    set({ searchQuery: '', searchResults: null, searchError: null });
  },

  async setLandCountTarget(n) {
    set({ landCountTarget: Math.max(0, n) });
    await get().goToManabase();
  },

  async goToManabase() {
    const s = get();
    if (!s.edhrecData) return;
    set({ phase: 'manabase', landPlanLoading: true, landPlanError: null });
    try {
      const acceptedCards = flattenAccepted(s.accepted, s.slots);
      const names = acceptedCards.map((c) => c.name);
      const resolved = await getCardsByNames(names);
      const resolvedNonlandCards = names
        .map((n) => resolved.get(n))
        .filter((c): c is ScryfallCard => !!c);
      const basicCount = Math.max(
        0,
        s.landCountTarget - Math.min(s.nonBasicLandTarget, s.landCountTarget)
      );
      const usedNames = new Set(names);
      const lands = await generateLands(
        s.edhrecData.cardlists.lands,
        s.colorIdentity,
        s.landCountTarget,
        usedNames,
        basicCount,
        s.deckFormatSize,
        resolvedNonlandCards
      );
      set({ landPlan: lands, resolvedNonlandCards, landPlanLoading: false });
      saveDraft(get());
    } catch (err) {
      logger.warn('[Brew] Manabase generation failed:', err);
      set({ landPlanLoading: false, landPlanError: "Couldn't build a manabase — try again." });
    }
  },

  reset() {
    set({ ...initialState });
  },
}));
