import { useState } from 'react';
import { toast } from '@/store/toasts';
import { userMessage } from '@/lib/util/user-error';
import {
  proposeTrade,
  counterTrade,
  TradeConflictError,
  type TradeCard,
  type TradeOffer,
} from './trades-client';
import { useTradeDraft } from './use-trade-draft';

/**
 * Sends a trade. A counter is one atomic call that declines the offer it
 * answers and creates the new one together, so a failure never leaves both
 * open. The saved draft is deleted once the send succeeds, and only then.
 */
export function useSendTrade(opts: {
  friendId: string;
  friendName: string;
  counterTo?: { offerId: string; name: string };
  onSent: (offer: TradeOffer) => void;
}): {
  sending: boolean;
  send: (input: { give: TradeCard[]; receive: TradeCard[]; note: string }) => Promise<void>;
} {
  const { friendId, friendName, counterTo, onSent } = opts;
  const [sending, setSending] = useState(false);
  const { clear } = useTradeDraft(friendId);

  async function send(input: { give: TradeCard[]; receive: TradeCard[]; note: string }) {
    setSending(true);
    try {
      const note = input.note.trim();
      const offer = counterTo
        ? await counterTrade(counterTo.offerId, { give: input.give, receive: input.receive, note })
        : await proposeTrade({
            recipientId: friendId,
            give: input.give,
            receive: input.receive,
            note,
          });
      toast.show({ message: `Trade sent to ${friendName}.`, tone: 'success' });
      clear();
      onSent(offer);
    } catch (err) {
      if (err instanceof TradeConflictError) {
        toast.show({ message: err.message, tone: 'warn' });
      } else {
        toast.show({
          message: userMessage(err, "Couldn't send the trade. Try again."),
          tone: 'error',
        });
      }
      setSending(false);
    }
  }

  return { sending, send };
}
