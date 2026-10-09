/**
 * Reason truth: every reason a swap states is re-checked, after the search,
 * against the deck it describes and the cards' own text. A false reason is a
 * trust bug (the first optimizer gate found eight), so a reason that fails
 * is never shown, and a swap whose margin rests on one is undone
 * (optimizer.ts).
 *
 * Each note shape a term writes has a check that reads something OTHER than
 * the term's own arithmetic: the card's text for what it does (an answer's
 * verb, a wipe's reach, a protection clause's object), the deck for what it
 * holds (a feeder, a lift seed, a combo's pieces, a tutor's target), the
 * page for what its players do (inclusion, strength). Notes that report a
 * simulation or a price (mana, curve, ownership) are the measurement itself
 * and pass as stated.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { countsAsRole } from '@/deck-builder/services/cardFacts';
import { getByCardName } from '@/lib/cards/card-text';
import { canProtect, protectsOnlyItself, protectsOthers, rulesText } from './factsReading';
import { tutorFilter, tutorFinds } from './terms/tutors';
import type { ObjectiveContext, ObjectiveDeck, TermKey } from './types';

export interface CheckedReason {
  name: string;
  term: TermKey;
  value: number;
  note: string;
}

/** What each interaction mode must say in the card's text. */
const MODE_TEXT: Record<string, RegExp> = {
  exile: /\bexile/i,
  destroy: /\bdestroy/i,
  counter: /\bcounter (?:target|it|that|all|each)\b/i,
  bounce: /\breturn[^.]*\bto (?:its|their) owner(?:'s|s'|s)? hands?\b/i,
  damage: /\bdamage\b/i,
  sacrifice: /\bsacrifices?\b/i,
  shrink: /\s-(?:\d+|X)\/-(?:\d+|X)\b/i,
  steal: /\bgain control\b/i,
  fight: /\bfights?\b/i,
  tuck: /\b(?:library|bottom)\b/i,
  neutralize:
    /\b(?:loses all abilities|can't attack|can't block|becomes a|tap target|doesn't untap)\b/i,
};

/** The roles term's labels and the fact roles behind them (tutors count as draw there). */
const ROLE_OF_LABEL: Record<string, string[]> = {
  ramp: ['ramp'],
  draw: ['cardDraw', 'tutor'],
  removal: ['removal'],
  wipes: ['boardwipe'],
};

const SYMMETRIC = /\b(?:all|each)\b/i;
const WIPE_VERB = /\b(?:destroy|exile|sacrifice|damage|return|get -|gets -)/i;
const TRANSFORMS = new Set(['transform', 'meld']);
const ONE_SIDED =
  /\b(?:you don't control|your opponents control|an opponent controls|opponents? control)\b/i;

/** The deck card a name means: its full name, or a double-faced card's front face. */
function cardIn(deck: ObjectiveDeck, name: string): ScryfallCard | undefined {
  return [...deck.commanders, ...deck.cards].find(
    (c) => c.name === name || c.name.split(' // ')[0] === name
  );
}

function inDeck(deck: ObjectiveDeck, name: string): boolean {
  return cardIn(deck, name) !== undefined;
}

function splitNames(list: string): string[] {
  // "A, B, C and 4 more" → [A, B, C]; card names can hold commas ("Liliana,
  // Dreadhorde General"), so the deck decides where a name ends.
  return list.replace(/ and \d+ more$/, '').split(', ');
}

/** Names in a comma list, matched greedily against the deck (commas inside names). */
function namesInDeck(deck: ObjectiveDeck, list: string): { found: string[]; missing: string[] } {
  const parts = splitNames(list);
  const found: string[] = [];
  const missing: string[] = [];
  for (let i = 0; i < parts.length;) {
    let matched = false;
    for (let j = parts.length; j > i; j--) {
      const name = parts.slice(i, j).join(', ');
      if (inDeck(deck, name)) {
        found.push(name);
        i = j;
        matched = true;
        break;
      }
    }
    if (!matched) {
      missing.push(parts[i]);
      i++;
    }
  }
  return { found, missing };
}

/**
 * Null when the reason holds for `deck` (the deck the card is in: the final
 * deck for a card that came in, the deck before the swap for one that left),
 * else what is wrong with it.
 */
export function reasonProblem(
  r: CheckedReason,
  deck: ObjectiveDeck,
  ctx: ObjectiveContext
): string | null {
  const card = cardIn(deck, r.name);
  if (!card) return r.name.startsWith('(') ? null : `${r.name} is not in the deck`;
  const facts = ctx.factsOf(card);
  const text = rulesText(card);
  const note = r.note;
  let m: RegExpExecArray | null;

  switch (r.term) {
    case 'quality': {
      const row = getByCardName(ctx.edhrec, card.name);
      if ((m = /^(\d+(?:\.\d+)?)% of this page's decks/.exec(note))) {
        if (!row) return 'not on the page';
        return Math.abs(row.inclusion - Number(m[1])) <= 0.51 ? null : 'inclusion misread';
      }
      if (note.startsWith('off-page') && row) return 'it is on the page';
      return null;
    }
    case 'roles': {
      if ((m = /^(ramp|draw|removal|wipes) is (?:short|overbuilt)/.exec(note))) {
        const roles = ROLE_OF_LABEL[m[1]];
        return facts.roles.some((f) => roles.includes(f.role) && countsAsRole(f))
          ? null
          : `it does not count as ${m[1]}`;
      }
      return null;
    }
    case 'signature': {
      const s = ctx.qualityOf(card).strength;
      return s != null && s !== 0 ? null : 'no strength reading';
    }
    case 'interaction': {
      if ((m = /^answer #\d+: (\w+) (\w+) (all |opponents' )?/.exec(note))) {
        const mode = m[2];
        if (!facts.interaction.some((f) => f.mode === mode)) return `no ${mode} fact`;
        if (MODE_TEXT[mode] && !MODE_TEXT[mode].test(text)) return `the text does not ${mode}`;
        if (m[3] === 'all ' && (!SYMMETRIC.test(text) || ONE_SIDED.test(text)))
          return 'not a symmetric effect';
        return null;
      }
      if (note.startsWith('protection #')) {
        if (protectsOnlyItself(card)) return 'it only protects itself';
        if (note.includes('keeps the commander') && !protectsOthers(card))
          return 'no protection of another permanent';
        if (
          note.includes('keeps the commander') &&
          !deck.commanders.some((c) => canProtect(card, c))
        )
          return 'it cannot reach the commander';
        return null;
      }
      return null;
    }
    case 'nonbo': {
      if (note.startsWith('a symmetric wipe')) {
        // The face you cast: a transforming card's back face is not the card.
        const cast = TRANSFORMS.has(card.layout ?? '')
          ? (card.card_faces?.[0]?.oracle_text ?? '')
          : text;
        const sweeps = cast
          .split(/(?<=[.\n])\s*/)
          .filter((s) => SYMMETRIC.test(s) && WIPE_VERB.test(s));
        // "Non-Elf creatures get -2/-2" has no "all": it spares a kind, and
        // the claim that it hits the deck's own board isn't the card's.
        if (sweeps.length === 0) return 'no "all" or "each" effect on the face you cast';
        if (sweeps.every((s) => ONE_SIDED.test(s))) return 'one-sided';
        // A fixed exception ("except for Krakens") still sweeps this deck; a
        // color the caster names need not.
        if (sweeps.every((s) => /\bof the colou?r of your choice\b/i.test(s)))
          return 'it spares the color its caster names';
        if (!facts.interaction.some((f) => f.scope === 'mass' && f.side === 'all'))
          return 'no symmetric wipe fact';
        return null;
      }
      return null;
    }
    case 'synergy': {
      if ((m = /^pays off ([\w-]+) \(payoff \d+ of \d+\), fed by (.+)$/.exec(note))) {
        const res = m[1];
        if (!facts.payoffs.some((p) => p.r === res)) return `no ${res} payoff`;
        const { found, missing } = namesInDeck(deck, m[2]);
        if (missing.length) return `${missing.join(', ')} not in the deck`;
        const notFeeding = found.filter(
          (n) => !ctx.factsOf(cardIn(deck, n) ?? card).produces.some((p) => p.r === res)
        );
        return notFeeding.length ? `${notFeeding.join(', ')} makes no ${res}` : null;
      }
      if ((m = /^feeds (.+)'s ([\w-]+) payoff$/.exec(note))) {
        const res = m[2];
        if (!facts.produces.some((p) => p.r === res)) return `makes no ${res}`;
        const payer = cardIn(deck, m[1]);
        if (!payer) return `${m[1]} is not in the deck`;
        return ctx.factsOf(payer).payoffs.some((p) => p.r === res)
          ? null
          : `${m[1]} pays off no ${res}`;
      }
      return null;
    }
    case 'lift': {
      if ((m = /^lifted by (.+)$/.exec(note))) {
        const { missing } = namesInDeck(deck, m[1]);
        return missing.length ? `${missing.join(', ')} not in the deck` : null;
      }
      return null;
    }
    case 'combos': {
      if ((m = /^piece of (.+?) \(\d+ decks/.exec(note))) {
        const pieces = m[1].split(' + ');
        const missing = pieces.filter((n) => !inDeck(deck, n));
        return missing.length ? `${missing.join(', ')} not in the deck` : null;
      }
      return null;
    }
    case 'winline': {
      if (note.startsWith('finisher:')) {
        const finisher = facts.roles.some((f) => f.role === 'finisher' && countsAsRole(f));
        return finisher || /\bwin the game\b|\blose the game\b/i.test(text)
          ? null
          : 'no finisher role';
      }
      return null;
    }
    case 'tutors': {
      if ((m = /^tutor #\d+: finds (.+?), (?:a piece of|a finisher|in \d)/.exec(note))) {
        const target = cardIn(deck, m[1]);
        if (!target) return `${m[1]} is not in the deck`;
        const filter = tutorFilter(card);
        if (!filter) return 'not a search';
        return tutorFinds(filter, target) ? null : `it cannot find ${m[1]}`;
      }
      return null;
    }
    case 'engines': {
      return facts.roles.some(
        (f) => f.role === 'cardDraw' && countsAsRole(f) && f.repeat !== 'once'
      )
        ? null
        : 'draws once';
    }
    default:
      // roles, curve, mana, ownership: counts, simulations and prices of the
      // deck itself, reported as measured.
      return null;
  }
}
