/**
 * Pure win-condition detector. Composes existing signals:
 *   - combo produces[] labels (infinite combo)
 *   - synergy deckSynergy.invested axes
 *   - oracle-text utilities from synergy/text.ts
 *   - ParsedCard oracle scan for alt-win / burn / drain
 *
 * No DOM, no network. Pure + isomorphic.
 */

import {
  parseCard,
  splitClauses,
  millSignals,
  sacrificeSignals,
  tokenCreation,
} from '../synergy/text';
import type { ParsedCard } from '../synergy/text';
import { classifyCard } from '../synergy/classify';
import type { DeckSynergy } from '../synergy/deckSynergy';
import type { CardLike } from '../synergy/text';
import type { WinCondition, WinConditionAnalysis } from './types';

export interface DetectedComboForWinCon {
  /** Commander Spellbook produces[] labels: "Win the game", "Infinite damage", etc. */
  results: string[];
  cards: string[];
}

export interface WinConditionInput {
  cards: CardLike[];
  commander: CardLike | null;
  /** Partner commander — like `commander`, excluded from assembly sets (it
   *  starts in the command zone, never the library). */
  partnerCommander?: CardLike | null;
  combosInDeck: DetectedComboForWinCon[];
  deckSynergy: DeckSynergy;
  /** Format string — "commander" gates voltron/commander-damage path. */
  format: string;
}

// ── Alt-win oracle scan ───────────────────────────────────────────────────────

/** Main regex: catches "you win the game" and close variants. */
const YOU_WIN_RE = /\byou win the game\b/;
/** Secondary: "each opponent loses the game" (Thassa-adjacent effects). */
const EACH_OPP_LOSES_RE = /\beach opponent (?:loses|lost) the game\b/;

/**
 * Curated oracle-ID / exact-name gap-filler for cards the regex misses or
 * would over-match. Key = lowercase canonical name; value = true = include,
 * false = exclude.
 */
const ALT_WIN_OVERRIDES: Record<string, boolean> = {
  // Lab Maniac triggers on a draw replacement — oracle says "you would draw a
  // card but can't, you win the game" (reminder text varies per printing).
  'laboratory maniac': true,
  // Jace, Wielder of Mysteries ability says "you win the game" directly.
  'jace, wielder of mysteries': true,
  // "You can't lose the game" (Platinum Angel, Lich's Mastery) → exclude.
  'platinum angel': false,
  "lich's mastery": false,
  // Abyssal Persecutor prevents opponents from winning, not you.
  'abyssal persecutor': false,
};

function isAltWin(oracle: string, name: string): boolean {
  const nameLc = name.toLowerCase();
  const override = ALT_WIN_OVERRIDES[nameLc];
  if (override === true) return true;
  if (override === false) return false;
  return YOU_WIN_RE.test(oracle) || EACH_OPP_LOSES_RE.test(oracle);
}

// ── Tutor scan (assembly-clock wildcards) ────────────────────────────────────

/**
 * A non-land tutor fetches a missing win-path piece, so the assembly clock
 * counts it as a wildcard. Only the first search clause is inspected, and
 * land-only tutors (Rampant Growth, fetchlands) are excluded — they can't
 * find a combo piece.
 */
// ponytail: type-narrow tutors (Mystical, Stoneforge) count at full weight;
// scope them to matching-type pieces if the clock reads too optimistic.
const LAND_TARGET_RE = /\bland\b|\bplains\b|\bisland\b|\bswamp\b|\bmountain\b|\bforest\b|\bgate\b/;

function isTutor(oracle: string): boolean {
  const clause = oracle.match(/search(?:es)? your library for ([^.;]*)/);
  return clause !== null && !LAND_TARGET_RE.test(clause[1]);
}

/**
 * Single-card win condition (alt-win text). The only category where ONE card
 * creates a detector path by itself — every strategic plan (burn, drain, mill,
 * go-wide…) needs committed counts. Used by the generation wincon repair to
 * pick a finisher it can add with a single swap.
 */
