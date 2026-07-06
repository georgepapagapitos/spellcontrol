/**
 * Nonbo / anti-synergy audit (E80).
 *
 * The 23-axis synergy model catches missing support; nothing catches
 * OPPOSITION — a card that actively fights the deck's own plan. The classics:
 * Rest in Peace in a graveyard deck, Torpor Orb beside an ETB value engine,
 * Stony Silence over your own mana rocks, a symmetric boardwipe clearing your
 * own token army. This is a curated effect-class → opposed-axes table, not a
 * rules engine: each rule needs positive oracle evidence AND the deck must be
 * invested in an opposed axis before anything flags — empty oracle text
 * (golden fixtures) or an uninvested deck emits nothing.
 *
 * Hard nonbos (the card switches the engine off) are warn severity with a
 * `card`, so the E78 repair pass can cut them like any other warn; wipe/timing
 * tensions are info, report-only.
 *
 * The wipe-tension check has three deliberate exceptions so it doesn't cry
 * wolf: a modal "destroy all non-<Type>" sweeper that spares the deck's own
 * dominant tribe (Crux of Fate, Sivitri) isn't a self-sweep; a wipe that
 * reanimates the graveyard in the same breath (Living Death) is the plan in
 * a graveyard-recursion deck, not a liability; and an Overload-granted "each"
 * mode (Damn) is re-derived from its base "target" text since the rewrite
 * instruction lives in reminder text this module otherwise strips.
 */
import type { CoherenceFinding, ScryfallCard } from '@/deck-builder/types';
import { AXES, type AxisKey } from '@/deck-builder/services/synergy/axes';
import { KNOWN_TRIBES } from './commanderProfile';

const AXIS_LABELS = new Map(AXES.map((a) => [a.key, a.label]));

const oracleOf = (c: ScryfallCard): string =>
  (c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text ?? '').join('\n') ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '');

// Raw (reminder text intact) — Overload's "change target to each" instruction
// only lives in the parenthetical the line above strips.
const rawOracleOf = (c: ScryfallCard): string =>
  (c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text ?? '').join('\n') ?? '').toLowerCase();

interface NonboHit {
  opposes: AxisKey[];
  severity: 'warn' | 'info';
  message: (labels: string) => string;
}

const shutsOff = (labels: string) =>
  `It shuts off the deck's own ${labels} engine — a hard nonbo with the plan.`;

// ── Hard nonbos (warn) — continuous, symmetric effects ──

function hardNonbo(oracle: string): NonboHit | null {
  // Rest in Peace / Planar Void: symmetric continuous graveyard exile. The
  // "a graveyard" wording is the symmetry evidence — opponent-only hate
  // (Leyline of the Void's "an opponent's graveyard") never matches.
  if (
    /if a card (?:or token )?would be put into a graveyard/.test(oracle) ||
    /whenever a card is put into a graveyard, exile (?:that card|it)/.test(oracle)
  ) {
    return { opposes: ['graveyard', 'mill'], severity: 'warn', message: shutsOff };
  }

  // Torpor Orb / Hushwing Gryff / Hushbringer: ETB-trigger denial; the
  // Hushbringer "or dying" clause also silences death triggers.
  const etb = oracle.match(
    /creatures entering the battlefield( or dying)? don't cause abilities to trigger/
  );
  if (etb) {
    return {
      opposes: etb[1] ? ['blink', 'sacrifice'] : ['blink'],
      severity: 'warn',
      message: shutsOff,
    };
  }

  // Everlasting Torment / Sulfuric Vortex: continuous lifegain denial.
  // "this turn" one-shots (Skullcrack) are a play pattern, not a nonbo.
  if (
    /players can't gain life(?! this turn)/.test(oracle) ||
    /if a player would gain life, that player doesn't/.test(oracle)
  ) {
    return { opposes: ['lifegain'], severity: 'warn', message: shutsOff };
  }

  // Stony Silence / Null Rod / Collector Ouphe: symmetric artifact lock.
  // Karn's opponent-only wording ("artifacts your opponents control") never matches.
  if (/activated abilities of artifacts can't be activated/.test(oracle)) {
    return { opposes: ['artifacts', 'equipment', 'vehicles'], severity: 'warn', message: shutsOff };
  }

  return null;
}

// ── Tensions (info) — symmetric one-shots that hit your own board ──

