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

/**
 * EDHREC synergy as a whole percent. The score is a -1..1 fraction (0.12 is
 * "+12% more often with this commander than in its colors"), so rounding it
 * bare printed "+0%" for every card (E415).
 */
export const synergyPct = (synergy: number): number => Math.round(synergy * 100);

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
      ? { text: 'Already in your collection.', tone: 'pro' }
      : { text: 'Not in your collection yet', tone: 'con' }
  );
  if (typeof s.inclusion === 'number') {
    const word = stapleWord(s.inclusion);
    out.push(
      word === 'fringe'
        ? { text: `A fringe pick (${pct(s.inclusion)})`, tone: 'neutral' }
        : { text: `A ${word} in similar decks (${pct(s.inclusion)})`, tone: 'pro' }
    );
  }
  if (typeof s.synergy === 'number' && synergyPct(s.synergy) >= 1) {
    out.push({
      text: `Synergy${s.commanderName ? ` with ${s.commanderName}` : ''} (+${synergyPct(s.synergy)}%)`,
      tone: 'pro',
    });
  }
  if (s.roleLabel) {
    out.push({ text: `Same ${s.roleLabel} role.`, tone: 'neutral' });
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
        ? 'Plays nearly the same. Same curve slot and play-rate.'
        : 'Plays nearly the same. Similar play-rate.',
      tone: 'pro',
    });
  } else if (s.confidence === 'sidegrade') {
    out.push({ text: 'Less played, but the same mana cost.', tone: 'neutral' });
  } else {
    out.push({ text: 'A step down in power for the savings.', tone: 'con' });
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
    out.push({ text: 'You already own it. The swap is free.', tone: 'pro' });
  }
  return out;
}

export interface GapAddSignals {
  /** Display label of the role the deck is short on, e.g. "Ramp". */
  roleLabel?: string;
  /** EDHREC inclusion % (0–100). */
  inclusion?: number;
  /** EDHREC synergy delta (can be negative; only positive is surfaced). */
  synergy?: number;
  /** Lift co-play seed names (strongest first) this card is connected to. */
  liftedBy?: string[];
  owned: boolean;
  /** True when the Staples <-> Brew dial is leaned toward Brew AND this card
   *  has real evidence of fit (synergy or lift) despite being a fringe/
   *  non-staple pick — i.e. exactly the case the dial was built to surface.
   *  Never set for a merely-obscure card with no synergy/lift backing. */
  brewFavored?: boolean;
}

/**
 * Why a missing staple belongs in this deck (the Fill-the-gaps lane and the
 * in-context same-role alternatives). Leads with the gap it closes, then the
 * package evidence (lift co-play), then how established the card is.
 */
export function buildGapAddFactors(s: GapAddSignals): WhyFactor[] {
  const out: WhyFactor[] = [];
  if (s.roleLabel) {
    out.push({ text: `Your deck is light on ${s.roleLabel}.`, tone: 'pro' });
  }
  if (s.liftedBy?.length) {
    out.push({
      text: `Often played with ${s.liftedBy.join(', ')}`,
      tone: 'pro',
    });
  }
  if (typeof s.inclusion === 'number') {
    const word = stapleWord(s.inclusion);
    out.push(
      word === 'fringe'
        ? { text: `A fringe pick (${pct(s.inclusion)})`, tone: 'neutral' }
        : { text: `A ${word} in similar decks (${pct(s.inclusion)})`, tone: 'pro' }
    );
  }
  if (typeof s.synergy === 'number' && synergyPct(s.synergy) >= 1) {
    out.push({
      text: `Played more with this commander (+${synergyPct(s.synergy)}%)`,
      tone: 'pro',
    });
  }
  if (s.owned) out.push({ text: 'Already in your collection.', tone: 'pro' });
  if (s.brewFavored) {
    out.push({
      text: 'Fits the commander, though few decks play it.',
      tone: 'neutral',
    });
  }
  return out;
}

export interface SynergyPickSignals {
  /** Display label of the engine axis, e.g. "Tokens". */
  axisLabel: string;
  /** Which half of the engine the card is. */
  side: 'producer' | 'payoff';
  /** EDHREC inclusion % — undefined for genuinely off-meta (oracle-found) picks. */
  inclusion?: number;
}

