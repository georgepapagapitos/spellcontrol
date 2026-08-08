import { apiUrl } from './api-base';

/**
 * Client for the trade-offer API.
 *
 * Mirrors backend/src/routes/trades.ts's TradeOfferView — keep in lockstep
 * when fields change (same convention as activity-client.ts / friends-client.ts
 * mirroring their own backend counterparts).
 *
 * Note the sides are named from the CALLER's point of view on the wire: the
 * same offer arrives as "you give X, you get Y" to one party and the mirror to
 * the other, so no component has to work out which end it is looking at.
 */

export type TradeStatus = 'proposed' | 'accepted' | 'declined' | 'withdrawn';

/** One physical copy, at the printing that actually changes hands. */
export interface TradeCopy {
  scryfallId: string;
  finish: string;
  condition?: string;
  language?: string;
}

/**
 * One card line. `copies` is empty while a side is still oracle-level — which
 * is the normal state of what you ASK a friend for, because the friend
 * collection you picked it from is oracle-level by design (contents yes, value
 * no). It fills in when that friend accepts and their device stamps the
 * printings it is handing over.
 */
export interface TradeCard {
  oracleId: string;
  name: string;
  quantity: number;
  copies: TradeCopy[];
}

export interface TradeOffer {
  id: string;
  /** True when the caller sent this offer. */
  mine: boolean;
  counterpartyId: string;
  counterpartyUsername: string;
  counterpartyDisplayName: string | null;
  status: TradeStatus;
  note: string;
  give: TradeCard[];
  receive: TradeCard[];
  /** Whether the CALLER has applied their side to their own collection. */
  settled: boolean;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

/** Thrown when a transition lost a race — the offer was already answered. */
export class TradeConflictError extends Error {}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

async function handle<T>(res: Response, fallback: string): Promise<T> {
  if (res.status === 409) {
    throw new TradeConflictError(await readError(res, 'That trade was already answered.'));
  }
  if (!res.ok) {
    throw new Error(await readError(res, fallback));
  }
  return (await res.json()) as T;
}

/** Every offer the caller is a party to, newest first. */
export async function listTrades(opts: { withUserId?: string } = {}): Promise<TradeOffer[]> {
  const query = opts.withUserId ? `?withUserId=${encodeURIComponent(opts.withUserId)}` : '';
  const res = await fetch(apiUrl(`/api/trades${query}`), { credentials: 'include' });
  const data = await handle<{ offers: TradeOffer[] }>(res, 'Failed to load trades.');
  return data.offers;
}

/**
 * Propose a trade. `give` must arrive with printings resolved — the proposer
 * picked real copies out of their own collection, and that detail is the only
 * reason the card lands in the friend's binder as the printing that physically
 * changed hands.
 */
export async function proposeTrade(input: {
  recipientId: string;
  give: TradeCard[];
  receive: TradeCard[];
  note?: string;
}): Promise<TradeOffer> {
  const res = await fetch(apiUrl('/api/trades'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await handle<{ offer: TradeOffer }>(res, 'Failed to send the trade.');
  return data.offer;
}

/**
 * Accept an offer, stamping the printings being handed over. `resolved` must
 * name the same cards in the same quantities the offer asked for — accepting is
 * not a channel for changing the deal, and the server rejects one that does.
 */
export async function acceptTrade(offerId: string, resolved: TradeCard[]): Promise<TradeOffer> {
  const res = await fetch(apiUrl(`/api/trades/${encodeURIComponent(offerId)}`), {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'accept', resolved }),
  });
  const data = await handle<{ offer: TradeOffer }>(res, 'Failed to accept the trade.');
  return data.offer;
}

export async function declineTrade(offerId: string): Promise<TradeOffer> {
  const res = await fetch(apiUrl(`/api/trades/${encodeURIComponent(offerId)}`), {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'decline' }),
  });
  const data = await handle<{ offer: TradeOffer }>(res, 'Failed to decline the trade.');
  return data.offer;
}

export async function withdrawTrade(offerId: string): Promise<TradeOffer> {
  const res = await fetch(apiUrl(`/api/trades/${encodeURIComponent(offerId)}`), {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'withdraw' }),
  });
  const data = await handle<{ offer: TradeOffer }>(res, 'Failed to withdraw the trade.');
  return data.offer;
}

/**
 * Report that the caller has applied their own side to their own collection.
 * Idempotent server-side, and only ever called AFTER the local mutation has
 * landed — so a crash in between re-settles on next load rather than losing
 * cards.
 */
export async function markTradeSettled(offerId: string): Promise<TradeOffer> {
  const res = await fetch(apiUrl(`/api/trades/${encodeURIComponent(offerId)}/settled`), {
    method: 'POST',
    credentials: 'include',
  });
  const data = await handle<{ offer: TradeOffer }>(res, 'Failed to record the trade.');
  return data.offer;
}
