/**
 * Structured, data-grounded "why" factors for a cut/swap suggestion.
 *
 * The deck builder's differentiation is explainable, multi-option editing (the
 * moat): a suggestion must not read as an opaque "weak slot" label — it should
 * explain *why this card*, in plain English, from signals the engine already
 * computed. These builders turn the raw signals (EDHREC inclusion, synergy-axis
 * overlap, ownership, combo membership) into short, tone-tagged bullets the
 * <WhyBreakdown> disclosure renders.
 *
 * Pure + unit-tested. Two rules keep it honest:
 *  1. Every factor is grounded in a real signal — never a fabricated comparison
 *     (we don't claim "+37% vs X" when we don't actually hold X's number).
 *  2. Factors *interpret*, they don't restate — the row already shows the raw
 *     inclusion %/synergy %/owned badge, so a factor adds meaning ("a staple in
 *     this archetype"), not the same number again.
 */

/** pro = a reason to do it · con = a tradeoff/caution · neutral = context. */
export type FactorTone = 'pro' | 'con' | 'neutral';

export interface WhyFactor {
  /** Plain-English, self-contained line. */
  text: string;
  tone: FactorTone;
}

const pct = (n: number): string => `${Math.round(n)}%`;

/** Inclusion → a one-word "how staple", matching DeckCardRow's <10/50 break. */
function stapleWord(inclusion: number): 'staple' | 'common' | 'fringe' {
  if (inclusion >= 50) return 'staple';
  if (inclusion >= 25) return 'common';
  return 'fringe';
}

export interface SwapAlternativeSignals {
  /** EDHREC inclusion % of the incoming card (0–100), if known. */
  inclusion?: number;
  /** EDHREC synergy delta of the incoming card, if known. */
  synergy?: number;
  /** Do we own a copy? */
  owned: boolean;
  /** Functional role display label, e.g. "Ramp". */
  roleLabel?: string;
  /** Commander name, for "with {commander}" phrasing. */
  commanderName?: string;
}

/**
 * Why this alternative is a good swap-in for the card being looked at. The row
 * shows the raw numbers; these lines interpret them so the choice between
 * same-role alternatives reads as a judgement, not six identical rows.
 */
export function buildSwapAlternativeFactors(s: SwapAlternativeSignals): WhyFactor[] {
  const out: WhyFactor[] = [];
  out.push(
    s.owned
      ? { text: 'Already in your collection — no purchase', tone: 'pro' }
      : { text: 'Not in your collection yet', tone: 'con' }
  );
  if (typeof s.inclusion === 'number') {
    const word = stapleWord(s.inclusion);
    out.push(
      word === 'fringe'
        ? { text: `A fringe pick (${pct(s.inclusion)}) — more of a pet card`, tone: 'neutral' }
        : { text: `A ${word} in similar decks (${pct(s.inclusion)})`, tone: 'pro' }
    );
  }
  if (typeof s.synergy === 'number' && s.synergy > 0) {
    out.push({
      text: `Pulls its weight on synergy${s.commanderName ? ` with ${s.commanderName}` : ''} (+${pct(s.synergy)})`,
      tone: 'pro',
    });
  }
  if (s.roleLabel) {
    out.push({ text: `Same ${s.roleLabel} role — your curve and counts hold`, tone: 'neutral' });
  }
  return out;
}

export interface BudgetSwapSignals {
  /** Confidence tier — the collapsed functional-equivalence judgement. */
  confidence: 'drop-in' | 'sidegrade' | 'budget';
  /** EDHREC inclusion % of the cheaper suggestion. */
  suggestionInclusion?: number;
  /** Owning the cheaper card makes the swap free — a bonus, surfaced only when true. */
  owned: boolean;
  /** CMC of each side, to back the "same curve slot" wording for a drop-in. */
  currentCmc?: number;
  suggestionCmc?: number;
}

/**
 * Why a cheaper card is a fair stand-in for an expensive one. The row already
 * shows the dollars saved and the confidence badge; these lines say what that
 * tier *means* in play terms, so a budget swap isn't a leap of faith. The
 * savings itself is not restated (it is the row's price delta). Unlike a normal
 * swap, "not owned" is the expected case (you buy the cheaper card), so a
 * not-owned con is suppressed — ownership only shows up as a bonus when true.
 */
export function buildBudgetSwapFactors(s: BudgetSwapSignals): WhyFactor[] {
  const out: WhyFactor[] = [];
  const sameCurve =
    typeof s.currentCmc === 'number' &&
    typeof s.suggestionCmc === 'number' &&
    Math.abs(s.currentCmc - s.suggestionCmc) <= 1;
  if (s.confidence === 'drop-in') {
    out.push({
      text: sameCurve
        ? 'Plays nearly the same — same curve slot, comparable play-rate'
        : 'Plays nearly the same — comparable play-rate',
      tone: 'pro',
    });
  } else if (s.confidence === 'sidegrade') {
    out.push({ text: 'A mild trade — less played, but the same mana cost', tone: 'neutral' });
  } else {
    out.push({ text: 'A real step down in power, traded for the savings', tone: 'con' });
  }
  if (typeof s.suggestionInclusion === 'number') {
    const word = stapleWord(s.suggestionInclusion);
    out.push(
      word === 'fringe'
        ? { text: `A fringe pick (${pct(s.suggestionInclusion)})`, tone: 'neutral' }
        : { text: `Still a ${word} in similar decks (${pct(s.suggestionInclusion)})`, tone: 'pro' }
    );
  }
  if (s.owned) {
    out.push({ text: 'You already own it — the swap is free', tone: 'pro' });
  }
  return out;
}

export interface CutSignals {
  /** Shares a synergy axis with the card being added. */
  sameAxis: boolean;
  /** Display label of the shared axis, when sameAxis. */
  axisLabel?: string;
  /** Shares the functional role (ramp/removal/…) with the add. */
  sameRole: boolean;
  /** Role label of the add, when sameRole. */
  roleLabel?: string;
  /** Shares the primary card type with the add. */
  sameType: boolean;
  /** Primary type label (e.g. "Creature"), when sameType. */
  typeLabel?: string;
  /** EDHREC inclusion % of the cut candidate (lower = more cuttable). */
  inclusion?: number;
  /** Combo-break warning, when the card is a piece of an in-deck combo. */
  comboWarning?: string;
}

/**
 * Why cutting *this* card makes room for the one being added — the breakdown
 * behind the one-line cut reason. Leads with a combo-break caution (never
 * blindside the user), then relatedness (a real like-for-like swap reads better
 * than "cut your weakest"), then how lightly the card is played.
 */
export function buildCutFactors(s: CutSignals): WhyFactor[] {
  const out: WhyFactor[] = [];
  if (s.comboWarning) out.push({ text: s.comboWarning, tone: 'con' });
  if (s.sameAxis && s.axisLabel) {
    out.push({ text: `Shares your ${s.axisLabel} engine — a like-for-like swap`, tone: 'pro' });
  } else if (s.sameRole && s.roleLabel) {
    out.push({ text: `Same ${s.roleLabel} role as the card you're adding`, tone: 'pro' });
  } else if (s.sameType && s.typeLabel) {
    out.push({ text: `Same card type (${s.typeLabel}) — fills the slot`, tone: 'neutral' });
  }
  if (typeof s.inclusion === 'number') {
    out.push(
      s.inclusion < 25
        ? { text: `Lightly played here (${pct(s.inclusion)} of decks)`, tone: 'pro' }
        : { text: `Played in ${pct(s.inclusion)} of decks`, tone: 'neutral' }
    );
  }
  return out;
}