/**
 * Why an engine-completion pick fits (the Upgrade lane's synergy picks). These
 * cards are found by reading oracle text against the deck's own axes, not by
 * play-rate — the factors own that framing instead of hiding it.
 */
export function buildSynergyPickFactors(s: SynergyPickSignals): WhyFactor[] {
  const out: WhyFactor[] = [];
  out.push(
    s.side === 'payoff'
      ? { text: `Pays off your ${s.axisLabel} engine.`, tone: 'pro' }
      : { text: `Feeds your ${s.axisLabel} payoffs.`, tone: 'pro' }
  );
  out.push(
    typeof s.inclusion === 'number'
      ? { text: `Under the radar: ${pct(s.inclusion)} of similar decks run it`, tone: 'neutral' }
      : {
          text: 'An off-meta pick with no play-rate data.',
          tone: 'neutral',
        }
  );
  return out;
}

export interface OptimizeSignals {
  /** The optimizer's grouping key, e.g. 'tapland', 'excess:ramp', 'fills:removal'.
   *  Optional: older persisted rows can lack it — the builder then skips the lead line. */
  reasonCategory?: string;
  roleLabel?: string;
  /** EDHREC inclusion % — null when unknown. */
  inclusion?: number | null;
  cmc?: number;
  isGameChanger?: boolean;
}

/** Category → interpretation for an Optimize CUT. */
function optimizeCutLine(s: OptimizeSignals): WhyFactor | null {
  const cat = s.reasonCategory ?? '';
  if (cat === 'tapland')
    return { text: 'Enters tapped: a tempo tax every time you draw it', tone: 'pro' };
  if (cat === 'excess-land')
    return { text: 'Over your land target. A land is the safest cut.', tone: 'pro' };
  if (cat === 'oversupplied-basic')
    return { text: 'More basics of this color than you need', tone: 'pro' };
  if (cat === 'color-rebalance')
    return {
      text: 'A spare basic in this color. Land count stays the same.',
      tone: 'pro',
    };
  if (cat.startsWith('excess:'))
    return {
      text: `You're oversupplied on ${s.roleLabel ?? 'this role'}. This is the weakest copy.`,
      tone: 'pro',
    };
  if (cat === 'off-package')
    return {
      text: 'Nothing else here plays with it.',
      tone: 'pro',
    };
  if (cat === 'low-synergy')
    return { text: "Underperforms in this commander's decks", tone: 'pro' };
  if (cat === 'curve-fix')
    return {
      text: `Your curve is top-heavy. A ${s.cmc ?? 'high'}-drop is the pressure point.`,
      tone: 'pro',
    };
  return null; // low-inclusion & unknown: the inclusion line below carries it
}

/** Category → interpretation for an Optimize ADD. */
function optimizeAddLine(s: OptimizeSignals): WhyFactor | null {
  const cat = s.reasonCategory ?? '';
  if (cat.startsWith('fills:'))
    return {
      text: `Your ${s.roleLabel ?? 'role'} count is under target.`,
      tone: 'pro',
    };
  if (cat === 'mana-fix')
    return {
      text: 'Your mana base graded low. This adds a source.',
      tone: 'pro',
    };
  if (cat === 'color-fix') return { text: "Fixes a color you're short on", tone: 'pro' };
  if (cat === 'color-rebalance')
    return {
      text: 'Fixes a color shortfall. Land count stays the same.',
      tone: 'pro',
    };
  if (cat === 'flex-land')
    return { text: "A land that's also a spell, so flooding costs less.", tone: 'pro' };
  if (cat.startsWith('curve:')) return { text: 'Fills a gap in your curve', tone: 'pro' };
  if (cat === 'theme' || cat === 'synergy')
    return {
      text: 'Picked for synergy with this commander',
      tone: 'pro',
    };
  return null;
}

/**
 * Why the Optimize engine wants this card in or out — the breakdown behind its
 * one-line reason. The category line interprets the engine's diagnosis; the
 * inclusion line grounds how established (or cuttable) the card is.
 */
