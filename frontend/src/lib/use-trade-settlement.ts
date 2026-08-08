import { useEffect, useRef } from 'react';
import { useAuth } from '../store/auth';
import { useCollectionStore } from '../store/collection';
import { toast } from '../store/toasts';
import { getCardById } from './api';
import { logger } from './logger';
import { planSettlement, describeSettlement } from './trade-settlement';
import { listTrades, markTradeSettled, type TradeOffer } from './trades-client';
import type { Condition, Finish } from '../types';

/**
 * Applying an accepted trade to the collection.
 *
 * The server stores the deal but never touches anyone's cards — so this is
 * where a trade actually becomes a collection change, on each person's own
 * device, through the same store mutators any manual edit uses. Local-first
 * is intact: a settled trade is just a local mutation the sync queue pushes.
 *
 * Ordering is deliberate: apply locally FIRST, tell the server SECOND. A crash
 * in between re-settles on the next load rather than losing cards, which is
 * safe because the removal half of a plan is idempotent (the copies are
 * already gone, so a replay removes nothing) and the server's settled flag
 * stops the additive half from running twice in the normal case.
 */

const VALID_FINISHES: readonly string[] = ['nonfoil', 'foil', 'etched'];
const VALID_CONDITIONS: readonly string[] = ['nm', 'lp', 'mp', 'hp', 'damaged'];

function asFinish(raw: string): Finish {
  return (VALID_FINISHES.includes(raw) ? raw : 'nonfoil') as Finish;
}

function asCondition(raw: string | undefined): Condition | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  return VALID_CONDITIONS.includes(lower) ? (lower as Condition) : undefined;
}

/**
 * Applies one accepted offer to the local collection, then records it.
 *
 * Returns false when nothing was applied because the offer was not in a
 * settleable state — callers use that to stay quiet rather than toast.
 */
export async function settleTrade(offer: TradeOffer): Promise<boolean> {
  if (offer.status !== 'accepted' || offer.settled) return false;

  const store = useCollectionStore.getState();
  const plan = planSettlement(offer.give, offer.receive, store.cards);

  // Removals first, in one write: replaceAllCards is the store's own bulk path
  // (it exists for exactly this "compute the new array, persist once" case).
  if (plan.remove.length > 0) {
    const gone = new Set(plan.remove.map((r) => r.copyId));
    await store.replaceAllCards(store.cards.filter((c) => !gone.has(c.copyId)));
  }

  // Additions need the real Scryfall printing to become a full collection row
  // — the fat EnrichedCard row is what renders the collection offline and
  // preserves printing fidelity, so a thin placeholder is not an option.
  const unresolved: string[] = [];
  for (const addition of plan.add) {
    try {
      const card = await getCardById(addition.copy.scryfallId);
      if (!card) {
        unresolved.push(addition.name);
        continue;
      }
      await useCollectionStore.getState().addCard(card, asFinish(addition.copy.finish), {
        quantity: 1,
        condition: asCondition(addition.copy.condition),
        language: addition.copy.language,
      });
    } catch (err) {
      logger.warn('[trades] Could not resolve a traded printing:', err);
      unresolved.push(addition.name);
    }
  }

  // Tell the server only after the local change landed.
  try {
    await markTradeSettled(offer.id);
  } catch (err) {
    // Non-fatal: the cards are already in the collection. The offer stays
    // unsettled server-side and a later pass re-runs — which is why the
    // removal half had to be idempotent.
    logger.warn('[trades] Settled locally but failed to record it:', err);
  }

  const who = offer.counterpartyDisplayName || `@${offer.counterpartyUsername}`;
  toast.show({
    message: `Trade with ${who} settled — ${describeSettlement(plan)}`,
    tone: 'success',
  });

  if (plan.short.length > 0) {
    toast.show({
      message: `You no longer had ${plan.short
        .map((s) => s.name)
        .join(', ')} — removed what was there.`,
      tone: 'warn',
    });
  }
  if (unresolved.length > 0) {
    toast.show({
      message: `Couldn’t look up ${unresolved.join(', ')} — add ${
        unresolved.length === 1 ? 'it' : 'them'
      } by hand.`,
      tone: 'warn',
    });
  }

  return true;
}

/**
 * App-level runner: settles any accepted trade this device hasn't applied yet.
 *
 * The accepting side settles inline the moment they click Accept, so this is
 * really for the PROPOSER — they were not in the app when their offer was
 * accepted, and their collection should be right by the time they next look at
 * it. Runs on mount and on window focus, the same cadence useActivity uses.
 */
export function useTradeSettlement(): void {
  const status = useAuth((s) => s.status);
  // A settlement pass mutates the collection, which can re-render whatever
  // mounted this hook — the ref keeps a second pass from overlapping the first
  // and double-adding the same cards.
  const running = useRef(false);

  useEffect(() => {
    if (status !== 'authed') return;
    let cancelled = false;

    async function sweep() {
      if (running.current || cancelled) return;
      running.current = true;
      try {
        const offers = await listTrades();
        for (const offer of offers) {
          if (cancelled) break;
          if (offer.status === 'accepted' && !offer.settled) {
            await settleTrade(offer);
          }
        }
      } catch (err) {
        // Offline or a transient failure — the next focus retries. Never
        // surfaced: the user did not ask for this and nothing is lost.
        logger.warn('[trades] Settlement sweep failed:', err);
      } finally {
        running.current = false;
      }
    }

    void sweep();
    window.addEventListener('focus', sweep);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', sweep);
    };
  }, [status]);
}
