import type { BinderDef, BinderReviewSnapshot, EnrichedCard, MaterializedBinder } from '../types';
import { printingFinishKey } from './collection-mutations';

/**
 * Drift attribution for a single card that moved in or out of a binder since
 * the user last marked it reviewed. The drift system exists because binder
 * rules read live volatile fields — Scryfall prices and EDHREC rank — so a
 * card can silently fall in or out of a binder when those values shift. This
 * surfaces the change with the actual delta so the user knows *why*.
 *
 * Reason taxonomy:
 *   - `price`: the snapshot vs current price crossed a threshold (or the card
 *     just gained/lost a price entirely). We can't know which rule field caused
 *     it without re-running rules at snapshot time, so we report the raw delta
 *     and let the user judge — "price 6.20 → 4.80" is enough signal in practice.
 *   - `edhrec`: same idea for EDHREC rank.
 *   - `collection`: the card was added/removed from the user's collection
 *     between snapshot and now (no longer owned, or newly imported).
 *   - `other`: snapshot/current values are unchanged on the volatile fields
 *     we track, so the cause is something else — typically the user edited
 *     the binder rules. Cheaper than full rule attribution and almost always
 *     self-evident in context ("I just edited this binder").
 */
export type DriftReasonKind = 'price' | 'edhrec' | 'collection' | 'other';

export interface DriftReason {
  kind: DriftReasonKind;
  /** Per-kind detail used to render a short human line. */
  detail?: {
    priceBefore?: number;
    priceAfter?: number;
    edhrecBefore?: number;
    edhrecAfter?: number;
  };
}

export interface DriftCard {
  key: string;
  /** Best-effort display name. For removed cards we don't have a live
   *  EnrichedCard, so this falls back to the key itself if nothing better
   *  was supplied. */
  name: string;
  /** A representative card (used to render an image / link). Undefined for
   *  removed cards that are no longer in the live collection. */
  card?: EnrichedCard;
  reason: DriftReason;
}

export interface DriftResult {
  added: DriftCard[];
  removed: DriftCard[];
  /** True when the binder has never been reviewed — caller can show a
   *  one-time "snapshot this binder" prompt instead of a diff. */
  neverReviewed: boolean;
  /** Snapshot timestamp the diff is against. Undefined when neverReviewed. */
  snapshotAt?: number;
}

/**
 * Capture every card currently routed to this binder. Called when the user
 * clicks "Mark reviewed" in BinderView. We dedupe by printingFinishKey rather
 * than copyId because copyIds regenerate on every re-import; this matches the
 * approach used by `pinnedKeys` and `manualKeys` elsewhere on BinderDef.
 */
export function captureBinderSnapshot(binder: MaterializedBinder): BinderReviewSnapshot {
  const keys = new Set<string>();
  const cardSnapshots: Record<string, { price: number; edhrecRank?: number }> = {};
  for (const section of binder.sections) {
    for (const card of section.cards) {
      const key = printingFinishKey(card);
      if (keys.has(key)) continue;
      keys.add(key);
      const snap: { price: number; edhrecRank?: number } = { price: card.purchasePrice };
      if (card.edhrecRank !== undefined) snap.edhrecRank = card.edhrecRank;
      cardSnapshots[key] = snap;
    }
  }
  return {
    at: Date.now(),
    keys: [...keys],
    cardSnapshots,
  };
}

/** Threshold below which a numeric price delta isn't worth attributing —
 *  Scryfall prices flicker at the cent level constantly. */
const PRICE_EPSILON = 0.01;

/**
 * Compare a binder's current membership against its last-reviewed snapshot.
 * Result is ordered: added then removed, each by name. Callers should treat
 * an empty added + empty removed as "nothing to show" and hide the banner.
 *
 * Attribution heuristic: for a card that is no longer in the binder, we look
 * at the snapshot's pinned volatile values and compare to the live card (if
 * still in the user's collection). If price or EDHREC moved meaningfully,
 * that's the reason; otherwise we report "other" (rule edit / something we
 * don't track). For added cards we do the symmetric check.
 */
