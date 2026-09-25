/**
 * Per-card synergy classification: which axes a card produces / pays off, each
 * with an explainable reason. Pure + isomorphic. The reasons ARE the product —
 * "creates creature tokens", "triggers when your creatures enter" — so the UI
 * (and the cut guard) can always say *why*.
 */
import { parseCard, type CardLike } from './text';
import { AXES, type AxisKey } from './axes';

export interface AxisRole {
  axis: AxisKey;
  reason: string;
}

export interface CardSynergy {
  name: string;
  producers: AxisRole[];
  payoffs: AxisRole[];
}

// Keyed on the card OBJECT, so it is exact: a deck's frozen card copy is
// classified from its own text. The deck page classifies the same objects many
// times per load (every deck's synergy profile for the cross-deck Coach rows,
// then per-candidate axis hits, the radar, and again on every recompute).
// Results are shared, so callers must treat them as read-only.
const classified = new WeakMap<CardLike, CardSynergy>();

export function classifyCard(card: CardLike): CardSynergy {
  const hit = classified.get(card);
  if (hit) return hit;
  const result = classifyUncached(card);
  classified.set(card, result);
  return result;
}

function classifyUncached(card: CardLike): CardSynergy {
  const parsed = parseCard(card);
  const producers: AxisRole[] = [];
  const payoffs: AxisRole[] = [];
  for (const axis of AXES) {
    const p = axis.producer(parsed);
    if (p) producers.push({ axis: axis.key, reason: p });
    const o = axis.payoff(parsed);
    if (o) payoffs.push({ axis: axis.key, reason: o });
  }
  return { name: card.name, producers, payoffs };
}
