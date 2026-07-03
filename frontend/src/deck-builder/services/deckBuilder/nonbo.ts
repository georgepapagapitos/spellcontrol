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
 */
import type { CoherenceFinding, ScryfallCard } from '@/deck-builder/types';
import { AXES, type AxisKey } from '@/deck-builder/services/synergy/axes';

const AXIS_LABELS = new Map(AXES.map((a) => [a.key, a.label]));

const oracleOf = (c: ScryfallCard): string =>
  (c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text ?? '').join('\n') ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '');

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

function wipeTension(oracle: string): NonboHit | null {
  const opposes = new Set<AxisKey>();
  for (const m of oracle.matchAll(/\b(?:destroys?|exiles?) all (?:other )?([^.;]*)/g)) {
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
  const findings: CoherenceFinding[] = [];

  for (const card of nonLandCards) {
    if (card.isMustInclude) continue; // the user forced it — their call
    const oracle = oracleOf(card);
    if (!oracle) continue;

    const hit = hardNonbo(oracle) ?? wipeTension(oracle) ?? graveyardWipeTension(oracle);
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