export function computeDrift(binder: MaterializedBinder, allCards: EnrichedCard[]): DriftResult {
  const snapshot = binder.def.lastReviewedSnapshot;
  if (!snapshot) {
    return { added: [], removed: [], neverReviewed: true };
  }

  const previousKeys = new Set(snapshot.keys);
  const currentByKey = new Map<string, EnrichedCard>();
  for (const section of binder.sections) {
    for (const card of section.cards) {
      const key = printingFinishKey(card);
      if (!currentByKey.has(key)) currentByKey.set(key, card);
    }
  }

  // For attribution on removed cards, we need to find the live representative
  // (a copy still in the collection) outside the binder.
  const liveByKey = new Map<string, EnrichedCard>();
  for (const c of allCards) {
    const k = printingFinishKey(c);
    if (!liveByKey.has(k)) liveByKey.set(k, c);
  }

  const added: DriftCard[] = [];
  for (const [key, card] of currentByKey) {
    if (previousKeys.has(key)) continue;
    added.push({
      key,
      name: card.name,
      card,
      reason: attributeAdded(key, card, snapshot),
    });
  }

  const removed: DriftCard[] = [];
  for (const key of previousKeys) {
    if (currentByKey.has(key)) continue;
    const live = liveByKey.get(key);
    removed.push({
      key,
      name: live?.name ?? key,
      card: live,
      reason: attributeRemoved(key, live, snapshot),
    });
  }

  added.sort((a, b) => a.name.localeCompare(b.name));
  removed.sort((a, b) => a.name.localeCompare(b.name));

  return {
    added,
    removed,
    neverReviewed: false,
    snapshotAt: snapshot.at,
  };
}

function attributeAdded(
  key: string,
  card: EnrichedCard,
  snapshot: BinderReviewSnapshot
): DriftReason {
  const prev = snapshot.cardSnapshots[key];
  if (!prev) {
    // We didn't know about this card at snapshot time. Either the user just
    // imported it, or it existed but didn't match — we can't distinguish
    // without a separate collection snapshot. Treat as a collection change
    // unless we have a baseline price to compare against from any other
    // snapshot entry (we don't), so report "other".
    return { kind: 'other' };
  }
  if (priceMoved(prev.price, card.purchasePrice)) {
    return {
      kind: 'price',
      detail: { priceBefore: prev.price, priceAfter: card.purchasePrice },
    };
  }
  if (edhrecMoved(prev.edhrecRank, card.edhrecRank)) {
    return {
      kind: 'edhrec',
      detail: { edhrecBefore: prev.edhrecRank, edhrecAfter: card.edhrecRank },
    };
  }
  return { kind: 'other' };
}

function attributeRemoved(
  key: string,
  live: EnrichedCard | undefined,
  snapshot: BinderReviewSnapshot
): DriftReason {
  if (!live) {
    return { kind: 'collection' };
  }
  const prev = snapshot.cardSnapshots[key];
  if (!prev) return { kind: 'other' };
  if (priceMoved(prev.price, live.purchasePrice)) {
    return {
      kind: 'price',
      detail: { priceBefore: prev.price, priceAfter: live.purchasePrice },
    };
  }
  if (edhrecMoved(prev.edhrecRank, live.edhrecRank)) {
    return {
      kind: 'edhrec',
      detail: { edhrecBefore: prev.edhrecRank, edhrecAfter: live.edhrecRank },
    };
  }
  return { kind: 'other' };
}

function priceMoved(before: number, after: number): boolean {
  return Math.abs(before - after) > PRICE_EPSILON;
}

function edhrecMoved(before: number | undefined, after: number | undefined): boolean {
  if (before === after) return false;
  if (before === undefined || after === undefined) return true;
  return before !== after;
}

/**
 * Render a drift reason into a one-line human string. UI calls this to keep
 * the banner code free of the per-kind switch.
 */
export function formatDriftReason(reason: DriftReason): string {
  switch (reason.kind) {
    case 'price': {
      const a = reason.detail?.priceBefore;
      const b = reason.detail?.priceAfter;
      if (a === undefined || b === undefined) return 'price changed';
      return `price ${formatPrice(a)} → ${formatPrice(b)}`;
    }
    case 'edhrec': {
      const a = reason.detail?.edhrecBefore;
      const b = reason.detail?.edhrecAfter;
      if (a === undefined && b !== undefined) return `EDHREC rank now ${b}`;
      if (a !== undefined && b === undefined) return `EDHREC rank removed (was ${a})`;
      if (a === undefined || b === undefined) return 'EDHREC rank changed';
      return `EDHREC rank ${a} → ${b}`;
    }
    case 'collection':
      return 'no longer in collection';
    case 'other':
      return 'rule or other change';
  }
}

function formatPrice(p: number): string {
  return p === 0 ? '$0' : `$${p.toFixed(2)}`;
}

/** Convenience used by the banner: does this binder have anything to show? */
export function hasDrift(result: DriftResult): boolean {
  return result.added.length > 0 || result.removed.length > 0;
}

/** True if the binder has a snapshot at all. Used to gate the "Mark reviewed"
 *  button — for never-reviewed binders we still want the button visible so
 *  the user can opt in. */
export function hasSnapshot(def: BinderDef): boolean {
  return def.lastReviewedSnapshot !== undefined;
}
