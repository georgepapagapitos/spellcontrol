/**
 * Answer-coverage matrix (E79, detection only).
 *
 * The role quota says "8 removal" but never asks removal *of what* — a deck
 * can hit its number with eight fight spells and still lose to the first
 * indestructible enchantment. This classifies every interaction spell by
 * speed (instant vs sorcery), the threat class it answers (creature /
 * artifact / enchantment / planeswalker / graveyard / stack / any-permanent),
 * and its mode (exile / destroy / damage-or-fight / bounce / -X/-X) — modes
 * matter because damage and fight lose to indestructible and bounce is
 * temporary — then checks the deck covers each class its colors could
 * actually fill. Mono-red with no enchantment answer isn't a finding, that's
 * Magic; Selesnya with none is.
 *
 * Positive evidence only: classification comes solely from oracle text, so a
 * card with no text (thin/absent data, golden fixtures) classifies as
 * nothing, and a deck with zero classifiable answers produces zero findings —
 * "not enough interaction" is the role-gap note's job, not ours.
 */
import type { CoherenceFinding, ScryfallCard } from '@/deck-builder/types';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';

export type AnswerThreat =
  | 'creature'
  | 'artifact'
  | 'enchantment'
  | 'planeswalker'
  | 'graveyard'
  | 'stack'
  | 'any-permanent';

/** Tuck ("shuffles it into their library") counts as exile — same resilience. */
export type AnswerMode = 'exile' | 'destroy' | 'damage-or-fight' | 'bounce' | 'minus-x' | 'counter';

export interface AnswerProfile {
  /** Usable on an opponent's turn: instant front face, or flash. */
  instantSpeed: boolean;
  answers: { threat: AnswerThreat; mode: AnswerMode }[];
}

const oracleOf = (c: ScryfallCard): string =>
  (c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text ?? '').join('\n') ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ''); // reminder text mentions fight/damage — strip it

/** Threat classes named in a removal clause's object phrase. */
function threatsInPhrase(phrase: string): AnswerThreat[] {
  if (phrase.includes('graveyard')) return []; // recursion/gy targets, not battlefield removal
  if (phrase.includes('you control')) return []; // self-targeting (blink, sac outlets) — not an answer
  // ponytail: same-sentence blink guard ("exile X, then return it to the
  // battlefield"); two-sentence blink wordings slip through and merely
  // over-credit coverage — safe direction, never a false finding.
  if (phrase.includes('return')) return [];
  if (/\bpermanents?\b/.test(phrase)) {
    return /\bnoncreature\b/.test(phrase)
      ? ['artifact', 'enchantment', 'planeswalker']
      : ['any-permanent'];
  }
  const threats: AnswerThreat[] = [];
  if (/\bcreatures?\b/.test(phrase)) threats.push('creature');
  if (/\bartifacts?\b/.test(phrase)) threats.push('artifact');
  if (/\benchantments?\b/.test(phrase)) threats.push('enchantment');
  if (/\bplaneswalkers?\b/.test(phrase)) threats.push('planeswalker');
  return threats;
}

// Quantifier that separates real removal clauses ("destroy target/all/each …")
// from self-referential text ("destroy this creature at end of combat").
const Q = String.raw`(?:up to \w+ )?(?:another )?(?:target|all(?: other)?|each(?: other)?|any number of)`;

