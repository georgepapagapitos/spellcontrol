/**
 * The search's trust region: what a swap must NOT do, however well it
 * scores. The first optimizer gate (2026-09-29) regressed 13 of 15 decks
 * while the objective agreed with the differ on the generator's own changes
 * 77% of the time: a free search found exactly the cards the score reads
 * wrong (tutors at their 12% inclusion, Boseiju as a land, Umbral Mantle as
 * an equipment with no role) and traded them for cards it reads right. The
 * score is a good judge of the decks the generator makes and a poor one of
 * the decks a search can reach. So a swap is a small, well-evidenced step
 * away from a deck the generator (and the page's players) already vouch for:
 *
 * 1. Protected cards, unless the move repairs a broken hard constraint:
 *    - a piece of a complete combo in the deck, and a tutor that finds one,
 *      never leave: the line is a plan, and the gate called every broken one
 *      a loss, even for a more popular card (Kozilek's Karn + Mycosynth
 *      Lattice for Thran Dynamo);
 *    - a protection piece (as its text bears it out: factsReading.ts), a
 *      land that is also interaction (Boseiju, Who Endures), a Game Changer
 *      (the deck's power, which a target of "any" keeps) and a staple
 *      (STAPLE_BAR% or more of the page's decks: the generator's staple
 *      bar, E532) leave only for a card played at least as often on this
 *      commander's page (its price-adjusted inclusion, the quality prior),
 *      each protected card matched to its own incoming card, and a Game
 *      Changer only for another.
 * 2. Role floors. No swap takes ramp, draw, removal or wipes below the plan's
 *    target (or further below it), counted the way the deck report counts
 *    them (`roleOf`), so the report never shows a role the search emptied.
 * 3. A margin that grows with the distance from the page: a swap must gain
 *    `minGain` plus DRIFT × how much less played the incoming cards are
 *    (Σ out-quality − Σ in-quality, when positive). A popular card gives way
 *    to a less popular one only for a large, stated reason.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { getByCardName } from '@/lib/cards/card-text';
import { countsAsRole, TIER_WEIGHT, type FactRole } from '@/deck-builder/services/cardFacts';
import { completeCombos } from './constraints';
import { isBasicLand, isLandCard } from './context';
import { protectionValue } from './terms/interaction';
import { readTutors } from './terms/tutors';
import { OBJECTIVE_ROLES, type ObjectiveContext, type ObjectiveDeck } from './types';

/** The generator's staple bar (cardPicking.ts STAPLE_INCLUSION_BAR, E532): in this share (%) of the page's decks. */
export const STAPLE_BAR = 40;
/** Extra gain per unit of quality the swap gives up (1: a 0.3 drop needs 0.3 more). */
export const DRIFT = 1;

export interface TrustOptions {
  /** Staple bar in percent. Default STAPLE_BAR. */
  stapleBar?: number;
  /** Margin per unit of quality given up. Default DRIFT. */
  drift?: number;
  /**
   * The role a card counts toward, as the deck report counts it (the harness
   * passes commanderDeckAnalysis's countedRoleOf). Default: the objective's
   * own card-facts reading (primary or secondary role, one per card).
   */
  roleOf?: (card: ScryfallCard) => string | null;
}

export type ProtectedClass =
  'combo piece' | 'combo tutor' | 'protection' | 'interaction land' | 'Game Changer' | 'staple';

/** Classes that never leave outside a repair. */
const STRICT: ReadonlySet<ProtectedClass> = new Set(['combo piece', 'combo tutor']);

export interface Protection {
  cls: ProtectedClass;
  /** Why, in words: "a piece of Hermit Druid + Thassa's Oracle". */
  why: string;
}

/** The protected class of each card in a deck, by name. */
export function protectedCards(
  deck: ObjectiveDeck,
  ctx: ObjectiveContext,
  stapleBar = STAPLE_BAR
): Map<string, Protection> {
  const out = new Map<string, Protection>();
  const combos = completeCombos(deck, ctx);
  for (const c of combos) {
    for (const n of c.cards) {
      const card = deck.cards.find((d) => d.name === n || d.name.split(' // ')[0] === n);
      if (card && !out.has(card.name)) {
        out.set(card.name, { cls: 'combo piece', why: `a piece of ${c.cards.join(' + ')}` });
      }
    }
  }
  for (const t of readTutors(deck, ctx)) {
    if (t.why.startsWith('a piece of') && !out.has(t.name)) {
      out.set(t.name, { cls: 'combo tutor', why: `the tutor that finds ${t.target}` });
    }
  }
  for (const card of deck.cards) {
    if (out.has(card.name) || isBasicLand(card)) continue;
    const facts = ctx.factsOf(card);
    if (isLandCard(card)) {
      if (facts.interaction.length > 0) {
        out.set(card.name, { cls: 'interaction land', why: 'a land that is also interaction' });
      }
    } else if (protectionValue(card, facts) > 0) {
      out.set(card.name, { cls: 'protection', why: 'a protection piece' });
    }
  }
  for (const card of deck.cards) {
    if (out.has(card.name)) continue;
    if (
      ctx.gameChangerNames.has(card.name) ||
      ctx.gameChangerNames.has(card.name.split(' // ')[0])
    ) {
      out.set(card.name, { cls: 'Game Changer', why: 'a Game Changer' });
    }
  }
  for (const card of deck.cards) {
    // Basics swap only for basics, and their page rows say nothing about a slot.
    if (out.has(card.name) || isBasicLand(card)) continue;
    const pct = inclusionPct(card, ctx);
    if (pct >= stapleBar) {
      out.set(card.name, { cls: 'staple', why: `a staple (${Math.round(pct)}% of decks)` });
    }
  }
  return out;
}

