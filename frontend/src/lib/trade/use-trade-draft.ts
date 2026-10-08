import { useCallback } from 'react';
import { useAuth } from '@/store/auth';
import { useTradeDraftsStore } from '@/store/trade-drafts';
import type { TradeDraft } from './trade-draft';

/**
 * The signed-in viewer's saved basket for one friend. Signed out there is no
 * account to scope a draft to, so it reads `null` and writes nothing.
 */
export function useTradeDraft(friendId: string): {
  draft: TradeDraft | null;
  save: (draft: TradeDraft) => void;
  clear: () => void;
} {
  const viewerId = useAuth((s) => s.user?.id ?? null);
  const draft = useTradeDraftsStore((s) => (viewerId ? s.drafts[viewerId]?.[friendId] : undefined));
  const save = useCallback(
    (next: TradeDraft) => {
      if (viewerId) useTradeDraftsStore.getState().setDraft(viewerId, friendId, next);
    },
    [viewerId, friendId]
  );
  const clear = useCallback(() => {
    if (viewerId) useTradeDraftsStore.getState().clearDraft(viewerId, friendId);
  }, [viewerId, friendId]);
  return { draft: draft ?? null, save, clear };
}