export function buildOptimizeFactors(kind: 'add' | 'cut', s: OptimizeSignals): WhyFactor[] {
  const out: WhyFactor[] = [];
  const lead = kind === 'cut' ? optimizeCutLine(s) : optimizeAddLine(s);
  if (lead) out.push(lead);
  if (typeof s.inclusion === 'number') {
    if (kind === 'cut') {
      out.push(
        s.inclusion < 25
          ? { text: `Lightly played here (${pct(s.inclusion)} of decks)`, tone: 'pro' }
          : { text: `Played in ${pct(s.inclusion)} of decks`, tone: 'neutral' }
      );
    } else {
      const word = stapleWord(s.inclusion);
      out.push(
        word === 'fringe'
          ? { text: `A fringe pick (${pct(s.inclusion)})`, tone: 'neutral' }
          : { text: `A ${word} in similar decks (${pct(s.inclusion)})`, tone: 'pro' }
      );
    }
  }
  if (s.isGameChanger) {
    out.push(
      kind === 'cut'
        ? { text: 'A Game Changer. Cutting it eases your bracket.', tone: 'neutral' }
        : {
            text: 'A Game Changer. It counts toward your bracket.',
            tone: 'neutral',
          }
    );
  }
  return out;
}

export interface BracketMoveSignals {
  type: 'add' | 'cut' | 'swap';
  /** The bracket signal that triggered the move (BracketFitSignal). */
  signal: string;
  roleLabel?: string;
  /** Inclusion of the incoming/added card, when known. */
  inclusion?: number;
}

/** Bracket-signal → what it means at the table. Grounded in the official bracket definitions. */
const BRACKET_SIGNAL_LINES: Record<string, string> = {
  'game-changer': "On the Game Changers list, over your target bracket's cap",
  'mass-land-denial': 'Mass land denial, reserved for Bracket 4+',
  stax: 'A stax piece, heavy for your target bracket',
  combo: 'A compact combo, above your target bracket',
  'extra-turn': 'Chained extra turns read as Bracket 4–5',
  'fast-mana': 'Fast mana, above your target bracket',
  tutor: 'A tutor, above your target bracket',
  'upshift-gc': 'A Game Changer, more power toward your target',
  'upshift-combo': 'Completes a compact combo, a real win line at your target',
  'upshift-fill': 'A proven staple that adds power',
};

/**
 * Why a Bracket Fit move gets the deck to its target — the signal line says
 * what the card means for bracket rules; a swap adds the like-for-like comfort.
 */
export function buildBracketMoveFactors(s: BracketMoveSignals): WhyFactor[] {
  const out: WhyFactor[] = [];
  const line = BRACKET_SIGNAL_LINES[s.signal];
  if (line) out.push({ text: line, tone: 'pro' });
  if (s.type === 'swap' && s.roleLabel) {
    out.push({
      text: `Same ${s.roleLabel} slot. Only the power changes.`,
      tone: 'neutral',
    });
  }
  if (s.type !== 'cut' && typeof s.inclusion === 'number') {
    const word = stapleWord(s.inclusion);
    out.push(
      word === 'fringe'
        ? { text: `A fringe pick (${pct(s.inclusion)})`, tone: 'neutral' }
        : { text: `A ${word} in similar decks (${pct(s.inclusion)})`, tone: 'pro' }
    );
  }
  return out;
}

export interface LandUpgradeSignals {
  /** Colors this incoming land helps cover that the deck was short on. */
  fixesShortColors: string[];
  /** New colors it adds over the land being cut (color names, not letters). */
  addsColors: string[];
  /** Whether the incoming land carries non-mana upside / is a proven fixer type. */
  strongerFixing: boolean;
  /** Whether the user owns a copy — drives the "already own" vs "acquire" line. */
  owned: boolean;
  /** Name of the land being cut, for the like-for-like line. */
  outName: string;
}

/**
 * Why swapping in a stronger land is an upgrade — grounded in the merit score,
 * never EDHREC popularity (the whole point is that this surfaces strong lands
 * too new for EDHREC to have rated). Leads with the fixing win, and closes with
 * whether it's a land you already have or one worth acquiring.
 */
