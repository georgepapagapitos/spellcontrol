/**
 * Deck-level "engine analysis": aggregate per-card synergy into producer↔payoff
 * balance per axis, surface lopsided engines (producers with no payoff, or
 * payoff-starved themes), and expose which cards are load-bearing for an axis
 * the deck is actually invested in (the hook the Optimize cut guard uses so it
 * never trims a strategy's own pieces). Pure + isomorphic.
 */
import { classifyCard, type CardSynergy } from './classify';
import { AXES, type AxisKey } from './axes';
import type { CardLike } from './text';

export interface AxisCard {
  name: string;
  reason: string;
}

export interface AxisSummary {
  axis: AxisKey;
  label: string;
  producers: AxisCard[];
  payoffs: AxisCard[];
  /** producers + payoffs — how much the deck commits to this axis. */
  total: number;
}

/**
 * A lopsided engine: an axis the deck is invested in but missing one half. `side`
 * is the side that's MISSING (what the deck needs more of) — it maps directly to
 * a `SynergySuggestion.side`, so the UI can link a warning to the fills for it.
 */
export interface LopsidedAxis {
  axis: AxisKey;
  label: string;
  /** The side the deck is short on — what to add. */
  side: 'producer' | 'payoff';
  text: string;
}

export interface DeckSynergy {
  /** Axes with at least one hit, busiest first. */
  axes: AxisSummary[];
  /** Axes the deck is genuinely built around (total ≥ INVEST_THRESHOLD). */
  invested: AxisKey[];
  /** Human-readable engine notes ("Tokens: 9 producers but no payoff"). */
  warnings: string[];
  /** Structured form of the warnings — same notes, but axis-keyed so the UI can
   *  link each to the suggestions that fill it. Additive; `warnings` stays for
   *  back-compat with already-persisted `synergyAnalysis`. */
  lopsided: LopsidedAxis[];
  headline: string;
}

/** A deck is "invested" in an axis once it runs this many producers+payoffs. */
export const INVEST_THRESHOLD = 5;
/** Lopsided thresholds for warnings. */
const LOPSIDED_MIN = 3;

const LABELS = new Map(AXES.map((a) => [a.key, a.label]));

export function analyzeDeckSynergy(cards: CardLike[]): DeckSynergy {
  const byAxis = new Map<AxisKey, AxisSummary>();
  const ensure = (axis: AxisKey): AxisSummary => {
    let s = byAxis.get(axis);
    if (!s) {
      s = { axis, label: LABELS.get(axis) ?? axis, producers: [], payoffs: [], total: 0 };
      byAxis.set(axis, s);
    }
    return s;
  };

  for (const card of cards) {
    const cs = classifyCard(card);
    for (const p of cs.producers)
      ensure(p.axis).producers.push({ name: cs.name, reason: p.reason });
    for (const o of cs.payoffs) ensure(o.axis).payoffs.push({ name: cs.name, reason: o.reason });
  }

  const axes = [...byAxis.values()]
    .map((s) => ({ ...s, total: s.producers.length + s.payoffs.length }))
    .sort((a, b) => b.total - a.total);

  // "Invested" = a real engine: enough total cards AND both halves present.
  // Requiring both halves stops payoff-heavy axes (spellslinger, enchantress)
  // from reading as an engine — and over-protecting — without their producers.
  const invested = axes
    .filter((s) => s.total >= INVEST_THRESHOLD && s.producers.length >= 1 && s.payoffs.length >= 1)
    .map((s) => s.axis);

  const warnings: string[] = [];
  const lopsided: LopsidedAxis[] = [];
  for (const s of axes) {
    if (s.total < INVEST_THRESHOLD) continue;
    if (s.producers.length >= LOPSIDED_MIN && s.payoffs.length === 0) {
      const text = `${s.label}: ${s.producers.length} producers but no payoff to reward them.`;
      warnings.push(text);
      lopsided.push({ axis: s.axis, label: s.label, side: 'payoff', text });
    } else if (s.payoffs.length >= LOPSIDED_MIN && s.producers.length <= 1) {
      const text = `${s.label}: ${s.payoffs.length} payoffs but only ${s.producers.length} producer${s.producers.length === 1 ? '' : 's'} to feed them.`;
      warnings.push(text);
      lopsided.push({ axis: s.axis, label: s.label, side: 'producer', text });
    }
  }

  const top = axes[0];
  const headline =
    invested.length === 0
      ? 'No clear producer/payoff engine detected.'
      : `Primary engine: ${top.label} (${top.producers.length} producers / ${top.payoffs.length} payoffs).`;

  return { axes, invested, warnings, lopsided, headline };
}

/**
 * Is this card load-bearing for an axis the deck is invested in? Used as a cut
 * guard — a token producer in a token deck must never be auto-trimmed, even at
 * low EDHREC inclusion.
 */
export function isLoadBearing(card: CardLike, deck: DeckSynergy): boolean {
  if (deck.invested.length === 0) return false;
  const invested = new Set(deck.invested);
  const cs: CardSynergy = classifyCard(card);
  return (
    cs.producers.some((p) => invested.has(p.axis)) || cs.payoffs.some((o) => invested.has(o.axis))
  );
}