const WIPE_NOUN_AXES: [RegExp, AxisKey[]][] = [
  [/\bcreatures?\b/, ['tokens']],
  [/\bartifacts?\b/, ['artifacts', 'equipment', 'vehicles']],
  [/\benchantments?\b/, ['enchantress', 'auras']],
];

// A modal wipe naming "non-<Type> creatures" (Crux of Fate, Sivitri) is only
// a real self-sweep if the deck ISN'T that type — a tribal deck always picks
// the mode that spares its own board. Majority share = "the deck's plan", not
// a coincidence, so the whole card (both listed modes) goes quiet.
const TRIBAL_DODGE_SHARE_FLOOR = 0.5;

function tribalDodgeType(phrase: string): string | null {
  return phrase.match(/\bnon-([a-z]+) creatures?\b/)?.[1] ?? null;
}

const typeLineOf = (c: ScryfallCard): string =>
  (c.type_line ?? c.card_faces?.[0]?.type_line ?? '').toLowerCase();
const isCreature = (c: ScryfallCard): boolean => typeLineOf(c).includes('creature');

// ponytail: creature subtypes = every word after the type line's em dash.
// Good enough for a majority-share check; not a full typal engine.
function cardCreatureTypes(c: ScryfallCard): string[] {
  if (!isCreature(c)) return [];
  return typeLineOf(c).split('—').slice(1).join(' ').split(/\s+/).filter(Boolean);
}

