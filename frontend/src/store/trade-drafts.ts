import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/util/safe-local-storage';
import { isEmptyDraft, type TradeDraftV1 } from '@/lib/trade/trade-draft';

/** A basket nobody touched for this long is stale: prices and collections moved on. */
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type DraftsByViewer = Record<string, Record<string, TradeDraftV1>>;

interface TradeDraftsState {
  /** `{[viewerUserId]: {[friendId]: draft}}`, scoped per account so a shared browser never leaks one into another. */
  drafts: DraftsByViewer;
  getDraft: (viewerId: string, friendId: string) => TradeDraftV1 | null;
  /** Saves (stamping `updatedAt`); an empty draft clears instead. */
  setDraft: (viewerId: string, friendId: string, draft: TradeDraftV1) => void;
  clearDraft: (viewerId: string, friendId: string) => void;
}

/** Drops drafts past the TTL and anything not shaped like a v1 draft. */
export function pruneDrafts(drafts: unknown, now = Date.now()): DraftsByViewer {
  const out: DraftsByViewer = {};
  if (!drafts || typeof drafts !== 'object') return out;
  for (const [viewerId, byFriend] of Object.entries(drafts as Record<string, unknown>)) {
    if (!byFriend || typeof byFriend !== 'object') continue;
    for (const [friendId, raw] of Object.entries(byFriend as Record<string, unknown>)) {
      const d = raw as Partial<TradeDraftV1> | null;
      if (!d || d.v !== 1 || typeof d.updatedAt !== 'number') continue;
      if (now - d.updatedAt > DRAFT_TTL_MS) continue;
      (out[viewerId] ??= {})[friendId] = d as TradeDraftV1;
    }
  }
  return out;
}

export const useTradeDraftsStore = create<TradeDraftsState>()(
  persist(
    (set, get) => ({
      drafts: {},
      getDraft: (viewerId, friendId) => get().drafts[viewerId]?.[friendId] ?? null,
      setDraft: (viewerId, friendId, draft) => {
        if (isEmptyDraft(draft)) {
          get().clearDraft(viewerId, friendId);
          return;
        }
        set((s) => ({
          drafts: {
            ...s.drafts,
            [viewerId]: { ...s.drafts[viewerId], [friendId]: { ...draft, updatedAt: Date.now() } },
          },
        }));
      },
      clearDraft: (viewerId, friendId) => {
        const mine = get().drafts[viewerId];
        if (!mine || !(friendId in mine)) return;
        const rest = { ...mine };
        delete rest[friendId];
        set((s) => {
          const drafts = { ...s.drafts };
          if (Object.keys(rest).length === 0) delete drafts[viewerId];
          else drafts[viewerId] = rest;
          return { drafts };
        });
      },
    }),
    {
      name: 'sc-trade-drafts:v1',
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (s) => ({ drafts: s.drafts }),
      merge: (persisted, current) => ({
        ...current,
        drafts: pruneDrafts((persisted as { drafts?: unknown } | undefined)?.drafts),
      }),
    }
  )
);
