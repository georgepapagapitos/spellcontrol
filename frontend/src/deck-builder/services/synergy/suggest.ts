/**
 * Off-meta suggester — the generative half of the synergy engine. Given a
 * deck's producer↔payoff analysis and a candidate pool, it finds the gaps
 * (a lopsided or half-built engine) and surfaces cards that fill them, each
 * with an explainable reason. Pure + isomorphic.
 *
 * This is the part EDHREC/inclusion ranking can't do: it recommends
 * mechanically-sound cards *because of what they do*, not because they're
 * popular — so it can surface off-meta fits the crowd hasn't aggregated.
 */
import { classifyCard } from './classify';
import type { CardLike } from './text';
import type { AxisKey } from './axes';
import type { DeckSynergy } from './deckSynergy';

export type AxisSide = 'producer' | 'payoff';

export interface SynergyNeed {
  axis: AxisKey;
  label: string;
  /** The side of the engine the deck is short on. */
  side: AxisSide;
}

export interface SynergyCandidate {
  card: CardLike;
  /** EDHREC inclusion % for this commander, if known (drives off-meta ranking). */
  inclusion?: number;
}

export interface SynergySuggestion {
  cardName: string;
  axis: AxisKey;
  axisLabel: string;
  side: AxisSide;
  /** Why it fits — straight from the classifier ("triggers when your creatures enter"). */
  reason: string;
  inclusion?: number;
}

/** A side is "starved" when it's outnumbered ≥3:1 by the other (and ≥1 exists). */
const LOPSIDED_RATIO = 3;
/** A not-yet-invested axis is a "budding engine" worth completing at this many cards. */
const BUDDING_MIN = 3;
/** Off-meta window: only suggest cards in this inclusion band (skip consensus + pure jank). */
const OFFMETA_MIN_INCLUSION = 2;
const OFFMETA_MAX_INCLUSION = 35;
const DEFAULT_PER_NEED = 4;

/**
 * What are the deck's engines missing? Two shapes:
 * - an *invested* axis that's lopsided (lots of producers, few payoffs → need payoffs)
 * - a *budding* axis (≥3 cards) with one side entirely absent → complete it.
 */
export function deriveNeeds(deck: DeckSynergy): SynergyNeed[] {
  const invested = new Set(deck.invested);
  const needs: SynergyNeed[] = [];
  for (const ax of deck.axes) {
    const p = ax.producers.length;
    const o = ax.payoffs.length;
    if (invested.has(ax.axis)) {
      if (p >= o * LOPSIDED_RATIO && o >= 1)
        needs.push({ axis: ax.axis, label: ax.label, side: 'payoff' });
      else if (o >= p * LOPSIDED_RATIO && p >= 1)
        needs.push({ axis: ax.axis, label: ax.label, side: 'producer' });
    } else if (ax.total >= BUDDING_MIN) {
      if (p >= 2 && o === 0) needs.push({ axis: ax.axis, label: ax.label, side: 'payoff' });
      else if (o >= 2 && p === 0) needs.push({ axis: ax.axis, label: ax.label, side: 'producer' });
    }
  }
  return needs;
}

export interface SuggestOptions {
  perNeed?: number;
  minInclusion?: number;
  maxInclusion?: number;
  /**
   * Reserve up to this many of each need's slots for *genuinely* off-meta
   * candidates — ones with no EDHREC inclusion (sourced by oracle search, the
   * crowd never aggregated them). Default 0 keeps the historic "most-validated
   * only" behavior. When > 0, these surface even alongside a full validated tail.
   */
  offMetaQuota?: number;
}

/**
 * Rank off-meta cards that fill the deck's synergy gaps. For each need, keep
 * candidates that classify onto the needed side of that axis and sit in the
 * off-meta inclusion window, then surface the most-validated of them first
 * (highest inclusion within the window — "real, just not consensus"). Dedups
 * across needs so one card is suggested once.
 */
export function suggestOffMeta(
  deck: DeckSynergy,
  candidates: SynergyCandidate[],
  opts: SuggestOptions = {}
): SynergySuggestion[] {
  const needs = deriveNeeds(deck);
  if (needs.length === 0) return [];

  const perNeed = opts.perNeed ?? DEFAULT_PER_NEED;
  const minIncl = opts.minInclusion ?? OFFMETA_MIN_INCLUSION;
  const maxIncl = opts.maxInclusion ?? OFFMETA_MAX_INCLUSION;
  const quota = opts.offMetaQuota ?? 0;

  const used = new Set<string>();
  const out: SynergySuggestion[] = [];

  for (const need of needs) {
    const matches: SynergySuggestion[] = [];
    for (const cand of candidates) {
      const name = cand.card.name;
      if (used.has(name)) continue;
      if (cand.inclusion != null && (cand.inclusion < minIncl || cand.inclusion > maxIncl))
        continue;
      const cs = classifyCard(cand.card);
      const roles = need.side === 'producer' ? cs.producers : cs.payoffs;
      const hit = roles.find((r) => r.axis === need.axis);
      if (!hit) continue;
      matches.push({
        cardName: name,
        axis: need.axis,
        axisLabel: need.label,
        side: need.side,
        reason: hit.reason,
        inclusion: cand.inclusion,
      });
    }
    // Validated fills (real EDHREC inclusion) lead, most-validated first.
    // Genuinely off-meta fills (no inclusion — the crowd never aggregated them)
    // get `quota` reserved slots so they surface even behind a full tail.
    const offMeta = matches.filter((m) => m.inclusion == null);
    const validated = matches
      .filter((m) => m.inclusion != null)
      .sort((a, b) => (b.inclusion ?? 0) - (a.inclusion ?? 0));
    const reserved = offMeta.slice(0, quota);
    const filler = [...validated, ...offMeta.slice(quota)];
    const selected = [...filler.slice(0, Math.max(0, perNeed - reserved.length)), ...reserved];
    for (const m of selected) {
      out.push(m);
      used.add(m.cardName);
    }
  }
  return out;
}