/** EDHREC inclusion on this page, in percent (0 off the page). */
export function inclusionPct(card: ScryfallCard, ctx: ObjectiveContext): number {
  return getByCardName(ctx.edhrec, card.name)?.inclusion ?? 0;
}

const FACT_ROLE: Partial<Record<FactRole, string>> = {
  ramp: 'ramp',
  cardDraw: 'cardDraw',
  removal: 'removal',
  boardwipe: 'boardwipe',
};

/** The objective's own one-role-per-card reading, used when no report counter is given. */
export function factsRoleOf(ctx: ObjectiveContext): (card: ScryfallCard) => string | null {
  return (card) => {
    if (isLandCard(card)) return null;
    let best: { role: string; w: number } | null = null;
    for (const f of ctx.factsOf(card).roles) {
      const role = FACT_ROLE[f.role];
      if (!role || !countsAsRole(f)) continue;
      const w = TIER_WEIGHT[f.tier];
      if (!best || w > best.w) best = { role, w };
    }
    return best?.role ?? null;
  };
}

/** Role counts of a deck under `roleOf`. */
export function countRoles(
  deck: ObjectiveDeck,
  roleOf: (card: ScryfallCard) => string | null
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of deck.cards) {
    const r = roleOf(c);
    if (r) counts[r] = (counts[r] ?? 0) + 1;
  }
  return counts;
}

export interface TrustVerdict {
  /** Why the move is out of bounds, or null. */
  blocked: string | null;
  /** What bound it: a protected class or a role floor. */
  bound: ProtectedClass | 'role floor' | null;
  /** The gain the move must reach. */
  required: number;
}

/**
 * Judge a move against the trust region. `protectedNow` is protectedCards()
 * of the current deck and `rolesNow` its countRoles(); a repair skips the
 * protections (a constraint forces the move) and keeps the margin at `minGain`.
 */
export function trustVerdict(
  rolesNow: Readonly<Record<string, number>>,
  outs: readonly ScryfallCard[],
  ins: readonly ScryfallCard[],
  ctx: ObjectiveContext,
  protectedNow: ReadonlyMap<string, Protection>,
  minGain: number,
  opts: TrustOptions & { repair?: boolean } = {}
): TrustVerdict {
  const drift = opts.drift ?? DRIFT;
  const lostQuality =
    outs.reduce((s, c) => s + ctx.qualityOf(c).q, 0) -
    ins.reduce((s, c) => s + ctx.qualityOf(c).q, 0);
  const required = minGain + drift * Math.max(0, lostQuality);
  if (opts.repair) return { blocked: null, bound: null, required: minGain };

  // Each protected card needs its own incoming card played at least as
  // often, read price-adjusted (context.ts: a $60 card's inclusion
  // understates how much its players want it), most played first. A Game
  // Changer's must itself be a Game Changer: the list is the bracket
  // system's measure of power, and trading one for an ordinary card lowers
  // the deck's tier (the first gate's Lathril and Meren fell from bracket 4).
  const isGc = (c: ScryfallCard) =>
    ctx.gameChangerNames.has(c.name) || ctx.gameChangerNames.has(c.name.split(' // ')[0]);
  const q = (c: ScryfallCard) => ctx.qualityOf(c).q;
  const free = [...ins].sort((a, b) => q(b) - q(a));
  const guarded = outs.filter((c) => protectedNow.has(c.name)).sort((a, b) => q(b) - q(a));
  for (const c of guarded) {
    const p = protectedNow.get(c.name)!;
    if (STRICT.has(p.cls)) {
      return { blocked: `${c.name} is ${p.why}`, bound: p.cls, required };
    }
    const match = free.findIndex((x) => q(x) >= q(c) && (p.cls !== 'Game Changer' || isGc(x)));
    if (match < 0) {
      return {
        blocked:
          p.cls === 'Game Changer'
            ? `${c.name} is a Game Changer, and no Game Changer played as often comes in`
            : `${c.name} is ${p.why}, and nothing coming in is played as often`,
        bound: p.cls,
        required,
      };
    }
    free.splice(match, 1);
  }

  const roleOf = opts.roleOf ?? factsRoleOf(ctx);
  for (const role of OBJECTIVE_ROLES) {
    const target = ctx.roleTargets[role];
    if (!target) continue;
    const lose = outs.filter((c) => roleOf(c) === role).length;
    const gain = ins.filter((c) => roleOf(c) === role).length;
    if (lose <= gain) continue;
    const after = (rolesNow[role] ?? 0) - lose + gain;
    if (after < target) {
      return {
        blocked: `${role} would fall to ${after} of target ${target}`,
        bound: 'role floor',
        required,
      };
    }
  }
  return { blocked: null, bound: null, required };
}
