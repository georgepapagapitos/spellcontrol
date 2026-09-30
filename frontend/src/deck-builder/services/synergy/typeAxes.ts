import type { AxisKey, TribalSetEntry } from './axes';

// ── Type-line cards as producers (E531) ─────────────────────────────────────
// Three engines are fed by what a card IS, not by anything its text says: an
// enchantress deck's enchantments, a spellslinger deck's instants and
// sorceries, a landfall deck's lands. Oracle text never classifies them, so
// those axes read producer-scarce in every deck that runs the engine, and a
// balance read on top of that (packageBoost's scarce-side boost) pushed
// type-agnostic support over staples. Same shape as tribalMembership in axes.ts: one
// rule by FRONT-face type line, capped at the weight of the cards whose payoffs
// sit on the axis, so a stray payoff never turns a deck's ordinary lands or
// removal spells into an engine. Used by every set-level read: analyzeDeckSynergy,
// the generator's average-deck read, packageBoost's tally and synergyDependency.

const TYPE_AXIS_RULES: ReadonlyArray<{
  axis: AxisKey;
  reason: string;
  matches: (types: string) => boolean;
}> = [
  {
    axis: 'enchantress',
    reason: 'one of your enchantments',
    matches: (types) => /\benchantment\b/.test(types),
  },
  {
    axis: 'spellslinger',
    reason: 'one of your instants or sorceries',
    matches: (types) => /\b(?:instant|sorcery)\b/.test(types),
  },
  { axis: 'landfall', reason: 'one of your lands', matches: (types) => /\bland\b/.test(types) },
];

/** Axes whose producer side is a card type. The scarce-side package boost skips them. */
export const TYPE_MEMBERSHIP_AXES: ReadonlySet<AxisKey> = new Set(
  TYPE_AXIS_RULES.map((r) => r.axis)
);

export interface TypeAxisMember {
  axis: AxisKey;
  /** Index into the entries. */
  index: number;
  /** The weight the card counts at, after the cap. */
  weight: number;
  reason: string;
}

/**
 * The set's cards to count as producers of the type axes: a card of the axis's
 * type that the text didn't already classify as a producer there. In set order
 * members take their full weight until the cap runs out, so each axis's total
 * is exactly min(member weight, payoff weight). `extraPayoff` adds payoff
 * weight the set doesn't hold (the candidate a gate is judging).
 */
export function typeAxisMembership(
  entries: readonly TribalSetEntry[],
  extraPayoff: Partial<Record<AxisKey, number>> = {}
): TypeAxisMember[] {
  const out: TypeAxisMember[] = [];
  for (const rule of TYPE_AXIS_RULES) {
    let remaining = extraPayoff[rule.axis] ?? 0;
    const candidates: Array<{ index: number; weight: number }> = [];
    entries.forEach((e, index) => {
      if (!(e.weight > 0)) return;
      if (e.payoffs.some((p) => p.axis === rule.axis)) remaining += e.weight;
      if (e.producers.some((p) => p.axis === rule.axis)) return;
      const front = (e.card.card_faces?.[0]?.type_line ?? e.card.type_line ?? '').toLowerCase();
      if (rule.matches(front.split(/\s[—–]\s/)[0])) candidates.push({ index, weight: e.weight });
    });
    for (const c of candidates) {
      const weight = Math.min(c.weight, remaining);
      if (weight <= 0) break;
      out.push({ axis: rule.axis, index: c.index, weight, reason: rule.reason });
      remaining -= weight;
    }
  }
  return out;
}