export function buildLandUpgradeFactors(s: LandUpgradeSignals): WhyFactor[] {
  const out: WhyFactor[] = [];
  if (s.fixesShortColors.length > 0) {
    out.push({
      text: `Covers ${s.fixesShortColors.join(' and ')}, which the deck was short on`,
      tone: 'pro',
    });
  } else if (s.addsColors.length > 0) {
    out.push({
      text: `Adds ${s.addsColors.join(' and ')} and keeps every color ${s.outName} made`,
      tone: 'pro',
    });
  }
  if (s.strongerFixing) {
    out.push({ text: 'Stronger fixing or extra upside', tone: 'neutral' });
  }
  out.push(
    s.owned
      ? { text: 'A land you already own.', tone: 'pro' }
      : { text: "Worth acquiring. You don't own it yet.", tone: 'neutral' }
  );
  return out;
}

export interface ComboCompletionSignals {
  /** Total pieces in the combo (including the missing one). */
  totalPieces: number;
  /** How many decks run this combo (Spellbook/EDHREC global count). */
  popularity?: number;
  owned: boolean;
}

/**
 * Why completing this combo is the feed's strongest move — the pieces you
 * already hold, how proven the line is, and the bracket caution a compact
 * combo deserves (never blindside the user into a power jump).
 */
export function buildComboCompletionFactors(s: ComboCompletionSignals): WhyFactor[] {
  const out: WhyFactor[] = [];
  out.push({
    text: `You already run ${s.totalPieces - 1} of ${s.totalPieces} pieces. This is the last one.`,
    tone: 'pro',
  });
  if (typeof s.popularity === 'number' && s.popularity >= 1000) {
    out.push({
      text: `A proven line: ${s.popularity.toLocaleString()} decks run this combo`,
      tone: 'pro',
    });
  }
  if (s.totalPieces === 2) {
    out.push({
      text: 'A two-card combo. Mind your bracket.',
      tone: 'con',
    });
  }
  if (s.owned) out.push({ text: 'You own the missing piece.', tone: 'pro' });
  return out;
}

export interface CrossDeckMoveSignals {
  /** Display labels of the sibling deck's established engines this card reinforces. */
  targetAxisLabels: string[];
  toDeckName: string;
  fromDeckName: string;
}

/**
 * Why moving this card between decks is the right call (the "Between your
 * decks" feed). The donor side is why-factors' one unconditional line: by
 * construction (see `cross-deck-moves.ts`) a suggestion only exists when the
 * card reinforces none of the donor's own established engines, so that's
 * always true and always worth saying — it's the whole reason the card reads
 * as "generic value" there instead of load-bearing.
 */
export function buildCrossDeckMoveFactors(s: CrossDeckMoveSignals): WhyFactor[] {
  const out: WhyFactor[] = [];
  if (s.targetAxisLabels.length > 0) {
    out.push({
      text: `Feeds ${s.toDeckName}'s ${s.targetAxisLabels.join(' & ')} engine`,
      tone: 'pro',
    });
  }
  out.push({
    text: `Not part of any of ${s.fromDeckName}'s engines.`,
    tone: 'pro',
  });
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
    out.push({ text: `Shares your ${s.axisLabel} engine`, tone: 'pro' });
  } else if (s.sameRole && s.roleLabel) {
    out.push({ text: `Same ${s.roleLabel} role as the card you're adding`, tone: 'pro' });
  } else if (s.sameType && s.typeLabel) {
    out.push({ text: `Same card type (${s.typeLabel})`, tone: 'neutral' });
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

/**
 * E222: the cardFit misfit cascade → factors for a Cuts-lane row.
 *
 * Uses each reason's `detail`, not its `label`: the label restates the raw
 * number the row already renders ("Played in 2% of decklists"), while the
 * detail is the interpretation that earns a factor slot ("Below the inclusion
 * floor (5%)"). That's rule 2 in this file's header.
 *
 * Tone is `pro` throughout — on a CUT row, evidence the card doesn't fit is a
 * reason to take the suggested action, matching how `buildCutFactors` tags
 * "Lightly played here".
 */
export function buildMisfitFactors(reasons: { label: string; detail: string }[]): WhyFactor[] {
  return reasons.map((r) => ({ text: r.detail, tone: 'pro' as const }));
}
