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
    out.push({ text: `Your deck is light on ${s.roleLabel} — this closes the gap`, tone: 'pro' });
  }
  if (s.liftedBy?.length) {
    out.push({
      text: `Co-played with ${s.liftedBy.join(', ')} far beyond chance — a package fit`,
      tone: 'pro',
    });
  }
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
      text: `Overperforms with this commander (+${pct(s.synergy)} vs baseline)`,
      tone: 'pro',
    });
  }
  if (s.owned) out.push({ text: 'Already in your collection — no purchase', tone: 'pro' });
  if (s.brewFavored) {
    out.push({
      text: 'You dialed toward Brew — deep cuts like this get weighted over play-rate',
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
      ? { text: `A payoff for your ${s.axisLabel} engine — the fuel is already here`, tone: 'pro' }
      : { text: `Feeds your ${s.axisLabel} payoffs — more fuel for what you run`, tone: 'pro' }
  );
  out.push(
    typeof s.inclusion === 'number'
      ? { text: `Under the radar — ${pct(s.inclusion)} of similar decks run it`, tone: 'neutral' }
      : {
          text: 'Found by reading the card text, not play-rate — an off-meta edge',
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
    return { text: 'Enters tapped — a tempo tax every time you draw it', tone: 'pro' };
  if (cat === 'excess-land')
    return { text: 'The deck is over its land target — a land is the safest trim', tone: 'pro' };
  if (cat === 'oversupplied-basic')
    return { text: 'More basics of this color than your costs actually need', tone: 'pro' };
  if (cat === 'color-rebalance')
    return {
      text: 'A swap, not a loss — this color holds more basics than its costs use',
      tone: 'pro',
    };
  if (cat.startsWith('excess:'))
    return {
      text: `You're oversupplied on ${s.roleLabel ?? 'this role'} — this is the weakest copy`,
      tone: 'pro',
    };
  if (cat === 'off-package')
    return {
      text: "No co-play ties to anything else here — it isn't part of a package",
      tone: 'pro',
    };
  if (cat === 'low-synergy')
    return { text: "Underperforms in this commander's decks", tone: 'pro' };
  if (cat === 'curve-fix')
    return {
      text: `Your curve is top-heavy — a ${s.cmc ?? 'high'}-drop is the pressure point`,
      tone: 'pro',
    };
  return null; // low-inclusion & unknown: the inclusion line below carries it
}

/** Category → interpretation for an Optimize ADD. */
function optimizeAddLine(s: OptimizeSignals): WhyFactor | null {
  const cat = s.reasonCategory ?? '';
  if (cat.startsWith('fills:'))
    return {
      text: `Your ${s.roleLabel ?? 'role'} count is under target — this closes the gap`,
      tone: 'pro',
    };
  if (cat === 'mana-fix')
    return {
      text: 'Your mana base graded low — another good source helps every game',
      tone: 'pro',
    };
  if (cat === 'color-fix')
    return { text: 'Fixes the color your current sources shortchange', tone: 'pro' };
  if (cat === 'color-rebalance')
    return {
      text: 'Closes a color shortfall the deck itself flags — net-zero land count',
      tone: 'pro',
    };
  if (cat === 'flex-land')
    return { text: "A land that's also a spell — flex slots cut flood at no cost", tone: 'pro' };
  if (cat.startsWith('curve:')) return { text: 'Fills a quiet phase of your curve', tone: 'pro' };
  if (cat === 'theme' || cat === 'synergy')
    return {
      text: 'Overperforms with this commander — picked on synergy, not just play-rate',
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
        ? { text: 'A Game Changer — cutting it also eases your bracket weight', tone: 'neutral' }
        : {
            text: 'A Game Changer — real power, and it counts toward your bracket',
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
  'game-changer': "On the official Game Changers list — over your target bracket's cap",
  'mass-land-denial': 'Mass land denial — reserved for Bracket 4+',
  stax: 'A stax piece — heavier than your target bracket expects',
  combo: 'Part of a compact combo line — plays above your target',
  'extra-turn': 'Chained extra turns read as Bracket 4–5',
  'fast-mana': 'Fast mana accelerates everything past your target',
  tutor: 'Tutors add consistency beyond your target bracket',
  'upshift-gc': 'A Game Changer — real power toward your target',
  'upshift-combo': 'Completes a compact combo — a genuine win line at your target',
  'upshift-fill': 'A proven staple to tighten the deck upward',
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
      text: `Same ${s.roleLabel} slot — the function stays, the power moves`,
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
  /** Name of the land being cut, for the like-for-like line. */
  outName: string;
}

/**
 * Why swapping in a land from your collection is an upgrade — grounded in the
 * merit score, never EDHREC popularity (the whole point is that this surfaces
 * strong lands too new for EDHREC to have rated). Leads with the fixing win.
 */
export function buildLandUpgradeFactors(s: LandUpgradeSignals): WhyFactor[] {
  const out: WhyFactor[] = [];
  if (s.fixesShortColors.length > 0) {
    out.push({
      text: `Covers ${s.fixesShortColors.join(' and ')} — a color your manabase was short on`,
      tone: 'pro',
    });
  } else if (s.addsColors.length > 0) {
    out.push({
      text: `Adds ${s.addsColors.join(' and ')} while keeping every color ${s.outName} made`,
      tone: 'pro',
    });
  }
  if (s.strongerFixing) {
    out.push({ text: 'Rated on the card itself, not its popularity', tone: 'neutral' });
  }
  out.push({ text: `A land you already own — no acquisition needed`, tone: 'pro' });
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
    text: `You already run ${s.totalPieces - 1} of ${s.totalPieces} pieces — this is the last one`,
    tone: 'pro',
  });
  if (typeof s.popularity === 'number' && s.popularity >= 1000) {
    out.push({
      text: `A proven line — ${s.popularity.toLocaleString()} decks run this combo`,
      tone: 'pro',
    });
  }
  if (s.totalPieces === 2) {
    out.push({
      text: "A live two-card combo once it lands — mind your bracket's expectations",
      tone: 'con',
    });
  }
  if (s.owned) out.push({ text: 'You own the missing piece — free to assemble', tone: 'pro' });
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
      text: `Feeds ${s.toDeckName}'s ${s.targetAxisLabels.join(' & ')} engine — an established payoff there`,
      tone: 'pro',
    });
  }
  out.push({
    text: `Doesn't touch any of ${s.fromDeckName}'s own engines — a generic value pick there`,
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
