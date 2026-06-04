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

const BURN_RE =
  /deals? \d+ damage to (?:(?:target|each) (?:player|opponent)|any target)|deals? \d+ damage to players/;

function isBurnSpell(typeLine: string, oracle: string): boolean {
  const isSpell = /instant|sorcery/.test(typeLine);
  return isSpell && BURN_RE.test(oracle);
}

// ── Aristocrats drain scan ────────────────────────────────────────────────────

const DRAIN_RE =
  /(?:each opponent|target opponent|all opponents) (?:loses|lose) \d+ life|opponent loses \d+ life each/;

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

// ── Threshold for "real" win condition ───────────────────────────────────────

/** Minimum score to surface a win-con path. */
const DETECT_THRESHOLD = 2;

// ── Main detector ─────────────────────────────────────────────────────────────

/**
 * Detect how a commander deck wins. Returns primary + secondary win conditions,
 * ranked by evidence strength.
 *
 * Score formula: each evidence card = 1 pt; synergy `invested` membership = +3;
 * combo presence = separate scoring.
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
  const millScore = millCards.length + (investedSet.has('mill') ? 3 : 0);
  if (millScore >= DETECT_THRESHOLD) {
    candidates.push({
      category: 'mill',
      label: 'Mill',
      summary: `${millCards.length} mill card${millCards.length === 1 ? '' : 's'} targeting opponents`,
      evidence: millCards.slice(0, 8),
      score: millScore,
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
  const poisonScore = poisonCards.length + (investedSet.has('poison') ? 3 : 0);
  if (poisonScore >= DETECT_THRESHOLD) {
    candidates.push({
      category: 'poison',
      label: 'Poison / infect',
      summary: `${poisonCards.length} infect/toxic/poison card${poisonCards.length === 1 ? '' : 's'}`,
      evidence: poisonCards.slice(0, 8),
      score: poisonScore,
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
  const goWideScore = tokenCards.length + anthemCards.length + (investedSet.has('tokens') ? 3 : 0);
  if (goWideScore >= DETECT_THRESHOLD) {
    const allEvidence = Array.from(new Set([...tokenCards, ...anthemCards]));
    candidates.push({
      category: 'go-wide',
      label: 'Go-wide tokens',
      summary: `${tokenCards.length} token maker${tokenCards.length === 1 ? '' : 's'}${anthemCards.length > 0 ? `, ${anthemCards.length} anthem${anthemCards.length === 1 ? '' : 's'}` : ''}`,
      evidence: allEvidence.slice(0, 8),
      score: goWideScore,
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
  const aristoScore =
    sacOutlets.length +
    sacPayoffs.length +
    drainCards.length +
    (investedSet.has('sacrifice') ? 3 : 0) +
    (investedSet.has('lifegain') ? 1 : 0);
  if (aristoScore >= DETECT_THRESHOLD) {
    const allEvidence = Array.from(new Set([...sacOutlets, ...sacPayoffs, ...drainCards]));
    const hasDrain = drainCards.length > 0;
    candidates.push({
      category: 'aristocrats',
      label: hasDrain ? 'Aristocrats / drain' : 'Aristocrats',
      summary: `${sacOutlets.length} sacrifice outlet${sacOutlets.length === 1 ? '' : 's'}, ${sacPayoffs.length} payoff${sacPayoffs.length === 1 ? '' : 's'}${hasDrain ? `, ${drainCards.length} drain effect${drainCards.length === 1 ? '' : 's'}` : ''}`,
      evidence: allEvidence.slice(0, 8),
      score: aristoScore,
    });
  }

  // ── 7. Burn / direct damage ──────────────────────────────────────────────
  const burnCards: string[] = [];
  for (const card of cards) {
    const parsed = parseCard(card);
    if (isBurnSpell(parsed.typeLine, parsed.oracle)) burnCards.push(card.name);
  }
  const burnScore = burnCards.length + (investedSet.has('spellslinger') ? 2 : 0);
  if (burnScore >= DETECT_THRESHOLD) {
    candidates.push({
      category: 'burn',
      label: 'Burn',
      summary: `${burnCards.length} direct-damage spell${burnCards.length === 1 ? '' : 's'}`,
      evidence: burnCards.slice(0, 8),
      score: burnScore,
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
    const cmdPower = commanderPower(commander);
    const cmdEvasion = commanderHasEvasion(commander);
    const voltronScore =
      equipCards.length +
      auraCards.length +
      (investedSet.has('equipment') ? 3 : 0) +
      (investedSet.has('auras') ? 3 : 0) +
      (cmdPower >= 5 ? 2 : cmdPower >= 3 ? 1 : 0) +
      (cmdEvasion ? 2 : 0);

    if (voltronScore >= DETECT_THRESHOLD) {
      const allEvidence = Array.from(new Set([...equipCards, ...auraCards]));
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
  const combatScore = countCreatures(cards);
  // Only surface generic combat if no other path is present (it's the default)
  // and the deck has enough creatures to be a real combat plan.
  const hasSpecificPath = candidates.length > 0;
  if (!hasSpecificPath && combatScore >= 12) {
    candidates.push({
      category: 'combat',
      label: 'Combat / aggro',
      summary: `${combatScore} creature${combatScore === 1 ? '' : 's'} — generic combat plan`,
      evidence: [],
      score: Math.min(combatScore, 10),
    });
  }

  // ── Rank and return ───────────────────────────────────────────────────────
  candidates.sort((a, b) => b.score - a.score);

  const above = candidates.filter((c) => c.score >= DETECT_THRESHOLD);

  if (above.length === 0) {
    return { primary: null, secondary: [], noClearWinCondition: true };
  }

  const [primary, ...rest] = above;
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