function creatureTypeShares(cards: ScryfallCard[]): Map<string, number> {
  const counts = new Map<string, number>();
  let creatureCount = 0;
  for (const c of cards) {
    if (!isCreature(c)) continue;
    creatureCount++;
    for (const t of cardCreatureTypes(c)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const shares = new Map<string, number>();
  if (creatureCount === 0) return shares;
  for (const [t, n] of counts) shares.set(t, n / creatureCount);
  return shares;
}

// Living Death-style effects wipe the board only to put it right back from
// the graveyard in the same breath — that's the reanimator plan, not a
// liability, once the deck is actually invested in graveyard recursion.
const REANIMATES_AFTER_WIPE = /graveyard.*(?:puts?|returns?).*(?:onto|to) the battlefield/;

function wipeTension(
  oracle: string,
  creatureTypeShares: Map<string, number>,
  investedGraveyard: boolean
): NonboHit | null {
  if (investedGraveyard && REANIMATES_AFTER_WIPE.test(oracle)) return null;

  const wipeMatches = [...oracle.matchAll(/\b(?:destroys?|exiles?) all (?:other )?([^.;]*)/g)];
  const dodgesTribe = wipeMatches.some((m) => {
    const type = tribalDodgeType(m[1]);
    return type != null && (creatureTypeShares.get(type) ?? 0) > TRIBAL_DODGE_SHARE_FLOOR;
  });
  if (dodgesTribe) return null; // a modal sweeper that spares the deck's own tribe

  const opposes = new Set<AxisKey>();
  for (const m of wipeMatches) {
    const phrase = m[1];
    if (phrase.includes("don't control") || phrase.includes('opponent')) continue; // one-sided
    for (const [noun, axes] of WIPE_NOUN_AXES) {
      if (noun.test(phrase)) for (const a of axes) opposes.add(a);
    }
  }
  for (const m of oracle.matchAll(
    /\ball creatures get -(?:\d+|x)\/-(?:\d+|x)([^.;]*)|deals? (?:\d+|x) damage to each creature\b([^.;]*)/g
  )) {
    const rest = m[1] ?? m[2] ?? '';
    if (!rest.includes("don't control") && !rest.includes('opponent')) opposes.add('tokens');
  }
  if (opposes.size === 0) return null;
  return {
    opposes: [...opposes],
    severity: 'info',
    message: (labels) =>
      `It sweeps the deck's own ${labels} board too — a one-sided effect would serve the plan better.`,
  };
}

// Overload rewrites "target" to "each" when cast for its overload cost, but
// that instruction lives in reminder text oracleOf() strips — so a card like
// Damn ("Destroy target creature. ... Overload {2}{W}{W}") never reads as a
// wipe. Re-derive the "destroy/exile all X" text overload actually grants.
const OVERLOAD_TARGET_WIPE =
  /\b(destroys?|exiles?) target ((?:creatures?|artifacts?|enchantments?))(\s+or\s+planeswalkers?)?\b/g;

function overloadExpansion(rawOracle: string): string {
  if (!/\boverload\b/.test(rawOracle)) return '';
  return rawOracle.replace(
    OVERLOAD_TARGET_WIPE,
    (_m, verb: string, noun: string, pw = '') => `${verb} all ${noun}${pw}`
  );
}

function graveyardWipeTension(oracle: string): NonboHit | null {
  if (!/exiles? (?:all cards from all graveyards|each player's graveyard)/.test(oracle))
    return null;
  return {
    opposes: ['graveyard', 'mill'],
    severity: 'info',
    message: (labels) =>
      `It exiles your own graveyard too — the deck's ${labels} engine loses its fuel when it fires.`,
  };
}

/**
 * Nonbo findings over the final nonland 99. One finding per card, hard nonbos
 * first. Both sides need positive evidence: an oracle match AND investment in
 * an opposed axis — zero signal on either side means silence.
 */
export function nonboFindings(
  nonLandCards: ScryfallCard[],
  invested: ReadonlySet<string>
): CoherenceFinding[] {
  if (invested.size === 0) return [];
  const typeShares = creatureTypeShares(nonLandCards);
  const investedGraveyard = invested.has('graveyard');
  const findings: CoherenceFinding[] = [];

  for (const card of nonLandCards) {
    if (card.isMustInclude) continue; // the user forced it — their call
    const oracle = oracleOf(card);
    if (!oracle) continue;

    let hit =
      hardNonbo(oracle) ??
      wipeTension(oracle, typeShares, investedGraveyard) ??
      graveyardWipeTension(oracle);
    if (!hit) {
      const expanded = overloadExpansion(rawOracleOf(card));
      if (expanded) hit = wipeTension(expanded, typeShares, investedGraveyard);
    }
    if (!hit) continue;
    const opposed = hit.opposes.filter((a) => invested.has(a));
    if (opposed.length === 0) continue;

    findings.push({
      kind: 'nonbo',
      severity: hit.severity,
      card: card.name,
      message: hit.message(opposed.map((a) => AXIS_LABELS.get(a) ?? a).join(' and ')),
    });
  }

  return findings;
}

// ── Qualified ETB/death payoffs (E106) ──────────────────────────────────────
//
// "Whenever Ayara or another black creature you control enters, each opponent
// loses 1 life…" only pays off BLACK creatures — in a deck whose token engine
// is colorless, that clause is close to dead text. The 23-axis classifiers
// are adjacency-strict (`hasCreatureEtbTrigger`, `paysOffCreatureDeath`) and
// don't even recognize a qualified clause as an ETB/death payoff at all today,
// so a qualified card currently gets ZERO axis credit — this reads the
// qualifier straight off the oracle text instead of touching that
// precision-gated corpus (see `classify.fixtures.ts`). Only a color word or a
// known creature type (reusing commanderProfile's tribe list) counts as a
// qualifier; anything else ("another permanent", "another nontoken creature")
// is left alone — this only flags patterns we can positively identify.
const COLOR_WORDS = new Set(['white', 'blue', 'black', 'red', 'green']);
const COLOR_LETTER: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

// "whenever <~ or the card's own name> or another/each black creature (you
// control) enters/dies" — the qualifying word sits directly before
// "creature(s)". oracle_text isn't name-neutralized here (unlike
// commanderProfile's getCombinedOracleText), so the self-reference is an
// arbitrary (non-greedy, period-bounded) run of text up to the first "or".
const QUALIFIED_CREATURE_TRIGGER =
  /\bwhenever\s+(?:[^.]*?\bor\s+)?(?:another|each)\s+([a-z]+)\s+creatures?(?:\s+you control)?\s+(enters?|dies)\b/;
// "whenever another Elf (you control) enters/dies" — no "creature" word at all.
const QUALIFIED_TYPE_TRIGGER =
  /\bwhenever\s+(?:[^.]*?\bor\s+)?(?:another|each)\s+([a-z]+)(?:\s+you control)?\s+(enters?|dies)\b/;

/**
 * The color or creature-type word qualifying a "whenever another X enters/
 * dies" trigger, or null when the clause is unqualified ("another creature")
 * or the captured word isn't a color/type we can positively identify.
 */
function triggerQualifier(oracle: string): string | null {
  const m = QUALIFIED_CREATURE_TRIGGER.exec(oracle) ?? QUALIFIED_TYPE_TRIGGER.exec(oracle);
  if (!m) return null;
  const word = m[1];
  if (word === 'creature' || word === 'creatures') return null; // unqualified
  if (!COLOR_WORDS.has(word) && !KNOWN_TRIBES.has(word)) return null;
  return word;
}

function matchesQualifier(card: ScryfallCard, qualifier: string): boolean {
  if (COLOR_WORDS.has(qualifier)) return (card.colors ?? []).includes(COLOR_LETTER[qualifier]);
  return cardCreatureTypes(card).includes(qualifier);
}

/** Any "create … token" clause, regardless of color/type. */
function producesAnyToken(card: ScryfallCard): boolean {
  return oracleOf(card)
    .split(/[.;]+/)
    .some((clause) => /\bcreates?\b/.test(clause) && /\btoken/.test(clause));
}

/** A "create … token" clause that also names the qualifying color/type word. */
function producesMatchingToken(card: ScryfallCard, qualifier: string): boolean {
  for (const clause of oracleOf(card).split(/[.;]+/)) {
    if (/\bcreates?\b/.test(clause) && /\btoken/.test(clause) && clause.includes(qualifier))
      return true;
  }
  return false;
}

// A payoff scoped to a color/type only needs to clear ONE side to keep full
// credit: a real share of matching creatures already in the 99 (mono-black
// aristocrats, Elf tribal), OR a token engine that substantially makes
// matching tokens. Both thin = the payoff is close to dead text.
const QUALIFIED_PAYOFF_SHARE_FLOOR = 0.25;
// A token engine "covers" a qualifier when it has at least 2 matching
// producers (real, deliberate support regardless of engine size) or when
// matching producers are a real share of the whole token engine — NOT when
// a single marginal producer (e.g. a 1-in-6 die-roll mode) sits inside an
// otherwise non-matching engine (Night Shift of the Living Dead's black
// Zombie mode beside a 100%-colorless Securitron engine must not grant full
// credit on its own).
const MIN_MATCHING_PRODUCERS_ALWAYS_COVERS = 2;

/**
 * Findings for color/creature-type-qualified ETB/death triggers whose
 * qualifier the deck can barely feed — neither enough matching creatures nor
 * a matching token producer. Report-only (info), same family as `nonboFindings`.
 */
export function qualifiedTriggerFindings(nonLandCards: ScryfallCard[]): CoherenceFinding[] {
  const findings: CoherenceFinding[] = [];

  for (const card of nonLandCards) {
    if (card.isMustInclude) continue; // the user forced it — their call
    const oracle = oracleOf(card);
    if (!oracle) continue;
    const qualifier = triggerQualifier(oracle);
    if (!qualifier) continue;

    const otherCards = nonLandCards.filter((c) => c !== card);
    const others = otherCards.filter((c) => isCreature(c));
    const matching = others.filter((c) => matchesQualifier(c, qualifier));
    const share = others.length > 0 ? matching.length / others.length : 0;
    if (share >= QUALIFIED_PAYOFF_SHARE_FLOOR) continue;

    const tokenProducers = otherCards.filter((c) => producesAnyToken(c));
    const matchingProducers = tokenProducers.filter((c) => producesMatchingToken(c, qualifier));
    const producerShare =
      tokenProducers.length > 0 ? matchingProducers.length / tokenProducers.length : 0;
    const tokenEngineCovers =
      matchingProducers.length >= MIN_MATCHING_PRODUCERS_ALWAYS_COVERS ||
      producerShare >= QUALIFIED_PAYOFF_SHARE_FLOOR;
    if (tokenEngineCovers) continue;

    const label = COLOR_WORDS.has(qualifier)
      ? qualifier
      : qualifier[0].toUpperCase() + qualifier.slice(1);
    const tokenPhrase =
      matchingProducers.length === 0
        ? 'nothing makes a matching token'
        : 'almost nothing makes a matching token';
    findings.push({
      kind: 'qualified-payoff',
      severity: 'info',
      card: card.name,
      message:
        matching.length === 0
          ? `Its ${label} trigger has no other matching creature in the deck, and ${tokenPhrase} — it'll rarely fire.`
          : `Its ${label} trigger only matches ${matching.length} other creature${matching.length === 1 ? '' : 's'} in the deck, and ${tokenPhrase} — it'll fire rarely.`,
    });
  }

  return findings;
}
