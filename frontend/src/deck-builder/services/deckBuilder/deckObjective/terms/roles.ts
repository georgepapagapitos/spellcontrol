/**
 * Role coverage: ramp, draw, removal and wipes against the plan's targets,
 * with SOFT, saturating penalties on both sides. Short of a role costs more
 * than over it, and over it costs something too: an overbuilt ramp suite is
 * slots the payoffs didn't get (the collection gate's 21-of-15 ramp deck).
 *
 * Counting comes from card facts (cardFacts/schema.ts), not the tagger:
 * every counted role fact (primary 1, secondary 0.6; incidental never fills
 * a slot), so Liliana, Dreadhorde General counts her draw and her edict and
 * not her ultimate's wipe. A card counts at most once per role. Tutors count
 * toward draw (the tagger's vocabulary the targets were set in, ROLE_TO_TAGGER).
 * Counterspells do NOT count as removal: a counter can't answer a resolved
 * permanent (E486); the interaction term values them instead.
 *
 * Per role with target t and count c, s = max(t, MIN_ROLE_SPAN):
 *   under = softSat(max(0, UNDER_BAND·t − c) / s, SOFT_WIDTH) × UNDER_SCALE
 *   over  = softSat(max(0, c − OVER_BAND·t) / s, SOFT_WIDTH) × OVER_SCALE
 * UNDER_BAND 0.9 and OVER_BAND 1.2 leave a free band around the target, the
 * width of the generator's own "overbuilt" reading; half the scale is lost at
 * SOFT_WIDTH (30% of the span) past the band, and never more than the scale.
 * The span is floored at MIN_ROLE_SPAN cards so a small target doesn't turn
 * one card into a huge relative miss: a third wipe on a target of two is one
 * card over, not "50% overbuilt".
 */
import { TIER_WEIGHT, countsAsRole, type FactRole } from '@/deck-builder/services/cardFacts';
import { OBJECTIVE_ROLES, type CardNote, type ObjectiveRole } from '../types';
import { nonLandCards, round2, softSat, type TermFn } from './shared';

export const UNDER_BAND = 0.9;
export const OVER_BAND = 1.2;
export const SOFT_WIDTH = 0.3;
/** Smallest span a deviation is measured against, in cards. */
export const MIN_ROLE_SPAN = 6;
/** Card-equivalents lost by a role missing entirely (the saturation ceiling). */
export const UNDER_SCALE = 4;
export const OVER_SCALE = 3;

const FACT_TO_OBJECTIVE: Partial<Record<FactRole, ObjectiveRole>> = {
  ramp: 'ramp',
  cardDraw: 'cardDraw',
  tutor: 'cardDraw',
  removal: 'removal',
  boardwipe: 'boardwipe',
};

const ROLE_LABEL: Record<ObjectiveRole, string> = {
  ramp: 'ramp',
  cardDraw: 'draw',
  removal: 'removal',
  boardwipe: 'wipes',
};

export const rolesTerm: TermFn = (deck, ctx) => {
  const counts: Record<ObjectiveRole, number> = { ramp: 0, cardDraw: 0, removal: 0, boardwipe: 0 };
  const members: Record<ObjectiveRole, Array<{ name: string; w: number }>> = {
    ramp: [],
    cardDraw: [],
    removal: [],
    boardwipe: [],
  };
  for (const card of nonLandCards(deck)) {
    const best = new Map<ObjectiveRole, number>();
    if (ctx.roleOf) {
      // The deck report's own count (one role per card): the numbers a
      // reason quotes are the ones the report shows.
      const role = ctx.roleOf(card) as ObjectiveRole | null;
      if (role && OBJECTIVE_ROLES.includes(role)) best.set(role, 1);
    } else {
      for (const fact of ctx.factsOf(card).roles) {
        if (!countsAsRole(fact)) continue;
        const role = FACT_TO_OBJECTIVE[fact.role];
        if (!role) continue;
        best.set(role, Math.max(best.get(role) ?? 0, TIER_WEIGHT[fact.tier]));
      }
    }
    for (const [role, w] of best) {
      counts[role] += w;
      members[role].push({ name: card.name, w });
    }
  }

  const notes: CardNote[] = [];
  const parts: string[] = [];
  let value = 0;
  for (const role of OBJECTIVE_ROLES) {
    const t = ctx.roleTargets[role];
    if (!t || t <= 0) continue;
    const c = counts[role];
    const span = Math.max(t, MIN_ROLE_SPAN);
    const under = softSat(Math.max(0, UNDER_BAND * t - c) / span, SOFT_WIDTH) * UNDER_SCALE;
    const over = softSat(Math.max(0, c - OVER_BAND * t) / span, SOFT_WIDTH) * OVER_SCALE;
    parts.push(`${ROLE_LABEL[role]} ${round2(c)}/${t}`);
    const pen = under + over;
    if (pen === 0) continue;
    value -= pen;
    const label = ROLE_LABEL[role];
    if (under > 0) {
      // Short: the shortfall belongs to the role as a whole. Name what it has,
      // or say it has nothing; either way the note carries the numbers.
      const have = members[role];
      if (have.length === 0) {
        notes.push({ name: `(no ${label})`, value: -under, note: `${label} 0 of target ${t}` });
      } else {
        for (const m of have) {
          notes.push({
            name: m.name,
            value: -under / have.length,
            note: `${label} is short: ${round2(c)} of target ${t}`,
          });
        }
      }
    }
    if (over > 0) {
      // Over: every member shares it, the weakest-tier members first in line.
      const total = members[role].reduce((s, m) => s + m.w, 0);
      for (const m of members[role]) {
        notes.push({
          name: m.name,
          value: -(over * m.w) / total,
          note: `${label} is overbuilt: ${round2(c)} against target ${t}`,
        });
      }
    }
  }
  return {
    value,
    summary: parts.length ? parts.join(', ') : 'no role targets',
    cards: notes,
  };
};
