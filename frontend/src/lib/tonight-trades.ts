import { buildTradeRadar, type TradeRadarMatch } from './trade-radar';
import type { TonightTradeAttendee } from './game-nights-api';

export interface TonightTrades {
  /** What each other opted-in attendee can supply from MY want-lists. */
  incoming: (TradeRadarMatch & { supplierUsername: string })[];
  /** What each other opted-in attendee wants from MY tradeable binders. */
  outgoing: (TradeRadarMatch & { wanterUsername: string })[];
}

/**
 * Thin orchestrator over the unmodified `buildTradeRadar` — called once per
 * ordered attendee pair (never touching the cross-referencing logic itself).
 * `attendees` includes the caller's own row (the data endpoint's own RSVP is
 * always among the opted-in set); excluding it from the "other" side is what
 * prevents a single-attendee input from ever self-matching.
 */
export function buildTonightTrades(
  myUserId: string,
  attendees: TonightTradeAttendee[]
): TonightTrades {
  const me = attendees.find((a) => a.userId === myUserId);
  const myLists = me?.lists ?? [];
  const myTradeableCards = me?.tradeableCards ?? [];
  const others = attendees.filter((a) => a.userId !== myUserId);

  const incoming: TonightTrades['incoming'] = [];
  const outgoing: TonightTrades['outgoing'] = [];
  for (const other of others) {
    for (const match of buildTradeRadar(myLists, other.tradeableCards)) {
      incoming.push({ ...match, supplierUsername: other.username });
    }
    for (const match of buildTradeRadar(other.lists, myTradeableCards)) {
      outgoing.push({ ...match, wanterUsername: other.username });
    }
  }
  return { incoming, outgoing };
}
