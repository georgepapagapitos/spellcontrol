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

export function classifyCard(card: CardLike): CardSynergy {
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

/** True when the card produces or pays off any axis at all. */
export function hasAnySynergy(card: CardSynergy): boolean {
  return card.producers.length > 0 || card.payoffs.length > 0;
}