export function isAltWinCard(card: CardLike): boolean {
  return isAltWin(parseCard(card).oracle, card.name);
}

// ── Burn detection (direct damage to players) ────────────────────────────────

// `(?:\d+|x)` is load-bearing: most commander burn FINISHERS deal `X` damage
// (Fireball, Comet Storm, Crackle with Power), not a fixed number — a `\d+`-only
// regex silently misses the entire X-spell family, which is the bulk of the
// archetype.
// "damage equal to its power" covers the Warstorm Surge / Terror of the Peaks
// engines, whose damage has no literal amount.
const BURN_RE =
  /deals? (?:(?:\d+|x) damage|damage equal to [a-z' ]+?) to (?:(?:target|each) (?:player|opponent)|any target|players)/;

/** A clause that fires repeatedly: a "whenever"/upkeep trigger or an activated
 *  ability. A one-shot "when X enters/dies" is deliberately NOT repeatable.
 *  Trigger words are unanchored because the normaliser folds a keyword line
 *  into the next clause ("flying whenever you draw a card, …"). */
const REPEATABLE_RE = /\bwhenever\b|\bat the beginning of\b|^[^:.]{0,40}:/;

/**
 * Burn evidence comes in two shapes: a spell that hits face (Lightning Bolt,
 * Comet Storm) or a permanent that does so repeatedly (Purphoros, Guttersnipe,
 * Impact Tremors, Niv-Mizzet, Prodigal Sorcerer). Counting spells only left
 * every permanent-based damage engine invisible to the detector.
 */
function burnEvidence(parsed: ParsedCard): 'spell' | 'engine' | null {
  if (/instant|sorcery/.test(parsed.typeLine)) return BURN_RE.test(parsed.oracle) ? 'spell' : null;
  return splitClauses(parsed.oracle).some((c) => REPEATABLE_RE.test(c) && BURN_RE.test(c))
    ? 'engine'
    : null;
}

// ── Aristocrats drain scan ────────────────────────────────────────────────────

// Same X-spell concern as burn: the canonical drain finishers (Exsanguinate,
// Torment of Hailfire) cost `X`, so allow `x` alongside a literal count.
const DRAIN_RE =
  /(?:each opponent|target opponent|all opponents) (?:loses|lose) (?:\d+|x) life|opponent loses (?:\d+|x) life each/;

function drainsDamage(oracle: string): boolean {
  return DRAIN_RE.test(oracle);
}

// ── Combo bucket helpers ──────────────────────────────────────────────────────

// "Loses the game" and "infinite turns" are real Commander Spellbook produces[]
// labels that don't match "win the game" verbatim but are just as much an
// auto-win line (an opponent losing IS you winning; infinite turns locks the
// game) — without these, complete combos carrying that phrasing fell into
// 'other' and never counted as a win path, letting a weaker independently-
// scored candidate win by default even with 5 isComplete combos in the deck.
const COMBO_WIN_RE =
  /\bwin the game\b|\bwin an? game\b|\bloses? the game\b|\binfinite (?:extra )?turns?\b/i;
// "You can't lose the game due to having 0 or less life" matches the
// "lose the game" clause above but is a Platinum Angel effect, not a win.
const COMBO_NOT_WIN_RE = /\b(?:can't|unable to) lose the game\b/i;
// "Near-infinite" is Commander Spellbook's own phrasing for a loop bounded
// only by a resource on the battlefield (mana rocks, life total) — same real
// win-con as "infinite" for report purposes. "Combat damage" and "lifeloss"
// are the two other damage-equivalent produces[] labels this previously
// missed (a mana-dragon Aggravated Assault package, an aristocrats lifeloss
// engine) — the regex required the literal word "damage" right after
// "infinite", so those fell to 'other' and the combo went unreported even
// though it was already counted in bracketEstimation.softScore (E78 items 1).
// "Infinite combat phases" is infinite attacks — a combat kill with any
// creature on board (3.8k combos in the dataset carried it as their only
// win-relevant label).
const COMBO_DAMAGE_RE =
  /\b(?:near-)?infinite (?:combat )?damage\b|\bunlimited damage\b|\binfinite lifeloss\b|\b(?:near-)?infinite combat phases\b/i;
// An infinite creature-token loop is a win the same way infinite draw is
// (inevitability — swing next turn, or this turn with haste). Commander
// Spellbook phrases it "Infinite creature tokens with haste" / "Infinite hasty
// creature tokens" / "Infinite creature tokens"; Godo's Dualcaster Mage +
// Twinflame line fell to 'other' and the deck showed zero win-path combos.
const COMBO_TOKENS_RE = /\binfinite (?:hasty |attacking )?(?:[\w/+-]+ )*creature tokens?\b/i;
// Tokens handed to opponents (Hunted-cycle politics) or that can't attack
// are not a board.
const COMBO_NOT_TOKENS_RE =
  /\bfor (?:target |any number of |all |one or more )?(?:opponents?|players)\b|\bwith 0 power\b|\bwith defender\b/i;
// An infinitely large (or infinitely many +1/+1 counters on a) creature is
// the same inevitability as an infinite token board: one connection ends
// the game. 13k combos list "Infinite +1/+1 counters on a creature" as their
// only win-relevant label. "-1/-1 counters" is removal, excluded by the
// literal "+1/+1".
const COMBO_GROW_RE =
  /\b(?:near-)?infinite \+1\/\+1 counters on\b|\b(?:near-)?infinitely (?:large|powerful) creatures?\b|\binfinite power (?:and toughness )?for\b/i;
// "Exile your library" is a self-effect (Leveler + Lab Man is listed as
// "Win the game" on its own); only an OPPONENT's library going away is mill.
const COMBO_MILL_RE =
  /\binfinite mill\b|\bexile (?:each opponent's|all opponents'|target opponent's|their) librar/i;
// Infinite card draw is a genuine plan (assemble any answer, or deck the
// table via inevitability) — unlike a bare infinite-mana loop below, which
// still needs a second piece to spend the mana on, so it stays excluded.
const COMBO_DRAW_RE = /\binfinite (?:card )?draw\b|\binfinite draw triggers\b|\bstorm count\b/i;
const COMBO_MANA_RE = /\binfinite mana\b/i;

// Audited against every distinct Commander Spellbook produces[] label in the
// ingested dataset (1,087 labels, 2026-09-11); the label families that are
// wins are bucketed here, everything else ('Infinite ETB', 'Infinite
// lifegain', 'Lock', bare mana) stays 'other' because it needs a separate
// payoff card, which Spellbook lists as its own combo when present.
function comboBucket(
  results: string[]
): 'win' | 'damage' | 'tokens' | 'grow' | 'mill' | 'draw' | 'mana' | 'other' {
  // Per-label, not joined: a negative clause must veto only its own label.
  const has = (re: RegExp, veto?: RegExp) =>
    results.some((l) => re.test(l) && !(veto && veto.test(l)));
  if (has(COMBO_WIN_RE, COMBO_NOT_WIN_RE)) return 'win';
  if (has(COMBO_DAMAGE_RE)) return 'damage';
  if (has(COMBO_TOKENS_RE, COMBO_NOT_TOKENS_RE)) return 'tokens';
  if (has(COMBO_GROW_RE)) return 'grow';
  if (has(COMBO_MILL_RE)) return 'mill';
  const joined = results.join(' ');
  if (COMBO_DRAW_RE.test(joined)) return 'draw';
  if (COMBO_MANA_RE.test(joined)) return 'mana';
  return 'other';
}

// ── Voltron heuristic ────────────────────────────────────────────────────────

const EVASION_KW = ['flying', 'trample', 'menace', 'shadow', 'fear', 'intimidate', 'unblockable'];
const DOUBLESTRIKE_KW = ['double strike'];
const EVASION_ORACLE = /\bcan't be blocked\b|protection from|hexproof|shroud|skulk|horsemanship/;

function commanderHasEvasion(cmd: CardLike): boolean {
  const kw = (cmd.keywords ?? []).map((k) => k.toLowerCase());
  if (EVASION_KW.some((e) => kw.includes(e))) return true;
  if (DOUBLESTRIKE_KW.some((e) => kw.includes(e))) return true;
  const oracle = parseCard(cmd).oracle;
  return EVASION_ORACLE.test(oracle);
}

function commanderPower(cmd: CardLike): number {
  const p = (cmd as { power?: string | number }).power;
  if (p == null) return 0;
  const n = Number(p);
  return isNaN(n) ? 0 : n;
}

// ── Qualification gates ───────────────────────────────────────────────────────

/**
 * Strategic win-cons (mill / poison / go-wide / aristocrats / burn / voltron) are
 * *plans*, not discrete buttons — a couple of incidental token-makers or sac
 * effects don't make a deck a "tokens deck". They qualify only when the deck is
 * genuinely committed: either the synergy engine flagged the axis as `invested`
 * (≥5 producers+payoffs with both halves — its "the deck commits to this" signal),
 * or there's a substantial raw count of relevant cards. This is what keeps the
 * primary label honest and lets "no clear win condition" actually fire on an
 * unfocused goodstuff pile.
 */
const STRATEGIC_MIN_CARDS = 4;

/** Go-wide gets its own, higher bar: token/anthem effects are common
 *  INCIDENTAL value in big-mana/ramp shells (ETB or landfall value creatures
 *  that happen to make a token) in a way burn/mill/aristocrats rarely are, so
 *  the shared 4-card floor let a titan-annihilator deck with zero go-wide
 *  plan get labeled "Go-wide tokens" off a couple of unrelated token makers. */
const GO_WIDE_MIN_CARDS = 6;

/** Burn spells an invested spellslinger shell must actually run before the
 *  axis can vouch for a burn plan (see the burn block). */
const BURN_MIN_INVESTED = 2;

/** Invested-axis score bonus — a flagged engine should clearly outrank an
 *  incidental, one-sided pile of the same card type. */
const INVESTED_BONUS = 4;

function strategicQualifies(evidenceCount: number, invested: boolean): boolean {
  return invested || evidenceCount >= STRATEGIC_MIN_CARDS;
}

/** Min creatures for the generic-combat fallback to read as a real creature
 *  base (vs. a control/spells shell that happens to run a few bodies). */
const COMBAT_MIN_CREATURES = 15;

// ── Main detector ─────────────────────────────────────────────────────────────

/**
 * Detect how a commander deck wins. Returns primary + secondary win conditions,
 * ranked by commitment.
 *
 * Two kinds of path:
 *  - Discrete finishers (combo, alt-win): a single card/combo is a real win
 *    condition, so any present count qualifies.
 *  - Strategic plans (mill / poison / go-wide / aristocrats / burn / voltron):
 *    qualify only on real commitment — an `invested` synergy axis or a
 *    substantial raw card count (`strategicQualifies`). This keeps a couple of
 *    incidental cards from being mislabelled as the deck's plan.
 *
 * Score = relevant card count + `INVESTED_BONUS` when the synergy engine flagged
 * the axis (so a committed engine outranks an incidental pile). When nothing
 * qualifies, returns `noClearWinCondition`.
 */
export function detectWinConditions(input: WinConditionInput): WinConditionAnalysis {
  const { cards, commander, partnerCommander, combosInDeck, deckSynergy, format } = input;
  const isCommander = format.toLowerCase().includes('commander') || format === 'edh';
  const investedSet = new Set(deckSynergy.invested);

  // Command-zone cards never need drawing — excluded from every assembly set.
  const commandZone = new Set(
    [commander?.name, partnerCommander?.name].filter((n): n is string => Boolean(n))
  );
  // …but they ARE evidence: a commander that mills, poisons, or pings is the
  // most reliable card in the deck (always castable), so every strategic scan
  // reads the command zone alongside the 99. Callers differ on whether the
  // commander is already in `cards` (the coherence audit includes it, the
  // Power-tab analysis doesn't), so merge by name.
  const scanCards = [...cards];
  for (const cmd of [commander, partnerCommander]) {
    if (cmd && !cards.some((c) => c.name === cmd.name)) scanCards.push(cmd);
  }
  const library = (names: string[]) => names.filter((n) => !commandZone.has(n));
  // "Online" for a strategic plan = the same critical mass the detector itself
  // required to call it a plan (see strategicQualifies / the poison gate).
  const strategicAssembly = (names: string[], need: number) => {
    const drawable = library(names);
    return [{ names: drawable, need: Math.min(need, drawable.length) }];
  };

  const candidates: WinCondition[] = [];

  // ── 1. Infinite combos ────────────────────────────────────────────────────
  const comboWin = combosInDeck.filter((c) => {
    const b = comboBucket(c.results);
    return (
      b === 'win' ||
      b === 'damage' ||
      b === 'tokens' ||
      b === 'grow' ||
      b === 'mill' ||
      b === 'draw'
    );
  });
  if (comboWin.length > 0) {
    const allCards = Array.from(new Set(comboWin.flatMap((c) => c.cards)));
    const buckets = comboWin.map((c) => comboBucket(c.results));
    const dominant =
      (['win', 'damage', 'tokens', 'grow', 'mill'] as const).find((b) => buckets.includes(b)) ??
      'draw';
    const suffixes: Record<string, string> = {
      win: 'auto-win lines',
      damage: 'infinite damage loops',
      tokens: 'infinite creature-token loops',
      grow: 'infinitely large creature loops',
      mill: 'infinite mill loops',
      draw: 'infinite card-draw engines',
    };
    // Name the marquee pair — the tightest (fewest-card) complete combo reads
    // as the cleanest line to show the user, e.g. "Sensei's Divining Top +
    // Mystic Forge" rather than a bare count.
    const marquee = [...comboWin].sort((a, b) => a.cards.length - b.cards.length)[0].cards;
    candidates.push({
      category: 'infinite-combo',
      label: 'Infinite combo',
      summary: `${comboWin.length} complete ${suffixes[dominant] ?? 'combo'} in the deck: ${marquee.slice(0, 2).join(' + ')}`,
      evidence: allCards.slice(0, 8),
      score: 5 + comboWin.length * 3,
      // Assembled = every library piece of any ONE complete combo drawn.
      assembly: comboWin.map((c) => {
        const names = c.cards.filter((n) => !commandZone.has(n));
        return { names, need: names.length };
      }),
    });
  }

  // ── 2. Alt-win-con cards ──────────────────────────────────────────────────
  const altWinCards: string[] = [];
  for (const card of scanCards) {
    const parsed = parseCard(card);
    if (isAltWin(parsed.oracle, card.name)) altWinCards.push(card.name);
  }
  if (altWinCards.length > 0) {
    candidates.push({
      category: 'alt-win',
      label: 'Alt-win',
      summary: `${altWinCards.length} alternate win-condition card${altWinCards.length === 1 ? '' : 's'}`,
      evidence: altWinCards,
      score: 4 + altWinCards.length * 2,
      // Each alt-win card is a standalone win button — any one suffices.
      assembly: [{ names: library(altWinCards), need: 1 }],
    });
  }

  // ── 3. Mill (deck-out) ────────────────────────────────────────────────────
  const millCards: string[] = [];
  for (const card of scanCards) {
    const parsed = parseCard(card);
    const m = millSignals(parsed.oracle);
    if (m.opponentMill || m.doubler) millCards.push(card.name);
  }
  const millInvested = investedSet.has('mill');
  if (strategicQualifies(millCards.length, millInvested)) {
    candidates.push({
      category: 'mill',
      label: 'Mill',
      summary: `${millCards.length} mill card${millCards.length === 1 ? '' : 's'} targeting opponents`,
      evidence: millCards.slice(0, 8),
      score: millCards.length + (millInvested ? INVESTED_BONUS : 0),
      assembly: strategicAssembly(millCards, STRATEGIC_MIN_CARDS),
    });
  }

  // ── 4. Poison / infect ────────────────────────────────────────────────────
  const poisonCards: string[] = [];
  for (const card of scanCards) {
    const kw = (card.keywords ?? []).map((k) => k.toLowerCase());
    if (kw.some((k) => k === 'infect' || k.startsWith('toxic') || k === 'wither')) {
      poisonCards.push(card.name);
      continue;
    }
    const parsed = parseCard(card);
    if (/\bpoison counters?\b|\binfect\b|\btoxic\b/.test(parsed.oracle)) {
      poisonCards.push(card.name);
    }
  }
  // Poison is deterministic and rare, so a smaller commitment still reads as a
  // real plan — but a lone incidental infect creature shouldn't. Qualify at ≥2
  // poison cards or an invested poison axis.
  const poisonInvested = investedSet.has('poison');
  if (poisonInvested || poisonCards.length >= 2) {
    candidates.push({
      category: 'poison',
      label: 'Poison / infect',
      summary: `${poisonCards.length} infect/toxic/poison card${poisonCards.length === 1 ? '' : 's'}`,
      evidence: poisonCards.slice(0, 8),
      score: poisonCards.length + (poisonInvested ? INVESTED_BONUS : 0),
      // Matches the ≥2 qualification gate above — poison needs less mass.
      assembly: strategicAssembly(poisonCards, 2),
    });
  }

  // ── 5. Go-wide tokens ────────────────────────────────────────────────────
  const tokenCards: string[] = [];
  const anthemCards: string[] = [];
  for (const card of scanCards) {
    const parsed = parseCard(card);
    const tc = tokenCreation(parsed.oracle);
    if (tc.creaturesForYou) tokenCards.push(card.name);
    if (/creatures you control get \+|creature tokens? you control get \+/.test(parsed.oracle)) {
      anthemCards.push(card.name);
    }
  }
  // A commander that makes creature tokens on a REPEATABLE trigger, as the
  // payoff of an axis the deck is invested in (Talrand off instants/sorceries,
  // Adeline off attacks), IS the go-wide plan: it never needs drawing and every
  // fuel card in the 99 feeds it. Without this a Talrand list read as "no clear
  // win condition" (or, worse, as Burn off the spellslinger axis with zero burn
  // spells). A one-shot dies/enters token maker (Elenda) is not an engine.
  let tokenEngine: { name: string; reason: string } | null = null;
  for (const cmd of [commander, partnerCommander]) {
    if (!cmd || tokenEngine) continue;
    const cs = classifyCard(cmd);
    const fuel = cs.payoffs.find((p) => investedSet.has(p.axis));
    const repeatable = splitClauses(parseCard(cmd).oracle).some(
      (c) => REPEATABLE_RE.test(c) && tokenCreation(c).creaturesForYou
    );
    if (fuel && repeatable) tokenEngine = { name: cmd.name, reason: fuel.reason };
  }
  const goWideInvested = investedSet.has('tokens') || tokenEngine !== null;
  const goWideCount = tokenCards.length + anthemCards.length;
  // Raw-count path additionally requires a real payoff (anthem/Overrun-class):
  // without one, a titan-ramp deck whose only "token" cards are incidental
  // sac-fodder makers (Eldrazi Spawn/Scion) clears the floor on producer count
  // alone and gets mislabeled go-wide with no plan to actually go wide.
  if (goWideInvested || (goWideCount >= GO_WIDE_MIN_CARDS && anthemCards.length >= 1)) {
    const allEvidence = Array.from(
      new Set([...(tokenEngine ? [tokenEngine.name] : []), ...tokenCards, ...anthemCards])
    );
    const engineNote = tokenEngine
      ? `${tokenEngine.name} makes tokens (${tokenEngine.reason}), `
      : '';
    candidates.push({
      category: 'go-wide',
      label: 'Go-wide tokens',
      summary: `${engineNote}${tokenCards.length} token maker${tokenCards.length === 1 ? '' : 's'}${anthemCards.length > 0 ? `, ${anthemCards.length} anthem${anthemCards.length === 1 ? '' : 's'}` : ''}`,
      evidence: allEvidence.slice(0, 8),
      score: goWideCount + (goWideInvested ? INVESTED_BONUS : 0),
      // ponytail: flat count over producers+anthems; require-a-payoff-drawn if
      // this reads too optimistic for anthem-light lists.
      assembly: strategicAssembly(allEvidence, STRATEGIC_MIN_CARDS),
    });
  }

  // ── 6. Aristocrats / life-drain ──────────────────────────────────────────
  const sacOutlets: string[] = [];
  const sacPayoffs: string[] = [];
  const drainCards: string[] = [];
  for (const card of scanCards) {
    const parsed = parseCard(card);
    const s = sacrificeSignals(parsed.oracle);
    if (s.outlet) sacOutlets.push(card.name);
    if (s.rewards) sacPayoffs.push(card.name);
    if (drainsDamage(parsed.oracle)) drainCards.push(card.name);
  }
  const aristoInvested = investedSet.has('sacrifice');
  const aristoEvidence = Array.from(new Set([...sacOutlets, ...sacPayoffs, ...drainCards]));
  // Raw-count path needs a real payoff or drain, mirroring go-wide's anthem
  // requirement: "sacrifice this: add mana" rocks and self-sacrificing
  // utility (Lotus Petal, Mind Stone, Goblin Engineer) are outlets by text,
  // and five of them made a Godo equipment deck read as Aristocrats.
  const aristoHasPayoff = sacPayoffs.length + drainCards.length >= 1;
  if (aristoInvested || (aristoHasPayoff && strategicQualifies(aristoEvidence.length, false))) {
    const hasDrain = drainCards.length > 0;
    candidates.push({
      category: 'aristocrats',
      label: hasDrain ? 'Aristocrats / drain' : 'Aristocrats',
      summary: `${sacOutlets.length} sacrifice outlet${sacOutlets.length === 1 ? '' : 's'}, ${sacPayoffs.length} payoff${sacPayoffs.length === 1 ? '' : 's'}${hasDrain ? `, ${drainCards.length} drain effect${drainCards.length === 1 ? '' : 's'}` : ''}`,
      evidence: aristoEvidence.slice(0, 8),
      score:
        aristoEvidence.length +
        (aristoInvested ? INVESTED_BONUS : 0) +
        (investedSet.has('lifegain') ? 1 : 0),
      assembly: strategicAssembly(aristoEvidence, STRATEGIC_MIN_CARDS),
    });
  }

  // ── 7. Burn / direct damage ──────────────────────────────────────────────
  const burnSpells: string[] = [];
  const burnEngines: string[] = [];
  for (const card of scanCards) {
    const kind = burnEvidence(parseCard(card));
    if (kind === 'spell') burnSpells.push(card.name);
    else if (kind === 'engine') burnEngines.push(card.name);
  }
  const burnCards = [...burnEngines, ...burnSpells];
  const burnInvested = investedSet.has('spellslinger');
  // Evidence floor: the spellslinger axis says the deck casts a lot of spells,
  // not that those spells burn face. Without it a Talrand drake list rendered
  // "Burn — 0 direct-damage spells" as its primary plan. One incidental Bolt
  // still isn't a plan, so an invested shell needs a couple of real finishers.
  if (burnCards.length >= BURN_MIN_INVESTED && strategicQualifies(burnCards.length, burnInvested)) {
    const parts = [
      burnSpells.length > 0 &&
        `${burnSpells.length} direct-damage spell${burnSpells.length === 1 ? '' : 's'}`,
      burnEngines.length > 0 &&
        `${burnEngines.length} damage engine${burnEngines.length === 1 ? '' : 's'}`,
    ].filter(Boolean);
    candidates.push({
      category: 'burn',
      label: burnEngines.length > 0 ? 'Burn / damage engines' : 'Burn',
      summary: parts.join(', '),
      evidence: burnCards.slice(0, 8),
      score: burnCards.length + (burnInvested ? INVESTED_BONUS : 0),
      assembly: strategicAssembly(burnCards, STRATEGIC_MIN_CARDS),
    });
  }

  // ── 8. Voltron / commander damage (commander-only) ───────────────────────
  if (isCommander && commander) {
    const equipCards: string[] = [];
    const auraCards: string[] = [];
    for (const card of cards) {
      const parsed = parseCard(card);
      if (/\bequip\b/.test(parsed.oracle)) equipCards.push(card.name);
      if (/enchant creature\b/.test(parsed.oracle)) auraCards.push(card.name);
    }
    const gearCount = equipCards.length + auraCards.length;
    const voltronInvested = investedSet.has('equipment') || investedSet.has('auras');
    const cmdPower = commanderPower(commander);
    const cmdEvasion = commanderHasEvasion(commander);
    // Evidence floor: voltron is "suit up the commander", so it requires actual
    // equipment/auras. Commander power + evasion only *boost* a real gear base —
    // they can never qualify voltron on their own (otherwise a big evasive
    // commander with zero equipment would render "0 equipment" as a win-con).
    if (gearCount >= 1 && strategicQualifies(gearCount, voltronInvested)) {
      const allEvidence = Array.from(new Set([...equipCards, ...auraCards]));
      const voltronScore =
        gearCount +
        (voltronInvested ? INVESTED_BONUS : 0) +
        (cmdPower >= 5 ? 2 : cmdPower >= 3 ? 1 : 0) +
        (cmdEvasion ? 2 : 0);
      candidates.push({
        category: 'voltron',
        label: 'Voltron / commander damage',
        summary: `${equipCards.length} equipment${auraCards.length > 0 ? `, ${auraCards.length} aura${auraCards.length === 1 ? '' : 's'}` : ''}${cmdEvasion ? ', commander has evasion' : ''}`,
        evidence: allEvidence.slice(0, 8),
        score: voltronScore,
        // Two pieces of gear on the (always-available) commander = suited up.
        assembly: strategicAssembly(allEvidence, 2),
      });
    }
  }

  // ── 9. Generic combat (fallback) ─────────────────────────────────────────
  const creatureCount = countCreatures(cards);
  // Only surface generic combat if no specific path is present (it's the default)
  // and the deck has a real creature base — not a control/spells shell that just
  // runs a few bodies. Below that floor, "no clear win condition" is the honest
  // answer.
  const hasSpecificPath = candidates.length > 0;
  if (!hasSpecificPath && creatureCount >= COMBAT_MIN_CREATURES) {
    candidates.push({
      category: 'combat',
      label: 'Combat / aggro',
      summary: `${creatureCount} creature${creatureCount === 1 ? '' : 's'}, generic combat plan`,
      evidence: [],
      score: Math.min(creatureCount, 10),
    });
  }

  // ── Rank and return ───────────────────────────────────────────────────────
  // Each block has already applied its own qualification gate, so any candidate
  // here is a genuine path; rank by score (commitment) descending.
  candidates.sort((a, b) => b.score - a.score);

  // Assembly-clock wildcards — scanned regardless of which paths qualified.
  const tutors = cards.filter((c) => isTutor(parseCard(c).oracle)).map((c) => c.name);

  if (candidates.length === 0) {
    return { primary: null, secondary: [], noClearWinCondition: true, tutors };
  }

  const [primary, ...rest] = candidates;
  return {
    primary,
    secondary: rest,
    noClearWinCondition: false,
    tutors,
  };
}

function countCreatures(cards: CardLike[]): number {
  return cards.filter((c) => {
    const tl = (c.type_line ?? '').toLowerCase();
    const ftl = c.card_faces?.[0]?.type_line?.toLowerCase() ?? '';
    return tl.includes('creature') || ftl.includes('creature');
  }).length;
}
