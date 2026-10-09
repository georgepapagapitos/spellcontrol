import { pickRandomPresetColor } from '@/lib/util/preset-colors';

/**
 * The decks store's zustand-persist `migrate`, for the legacy
 * `spellcontrol-decks` IDB rows read on the one boot before
 * `deleteLegacyDatabasesOnce()` removes them (see `store/decks.ts`).
 *
 * v1→v2: allocation tracking moved from `scryfallId` (which identifies a
 * printing) to `copyId` (which identifies a single physical card). Old
 * allocations point at scryfallIds that have no equivalent copyId in the
 * collection, so we clear them and let the user re-pick. Deck contents
 * are preserved.
 */
export function migrateDecksState(persistedState: unknown, fromVersion: number): never {
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
      const { bracketLevel, ...rest } = gc as { bracketLevel: unknown } & Record<string, unknown>;
      return {
        ...d,
        generationContext: { ...rest, targetBracket: bracketLevel },
      };
    });
  }
  return state as never;
}