// Each entry: verb clause regex (object phrase captured) + the mode it implies.
const CLAUSES: { re: RegExp; mode: AnswerMode }[] = [
  { re: new RegExp(String.raw`\bdestroys? ${Q}\b([^.;]*)`, 'g'), mode: 'destroy' },
  { re: new RegExp(String.raw`\bexiles? ${Q}\b([^.;]*)`, 'g'), mode: 'exile' },
  {
    re: new RegExp(
      String.raw`\breturns? ${Q}\b([^.;]*?) to (?:its|their) owner(?:'s|s') hands?`,
      'g'
    ),
    mode: 'bounce',
  },
  { re: /\bdeals? (?:\d+|x) damage to ([^.;]*)/g, mode: 'damage-or-fight' },
  { re: /\bdeals? damage equal to [^.;]*? to ([^.;]*)/g, mode: 'damage-or-fight' },
  { re: new RegExp(String.raw`\bfights? ${Q}\b([^.;]*)`, 'g'), mode: 'damage-or-fight' },
  // Edicts: sacrifice ignores indestructible/hexproof — destroy-grade or better.
  {
    re: /\b(?:each|target) (?:opponent|player)[^.;]*? sacrifices? (?:a|an|one|two|three|x) ([^.;]*)/g,
    mode: 'destroy',
  },
  // Chaos Warp-style tuck. ponytail: covers "shuffles it into their library";
  // extend to bottom-of-library wordings if a real deck ever needs them.
  {
    re: new RegExp(String.raw`\bowner of ${Q}\b([^.;]*?) shuffles it into`, 'g'),
    mode: 'exile',
  },
];

const COUNTER_RE = new RegExp(String.raw`\bcounters? ${Q}\b[^.;]*?spell`);
// "graveyards" plural or a non-self possessive — exiling your OWN graveyard
// (delve costs, escape, Shadow of the Grave) is not graveyard hate.
const GRAVEYARD_EXILE_RE = new RegExp(
  String.raw`\bexiles? ${Q}\b[^.;]*(?:graveyards|(?:player's|opponent's|their) graveyard)`
);

/**
 * Classify one card as interaction, from oracle text alone.
 * Returns null when nothing classifies — absence of data is never a signal.
 */
export function classifyAnswer(card: ScryfallCard): AnswerProfile | null {
  const oracle = oracleOf(card);
  if (!oracle) return null;

  const seen = new Set<string>();
  const answers: AnswerProfile['answers'] = [];
  const add = (threat: AnswerThreat, mode: AnswerMode) => {
    const key = `${threat}:${mode}`;
    if (!seen.has(key)) {
      seen.add(key);
      answers.push({ threat, mode });
    }
  };

  if (COUNTER_RE.test(oracle)) add('stack', 'counter');
  if (GRAVEYARD_EXILE_RE.test(oracle)) add('graveyard', 'exile');

  for (const { re, mode } of CLAUSES) {
    for (const m of oracle.matchAll(re)) {
      const phrase = m[1];
      if (mode === 'damage-or-fight' && /\bany target\b/.test(phrase)) {
        add('creature', mode);
        add('planeswalker', mode);
        continue;
      }
      for (const threat of threatsInPhrase(phrase)) add(threat, mode);
    }
  }

  // -X/-X: kills through indestructible, so it's its own (solid) mode.
  if (/\b(?:creatures?|it)\b[^.;]*?\bgets? -(?:\d+|x)\/-(?:\d+|x)/.test(oracle)) {
    add('creature', 'minus-x');
  }

  if (answers.length === 0) return null;
  const typeLine = getFrontFaceTypeLine(card).toLowerCase();
  const instantSpeed =
    typeLine.includes('instant') || (card.keywords ?? []).some((k) => k.toLowerCase() === 'flash');
  return { instantSpeed, answers };
}

// The color pie: which identities can answer each battlefield class at all.
// Graveyard hate is in every color (and colorless); stack is blue's alone.
const FILLABLE: Record<Exclude<AnswerThreat, 'graveyard' | 'stack' | 'any-permanent'>, string[]> = {
  creature: ['W', 'U', 'B', 'R', 'G'],
  artifact: ['W', 'U', 'R', 'G'],
  enchantment: ['W', 'U', 'G'],
  planeswalker: ['W', 'U', 'B', 'R', 'G'],
};
const BATTLEFIELD = Object.keys(FILLABLE) as (keyof typeof FILLABLE)[];

