import { useMemo } from 'react';
import { toast } from '@/store/toasts';
import type { PublicCard } from '@/lib/social/shared-types';
import {
  addGet,
  addGive,
  removeOneGet,
  removeOneGive,
  type AddBlock,
  type AddResult,
} from './draft-edits';
import { keyOf } from './trade-basket';
import type { OwnedTradeLine } from './trade-picker';
import { MAX_TRADE_LINES_PER_SIDE } from './trades-client';
import { countTheirCopies } from './use-trade-review';
import { useTradeDraft } from './use-trade-draft';

/** What an add that did nothing says, where the tile can't. */
function sayBlocked(blocked: AddBlock, name: string, friendName: string, side: 'get' | 'give') {
  if (blocked === 'lines') {
    toast.show({
      message: `A trade can hold ${MAX_TRADE_LINES_PER_SIDE} different cards per side. Send this one and start another.`,
      tone: 'warn',
    });
  } else {
    toast.show({
      message:
        side === 'get'
          ? `That's all ${friendName} has of ${name}.`
          : `Every copy of ${name} you own is already in the trade.`,
      tone: 'info',
    });
  }
}

/**
 * The saved draft as the workspace's tiles and previews use it: how many of a
 * card are in it, and the one-step edits. Edits write the stored draft; the
 * review reconciles it against fresh data whenever it reads it, so nothing here
 * has to second-guess what is stored.
 */
export function useWorkspaceDraft(opts: {
  friendId: string;
  friendName: string;
  theirCards: readonly PublicCard[] | null;
}) {
  const { friendId, friendName, theirCards } = opts;
  const { draft, save } = useTradeDraft(friendId);
  const theirCounts = useMemo(() => countTheirCopies(theirCards), [theirCards]);
  const friend = { id: friendId, name: friendName };

  function commit(result: AddResult, name: string, side: 'get' | 'give'): boolean {
    if (result.blocked) {
      sayBlocked(result.blocked, name, friendName, side);
      return false;
    }
    save(result.draft);
    return true;
  }

  return {
    draft,
    theirCounts,
    /** Copies of a card they have, across printings; null when unreadable. */
    theirCount: (oracleId: string, name: string): number | null =>
      theirCounts ? (theirCounts.get(keyOf({ oracleId, name })) ?? 0) : null,
    getQuantity: (oracleId: string): number => draft?.get[oracleId]?.quantity ?? 0,
    giveQuantity: (key: string): number => draft?.give[key]?.copyIds.length ?? 0,
    addGet: (card: { oracleId: string; name: string }): boolean =>
      commit(
        addGet(draft, friend, card, theirCounts ? (theirCounts.get(keyOf(card)) ?? 0) : null),
        card.name,
        'get'
      ),
    removeGet: (oracleId: string) => {
      const next = removeOneGet(draft, oracleId);
      if (next) save(next);
    },
    addGive: (line: OwnedTradeLine): boolean =>
      commit(addGive(draft, friend, line), line.name, 'give'),
    removeGive: (key: string) => {
      const next = removeOneGive(draft, key);
      if (next) save(next);
    },
  };
}

export type WorkspaceDraft = ReturnType<typeof useWorkspaceDraft>;
