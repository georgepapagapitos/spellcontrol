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

// ponytail: creature subtypes = every word after the type line's em dash.
// Good enough for a majority-share check; not a full typal engine.
function creatureTypeShares(cards: ScryfallCard[]): Map<string, number> {
  const counts = new Map<string, number>();
  let creatureCount = 0;
  for (const c of cards) {
    const typeLine = (c.type_line ?? c.card_faces?.[0]?.type_line ?? '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    creatureCount++;
    for (const t of typeLine.split('—').slice(1).join(' ').split(/\s+/)) {
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
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
