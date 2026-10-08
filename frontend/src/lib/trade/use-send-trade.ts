import { useState } from 'react';
import { toast } from '@/store/toasts';
import { userMessage } from '@/lib/util/user-error';
import { proposeTrade, declineTrade, type TradeCard, type TradeOffer } from './trades-client';
import { useTradeDraft } from './use-trade-draft';

/**
 * Sends a trade. A counter declines the offer it answers AFTER the new one is
 * out, so a failed send never leaves the friend with nothing on the table (the
 * order stays propose-then-decline until an atomic counter endpoint exists).
 * The saved draft is deleted once the send succeeds, and only then.
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
      const offer = await proposeTrade({
        recipientId: friendId,
        give: input.give,
        receive: input.receive,
        note: input.note.trim(),
      });
      toast.show({ message: `Trade sent to ${friendName}.`, tone: 'success' });
      if (counterTo) {
        try {
          await declineTrade(counterTo.offerId);
        } catch {
          toast.show({
            message: `Your counter went out, but ${counterTo.name}'s offer is still open. Decline it from Trades.`,
            tone: 'warn',
          });
        }
      }
      clear();
      onSent(offer);
    } catch (err) {
      toast.show({
        message: userMessage(err, "Couldn't send the trade. Try again."),
        tone: 'error',
      });
      setSending(false);
    }
  }

  return { sending, send };
}