// Damage/fight loses to indestructible; bounce is temporary. Everything else
// (exile, destroy, -X/-X, edicts) removes the threat for good.
const FRAGILE_MODES: ReadonlySet<AnswerMode> = new Set(['damage-or-fight', 'bounce']);

/**
 * Coverage findings over the final deck. Deck-level (no `card` field), so the
 * repair pass never acts on them — detection only by construction.
 */
export function answerCoverageFindings(
  cards: ScryfallCard[],
  colorIdentity: string[]
): CoherenceFinding[] {
  const profiles = cards.map(classifyAnswer).filter((p): p is AnswerProfile => p !== null);
  // Zero classifiable interaction = zero signal (thin card data, or a deck
  // whose removal shortfall the role-gap note already owns). Say nothing.
  if (profiles.length === 0) return [];

  const findings: CoherenceFinding[] = [];
  // A colorless identity answers any permanent through artifacts (Universal
  // Solvent, All Is Dust) — every battlefield class is fillable.
  const canFill = (cls: keyof typeof FILLABLE) =>
    colorIdentity.length === 0 || colorIdentity.some((c) => FILLABLE[cls].includes(c));

  for (const cls of BATTLEFIELD) {
    if (!canFill(cls)) continue; // mono-red can't kill an enchantment — that's Magic, not a finding
    const covering = profiles.filter((p) =>
      p.answers.some((a) => a.threat === cls || a.threat === 'any-permanent')
    );
    if (covering.length === 0) {
      findings.push({
        kind: 'answer-coverage',
        severity: 'warn',
        message: `Nothing here can remove an opposing ${cls} — a hole this color identity could fill.`,
      });
    } else if (
      covering.every((p) =>
        p.answers.every(
          (a) => (a.threat !== cls && a.threat !== 'any-permanent') || FRAGILE_MODES.has(a.mode)
        )
      )
    ) {
      const modes = new Set(
        covering.flatMap((p) =>
          p.answers
            .filter((a) => a.threat === cls || a.threat === 'any-permanent')
            .map((a) => a.mode)
        )
      );
      const n = covering.length;
      findings.push({
        kind: 'answer-coverage',
        severity: 'info',
        message: !modes.has('bounce')
          ? `All ${n} ${cls} answer${n === 1 ? '' : 's'} here ${n === 1 ? 'is a' : 'are'} damage or fight effect${n === 1 ? '' : 's'} — one indestructible ${cls} blanks ${n === 1 ? 'it' : 'them all'}.`
          : !modes.has('damage-or-fight')
            ? `All ${n} ${cls} answer${n === 1 ? '' : 's'} here bounce${n === 1 ? 's' : ''} — the threat comes right back.`
            : `None of the ${n} ${cls} answers exiles or destroys — indestructible or recastable threats outlast them.`,
      });
    } else if (covering.length === 1) {
      findings.push({
        kind: 'answer-coverage',
        severity: 'info',
        message: `Only one answer to an opposing ${cls} — a single copy rarely lines up when it matters.`,
      });
    }
  }

  if (!profiles.some((p) => p.answers.some((a) => a.threat === 'graveyard'))) {
    findings.push({
      kind: 'answer-coverage',
      severity: 'info',
      message: 'No graveyard interaction — reanimator and recursion strategies go unchecked.',
    });
  }
  if (
    colorIdentity.includes('U') &&
    !profiles.some((p) => p.answers.some((a) => a.threat === 'stack'))
  ) {
    findings.push({
      kind: 'answer-coverage',
      severity: 'info',
      message: 'No stack interaction — blue is in the identity, but nothing can counter a spell.',
    });
  }
  if (!profiles.some((p) => p.instantSpeed)) {
    findings.push({
      kind: 'answer-coverage',
      severity: 'info',
      message: 'Every answer is sorcery-speed — the deck can only interact on its own turn.',
    });
  }

  return findings;
}
