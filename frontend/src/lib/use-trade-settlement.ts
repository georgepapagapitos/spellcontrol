import { useEffect, useRef } from 'react';
import { useAuth } from '../store/auth';
import { useCollectionStore } from '../store/collection';
import { toast } from '../store/toasts';
import { getCardById } from './api';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { logger } from './logger';
import { planSettlement, describeSettlement } from './trade-settlement';
import { listTrades, markTradeSettled, type TradeOffer } from './trades-client';
import type { ScryfallCard } from '@/deck-builder/types';
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
 * Offers a settlement is currently being applied for, on this device.
 *
 * `settled` only guards the ADDITIVE half across *completed* runs — it is
 * stamped after the local apply, so two overlapping calls for the same offer
 * (the inline accept racing the focus sweep, or two sweeps) would both read
 * "unsettled" and both add. The check-and-claim below is synchronous, so the
 * second caller bails before its first await.
 */
const settling = new Set<string>();

/**
 * Applies one accepted offer to the local collection, then records it.
 *
 * Returns false when nothing was applied because the offer was not in a
 * settleable state — callers use that to stay quiet rather than toast.
 */
export async function settleTrade(offer: TradeOffer): Promise<boolean> {
  if (offer.status !== 'accepted' || offer.settled) return false;
  if (settling.has(offer.id)) return false;
  settling.add(offer.id);
  try {
    return await applySettlement(offer);
  } finally {
    settling.delete(offer.id);
  }
}

async function applySettlement(offer: TradeOffer): Promise<boolean> {
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
  const substituted: string[] = [];
  const applied: typeof plan.add = [];
  // Fetched lazily, once, only when a pinned printing fails to resolve.
  let byName: Map<string, ScryfallCard> | null = null;
  for (const addition of plan.add) {
    let card: ScryfallCard | null = null;
    let exact = true;
    try {
      card = await getCardById(addition.copy.scryfallId);
    } catch (err) {
      logger.warn('[trades] Could not resolve a traded printing:', err);
    }
    if (!card) {
      // The pinned printing can stop resolving — a placeholder id, a printing
      // Scryfall later merged away, a transient failure. A different printing
      // of the right card beats losing the card from the collection entirely
      // (the same ruling the preview carousel applies), so fall back by name
      // and SAY so, rather than dropping a card the trade already promised.
      if (byName === null) {
        byName = await getCardsByNames(plan.add.map((a) => a.name)).catch((err) => {
          logger.warn('[trades] By-name fallback failed:', err);
          return new Map<string, ScryfallCard>();
        });
      }
      card = byName.get(addition.name) ?? null;
      exact = false;
    }
    if (!card) {
      unresolved.push(addition.name);
      continue;
    }
    try {
      await useCollectionStore.getState().addCard(card, asFinish(addition.copy.finish), {
        quantity: 1,
        condition: asCondition(addition.copy.condition),
        language: addition.copy.language,
      });
      applied.push(addition);
      if (!exact) substituted.push(addition.name);
    } catch (err) {
      logger.warn('[trades] Could not add a traded card:', err);
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
    // Counts what actually landed, not what the plan hoped for — an unresolved
    // card must not be announced as "in".
    message: `Trade with ${who} settled — ${describeSettlement({ ...plan, add: applied })}`,
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
  if (substituted.length > 0) {
    toast.show({
      message: `Added ${substituted.join(', ')} as a different printing — the exact one couldn’t be looked up.`,
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
        // Re-list before EVERY settle rather than iterating one snapshot: a
        // settle takes real time (one lookup per received copy), and another
        // device can settle a later offer in that window — trusting the stale
        // snapshot would re-apply its additive half. `attempted` bounds the
        // loop when a settle couldn't be recorded server-side (that offer
        // would otherwise list as unsettled forever).
        const attempted = new Set<string>();
        for (;;) {
          if (cancelled) break;
          const { offers } = await listTrades();
          const next = offers.find(
            (o) => o.status === 'accepted' && !o.settled && !attempted.has(o.id)
          );
          if (!next) break;
          attempted.add(next.id);
          await settleTrade(next);
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
