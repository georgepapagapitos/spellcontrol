import { useEffect, useMemo } from 'react';
import { toast } from '@/store/toasts';
import { useCollectionStore } from '@/store/collection';
import { useAllocations } from '@/lib/collection/allocations';
import { useAwaitingFirstPull } from '@/lib/sync/use-awaiting-first-pull';
import { counterDraft } from './draft-edits';
import { keyOf } from './trade-basket';
import { groupOwnedForTrade, type OwnedTradeLine } from './trade-picker';
import type { TradeOffer } from './trades-client';
import { useTradeDraft } from './use-trade-draft';

/**
 * Seeds the saved draft from an incoming offer the viewer is countering, then
 * calls `onSeeded` so the page can move on to the review.
 *
 * The give side is resolved against the viewer's own copies, so it waits for
 * the collection: on a device that has never cached the account the store is
 * empty until the first pull lands, and seeding then would drop every card the
 * friend asked for. A draft already answering this offer is left alone (the
 * viewer may have edited it); a different draft for this friend is replaced,
 * because arriving through Counter is an explicit choice to answer that offer.
 */
export function useCounterSeed(opts: {
  friendId: string;
  friendName: string;
  /** The live incoming offer being countered; undefined when there is none yet. */
  offer: TradeOffer | undefined;
  onSeeded: () => void;
}) {
  const { friendId, friendName, offer, onSeeded } = opts;
  const { draft, save } = useTradeDraft(friendId);
  const cards = useCollectionStore((s) => s.cards);
  const allocations = useAllocations();
  const claimed = useMemo(() => new Set(allocations.keys()), [allocations]);
  const awaitingFirstPull = useAwaitingFirstPull();
  const waiting = awaitingFirstPull && cards.length === 0;
  const ownedByKey = useMemo(() => {
    const map = new Map<string, OwnedTradeLine>();
    for (const line of groupOwnedForTrade(cards)) map.set(keyOf(line), line);
    return map;
  }, [cards]);

  useEffect(() => {
    if (!offer || waiting) return;
    if (draft?.counterTo?.offerId !== offer.id) {
      const seeded = counterDraft(offer, { id: friendId, name: friendName }, ownedByKey, claimed);
      save(seeded.draft);
      if (seeded.skipped.length > 0) {
        toast.show({
          message: `You no longer have ${seeded.skipped.join(', ')}, so ${
            seeded.skipped.length === 1 ? 'it was' : 'they were'
          } left out of your counter.`,
          tone: 'warn',
        });
      }
    }
    onSeeded();
  }, [offer, waiting, draft, ownedByKey, claimed, friendId, friendName, save, onSeeded]);
}
