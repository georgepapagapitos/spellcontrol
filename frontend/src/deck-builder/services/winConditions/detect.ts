/**
 * Pure win-condition detector. Composes existing signals:
 *   - combo produces[] labels (infinite combo)
 *   - synergy deckSynergy.invested axes
 *   - oracle-text utilities from synergy/text.ts
 *   - ParsedCard oracle scan for alt-win / burn / drain
 *
 * No DOM, no network. Pure + isomorphic.
 */

import { parseCard, millSignals, sacrificeSignals, tokenCreation } from '../synergy/text';
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

// ── Burn detection (direct damage to players) ────────────────────────────────

// `(?:\d+|x)` is load-bearing: most commander burn FINISHERS deal `X` damage
// (Fireball, Comet Storm, Crackle with Power), not a fixed number — a `\d+`-only
// regex silently misses the entire X-spell family, which is the bulk of the
// archetype.
const BURN_RE =
  /deals? (?:\d+|x) damage to (?:(?:target|each) (?:player|opponent)|any target)|deals? (?:\d+|x) damage to players/;

function isBurnSpell(typeLine: string, oracle: string): boolean {
  const isSpell = /instant|sorcery/.test(typeLine);
  return isSpell && BURN_RE.test(oracle);
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

const COMBO_WIN_RE = /\bwin the game\b|\bwin an? game\b/i;
const COMBO_DAMAGE_RE = /\binfinite damage\b|\bunlimited damage\b/i;
const COMBO_MILL_RE = /\binfinite mill\b|\bexile (?:your |their )?librar/i;
const COMBO_MANA_RE = /\binfinite mana\b/i;

function comboBucket(results: string[]): 'win' | 'damage' | 'mill' | 'mana' | 'other' {
  const joined = results.join(' ');
  if (COMBO_WIN_RE.test(joined)) return 'win';
  if (COMBO_DAMAGE_RE.test(joined)) return 'damage';
  if (COMBO_MILL_RE.test(joined)) return 'mill';
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
  const { cards, commander, combosInDeck, deckSynergy, format } = input;
  const isCommander = format.toLowerCase().includes('commander') || format === 'edh';
  const investedSet = new Set(deckSynergy.invested);

  const candidates: WinCondition[] = [];

  // ── 1. Infinite combos ────────────────────────────────────────────────────
  const comboWin = combosInDeck.filter((c) => {
    const b = comboBucket(c.results);
    return b === 'win' || b === 'damage' || b === 'mill';
  });
  if (comboWin.length > 0) {
    const allCards = Array.from(new Set(comboWin.flatMap((c) => c.cards)));
    const buckets = comboWin.map((c) => comboBucket(c.results));
    const dominant =
      buckets.filter((b) => b === 'win').length > 0
        ? 'win'
        : buckets.filter((b) => b === 'damage').length > 0
          ? 'damage'
          : 'mill';
    const suffixes: Record<string, string> = {
      win: 'auto-win lines',
      damage: 'infinite damage loops',
      mill: 'infinite mill loops',
    };
    candidates.push({
      category: 'infinite-combo',
      label: 'Infinite combo',
      summary: `${comboWin.length} complete ${suffixes[dominant] ?? 'combo'} in the deck`,
      evidence: allCards.slice(0, 8),
      score: 5 + comboWin.length * 3,
    });
  }

  // ── 2. Alt-win-con cards ──────────────────────────────────────────────────
  const altWinCards: string[] = [];
  for (const card of cards) {
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
    });
  }

  // ── 3. Mill (deck-out) ────────────────────────────────────────────────────
  const millCards: string[] = [];
  for (const card of cards) {
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
    });
  }

  // ── 4. Poison / infect ────────────────────────────────────────────────────
  const poisonCards: string[] = [];
  for (const card of cards) {
    const kw = (card.keywords ?? []).map((k) => k.toLowerCase());
    if (kw.some((k) => k === 'infect' || k.startsWith('toxic') || k === 'wither')) {
      poisonCards.push(card.name);
      continue;
    }
    const parsed = parseCard(card);
    if (/\bpoison counter\b|\binfect\b|\btoxic\b/.test(parsed.oracle)) {
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
    });
  }

  // ── 5. Go-wide tokens ────────────────────────────────────────────────────
  const tokenCards: string[] = [];
  const anthemCards: string[] = [];
  for (const card of cards) {
    const parsed = parseCard(card);
    const tc = tokenCreation(parsed.oracle);
    if (tc.creaturesForYou) tokenCards.push(card.name);
    if (/creatures you control get \+|creature tokens? you control get \+/.test(parsed.oracle)) {
      anthemCards.push(card.name);
    }
  }
  const goWideInvested = investedSet.has('tokens');
  const goWideCount = tokenCards.length + anthemCards.length;
  if (strategicQualifies(goWideCount, goWideInvested)) {
    const allEvidence = Array.from(new Set([...tokenCards, ...anthemCards]));
    candidates.push({
      category: 'go-wide',
      label: 'Go-wide tokens',
      summary: `${tokenCards.length} token maker${tokenCards.length === 1 ? '' : 's'}${anthemCards.length > 0 ? `, ${anthemCards.length} anthem${anthemCards.length === 1 ? '' : 's'}` : ''}`,
      evidence: allEvidence.slice(0, 8),
      score: goWideCount + (goWideInvested ? INVESTED_BONUS : 0),
    });
  }

  // ── 6. Aristocrats / life-drain ──────────────────────────────────────────
  const sacOutlets: string[] = [];
  const sacPayoffs: string[] = [];
  const drainCards: string[] = [];
  for (const card of cards) {
    const parsed = parseCard(card);
    const s = sacrificeSignals(parsed.oracle);
    if (s.outlet) sacOutlets.push(card.name);
    if (s.rewards) sacPayoffs.push(card.name);
    if (drainsDamage(parsed.oracle)) drainCards.push(card.name);
  }
  const aristoInvested = investedSet.has('sacrifice');
  const aristoEvidence = Array.from(new Set([...sacOutlets, ...sacPayoffs, ...drainCards]));
  if (strategicQualifies(aristoEvidence.length, aristoInvested)) {
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
    });
  }

  // ── 7. Burn / direct damage ──────────────────────────────────────────────
  const burnCards: string[] = [];
  for (const card of cards) {
    const parsed = parseCard(card);
    if (isBurnSpell(parsed.typeLine, parsed.oracle)) burnCards.push(card.name);
  }
  const burnInvested = investedSet.has('spellslinger');
  if (strategicQualifies(burnCards.length, burnInvested)) {
    candidates.push({
      category: 'burn',
      label: 'Burn',
      summary: `${burnCards.length} direct-damage spell${burnCards.length === 1 ? '' : 's'}`,
      evidence: burnCards.slice(0, 8),
      score: burnCards.length + (burnInvested ? INVESTED_BONUS : 0),
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
        summary: `${equipCards.length} equipment${auraCards.length > 0 ? `, ${auraCards.length} aura${auraCards.length === 1 ? '' : 's'}` : ''}${cmdEvasion ? ' — commander has evasion' : ''}`,
        evidence: allEvidence.slice(0, 8),
        score: voltronScore,
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
      summary: `${creatureCount} creature${creatureCount === 1 ? '' : 's'} — generic combat plan`,
      evidence: [],
      score: Math.min(creatureCount, 10),
    });
  }

  // ── Rank and return ───────────────────────────────────────────────────────
  // Each block has already applied its own qualification gate, so any candidate
  // here is a genuine path; rank by score (commitment) descending.
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return { primary: null, secondary: [], noClearWinCondition: true };
  }

  const [primary, ...rest] = candidates;
  return {
    primary,
    secondary: rest,
    noClearWinCondition: false,
  };
}

function countCreatures(cards: CardLike[]): number {
  return cards.filter((c) => {
    const tl = (c.type_line ?? '').toLowerCase();
    const ftl = c.card_faces?.[0]?.type_line?.toLowerCase() ?? '';
    return tl.includes('creature') || ftl.includes('creature');
  }).length;
}
