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
import { getEntryKey, keyOf, type GivePickOptions } from './trade-basket';
import type { OwnedTradeLine } from './trade-picker';
import { MAX_TRADE_LINES_PER_SIDE } from './trades-client';
import { countTheirCopies, countTheirPrintings } from './use-trade-review';
import { useTradeDraft } from './use-trade-draft';

/** What an add that did nothing says, where the tile can't. */
function sayBlocked(
  blocked: AddBlock,
  name: string,
  friendName: string,
  side: 'get' | 'give',
  printing = false
) {
  if (blocked === 'lines') {
    toast.show({
      message: `A trade can hold ${MAX_TRADE_LINES_PER_SIDE} different cards per side. Send this one and start another.`,
      tone: 'warn',
    });
  } else {
    toast.show({
      message:
        side === 'get'
          ? `That's all ${friendName} has of ${printing ? 'this printing of ' : ''}${name}.`
          : `Every copy of ${printing ? 'this printing of ' : ''}${name} you own is already in the trade.`,
      tone: 'info',
    });
  }
}

/** A card from their collection, with the printing when a specific tile was tapped. */
export interface PrintingAsk {
  oracleId: string;
  name: string;
  scryfallId?: string;
  finish?: string;
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
  const theirPrintingCounts = useMemo(() => countTheirPrintings(theirCards), [theirCards]);
  const friend = { id: friendId, name: friendName };

  function commit(
    result: AddResult,
    name: string,
    side: 'get' | 'give',
    printing = false
  ): boolean {
    if (result.blocked) {
      sayBlocked(result.blocked, name, friendName, side, printing);
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
    /** Copies they have of ONE printing; null when unreadable. */
    theirPrintingCount: (card: PrintingAsk): number | null =>
      theirPrintingCounts ? (theirPrintingCounts.get(getEntryKey(card)) ?? 0) : null,
    /** How many of this printing (or, unpinned, of this card with no printing named) are asked for. */
    getQuantity: (card: { oracleId: string; name: string; scryfallId?: string; finish?: string }) =>
      draft?.get[getEntryKey(card)]?.quantity ?? 0,
    giveQuantity: (key: string, among?: ReadonlySet<string>): number => {
      const ids = draft?.give[key]?.copyIds ?? [];
      return among ? ids.filter((id) => among.has(id)).length : ids.length;
    },
    /** One more of THIS printing, asked for by name of its tile. */
    addGet: (card: PrintingAsk): boolean =>
      commit(
        addGet(
          draft,
          friend,
          card,
          card.scryfallId
            ? (theirPrintingCounts?.get(getEntryKey(card)) ?? (theirPrintingCounts ? 0 : null))
            : theirCounts
              ? (theirCounts.get(keyOf(card)) ?? 0)
              : null
        ),
        card.name,
        'get',
        !!card.scryfallId
      ),
    removeGet: (key: string) => {
      const next = removeOneGet(draft, key);
      if (next) save(next);
    },
    addGive: (line: OwnedTradeLine, opts: GivePickOptions = {}): boolean =>
      commit(addGive(draft, friend, line, opts), line.name, 'give', !!opts.printing),
    removeGive: (key: string, among?: ReadonlySet<string>) => {
      const next = removeOneGive(draft, key, among);
      if (next) save(next);
    },
  };
}

export type WorkspaceDraft = ReturnType<typeof useWorkspaceDraft>;
