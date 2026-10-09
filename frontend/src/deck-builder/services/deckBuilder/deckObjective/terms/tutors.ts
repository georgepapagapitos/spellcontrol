/**
 * Tutors: a tutor is worth the best card it can find in THIS deck. The
 * quality term reads a tutor as its page inclusion (Vampiric Tutor is in 12%
 * of Lathril's decks, an elf lord in 33%), so a free search traded every
 * tutor for a tribal body (the E513 optimizer gate: Lathril lost Demonic,
 * Vampiric and Worldly Tutor, Natural Order and Crop Rotation). What a tutor
 * finds is what it is for:
 *
 *   target worth  1    a piece of a complete combo in the deck (only where
 *                      combos count: the combos term's bracket rule)
 *                 0.8  a finisher (a counted finisher role: Craterhoof)
 *                 q    otherwise the card's own quality read (its inclusion)
 *   tutor         TUTOR_SCALE × speed × cost(mv) × where it puts the card
 *                 × when it can search × the best target's worth
 *
 * summed best first with decay TUTOR_DECAY: a second tutor for the same
 * combo is worth less than the first.
 *
 * What a tutor can find is read from its text, and read narrowly (the second
 * optimizer gate caught Oriq Loremage, Higure and Goblin Matron "finding
 * Command Tower"):
 *  - the card it names: type, color, supertype, and any other word as a
 *    subtype ("a Ninja card" finds Ninjas, "a Goblin card" Goblins);
 *  - where the card goes: to hand, to the top, onto the battlefield, or into
 *    the graveyard, which is a tutor only through the deck's own recursion
 *    (a creature for a deck that reanimates, any card for one that regrows);
 *  - a cost the deck has to be able to pay ("sacrifice another Cleric");
 *  - a search behind a combat hit (Higure, the Still Wind) works sometimes.
 * Crop Rotation, which the facts file as land ramp, is the land tutor that
 * finds Gaea's Cradle; a search by basic land type is ramp, not a tutor.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { countsAsRole, type CardFacts } from '@/deck-builder/services/cardFacts';
import type { CardNote, ObjectiveContext, ObjectiveDeck } from '../types';
import { viableCombos } from '../constraints';
import { frontTypeLine, isLandCard } from '../context';
import { rulesText } from '../factsReading';
import { costFactor } from './interaction';
import { nameKeys, nonLandCards, pct, round2, type TermFn } from './shared';

export const TUTOR_SCALE = 0.6;
export const TUTOR_DECAY = 0.75;
export const COMBO_TARGET = 1;
export const FINISHER_TARGET = 0.8;
/** A search that needs a combat hit first (Higure) finds its card some games, not every game. */
export const COMBAT_HIT = 0.5;
/** Into the graveyard: worth this much of the target, when the deck can get it back. */
export const REANIMATE_REACH = 0.8;
export const REGROW_REACH = 0.6;

const SEARCH =
  /\bsearch(?:es)? (?:your|their) library for (?:a|an|one|two|three|up to \w+|any number of) ([^.]*?)\bcards?\b/i;
const TYPES = [
  'creature',
  'artifact',
  'enchantment',
  'land',
  'instant',
  'sorcery',
  'planeswalker',
  'battle',
] as const;
const BASIC_TYPES = new Set(['plains', 'island', 'swamp', 'mountain', 'forest']);
const COLOURS: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};
/** Words in a search phrase that narrow nothing. */
const FILLER = new Set(['or', 'and', 'a', 'an', 'nonland', 'permanent', 'historic', 'basic']);

export interface TutorFilter {
  /** Card types it finds; empty means any card. */
  types: string[];
  /** Subtypes it names ("equipment", "ninja", "plains"), lowercased; any one will do. */
  subtypes: string[];
  colours: string[];
  colorless: boolean;
  legendary: boolean;
  /** Where the card goes. */
  to: 'hand' | 'top' | 'battlefield' | 'graveyard';
  /** "Sacrifice another Cleric": a card of this subtype the deck must hold besides the tutor. */
  sacrifices: string | null;
  /** The search is behind a combat hit. */
  onCombatHit: boolean;
  /** The phrase read, for the reason. */
  phrase: string;
}

/** What a tutor finds, from its own text; null when it only fetches basics or isn't a search. */
export function tutorFilter(card: ScryfallCard): TutorFilter | null {
  const text = rulesText(card);
  const m = SEARCH.exec(text);
  if (!m) return null;
  const phrase = m[1].toLowerCase().trim();
  if (/\bbasic\b/.test(phrase)) return null;
  const words = phrase.split(/[\s,]+/).filter(Boolean);
  const types = TYPES.filter((t) => words.includes(t));
  const subtypes = words.filter(
    (w) =>
      !(TYPES as readonly string[]).includes(w) &&
      !(w in COLOURS) &&
      w !== 'colorless' &&
      w !== 'legendary' &&
      !FILLER.has(w)
  );
  // "A Forest card", "a Plains or Island card": ramp by land type (Nature's
  // Lore, Farseek), not a search for a particular card.
  if (
    subtypes.length > 0 &&
    subtypes.every((s) => BASIC_TYPES.has(s)) &&
    types.every((t) => t === 'land')
  )
    return null;
  // The sentence the search is in, and the clause before it (its cost or trigger).
  const sentenceStart = Math.max(text.lastIndexOf('\n', m.index), text.lastIndexOf('. ', m.index));
  const lead = text.slice(sentenceStart + 1, m.index).toLowerCase();
  const after = text.slice(m.index, m.index + 200).toLowerCase();
  const sac = /\bsacrifice another ([a-z]+)\b/.exec(lead);
  return {
    types,
    subtypes,
    colours: words.filter((w) => w in COLOURS).map((w) => COLOURS[w]),
    colorless: words.includes('colorless'),
    legendary: words.includes('legendary'),
    to: /onto the battlefield/.test(after)
      ? 'battlefield'
      : /into (?:your|their) graveyard/.test(after)
        ? 'graveyard'
        : /on top\b|on the top\b/.test(after)
          ? 'top'
          : 'hand',
    sacrifices: sac && sac[1] !== 'creature' && sac[1] !== 'permanent' ? sac[1] : null,
    onCombatHit: /\bdeals? combat damage to a player\b/.test(lead),
    phrase: phrase || 'card',
  };
}

export function tutorFinds(filter: TutorFilter, card: ScryfallCard): boolean {
  const type = frontTypeLine(card).toLowerCase();
  if (filter.types.length && !filter.types.some((t) => type.includes(t))) return false;
  if (filter.subtypes.length && !filter.subtypes.some((s) => type.includes(s))) return false;
  if (filter.legendary && !type.includes('legendary')) return false;
  const colours = card.card_faces?.[0]?.colors ?? card.colors ?? [];
  if (filter.colorless && colours.length > 0) return false;
  if (filter.colours.length && !filter.colours.every((c) => colours.includes(c))) return false;
  return true;
}

/** A card the objective treats as a tutor: a counted tutor role, or a land search for nonbasics. */
function isTutor(card: ScryfallCard, facts: CardFacts): boolean {
  if (isLandCard(card)) return false;
  if (facts.roles.some((r) => r.role === 'tutor' && countsAsRole(r))) return true;
  return facts.roles.some((r) => r.role === 'ramp' && r.sub === 'land' && countsAsRole(r));
}

const SPEED: Record<string, number> = {
  instant: 1,
  flash: 1,
  activated: 0.95,
  triggered: 0.85,
  sorcery: 0.85,
  static: 0.85,
};
const DESTINATION = { hand: 1, top: 0.85, battlefield: 1.15, graveyard: 1 };

export interface TutorRead {
  name: string;
  v: number;
  target: string;
  why: string;
  phrase: string;
}

/** How the deck gets a card back from its graveyard: reanimation, regrowth, or neither. */
function recursionOf(deck: ObjectiveDeck, ctx: ObjectiveContext) {
  let reanimates = false;
  let regrows = false;
  for (const c of [...deck.commanders, ...deck.cards]) {
    for (const r of ctx.factsOf(c).roles) {
      if (r.role !== 'recursion' || !countsAsRole(r)) continue;
      if (r.sub === 'to-battlefield') reanimates = true;
      else regrows = true;
    }
  }
  return { reanimates, regrows };
}

/** Every tutor in the deck with its best target, best first. */
export function readTutors(deck: ObjectiveDeck, ctx: ObjectiveContext): TutorRead[] {
  const target = ctx.customization.targetBracket;
  const pieces = new Map<string, string>();
  if (!(typeof target === 'number' && target <= 3)) {
    for (const combo of viableCombos(deck, ctx)) {
      for (const n of combo.cards)
        for (const k of nameKeys(n)) pieces.set(k, combo.cards.join(' + '));
    }
  }
  const recursion = recursionOf(deck, ctx);
  const commanderNames = new Set(deck.commanders.map((c) => c.name));
  const pool = [...deck.cards];
  const out: TutorRead[] = [];
  const seen = new Set<string>();
  for (const tutor of nonLandCards(deck)) {
    if (seen.has(tutor.name)) continue;
    seen.add(tutor.name);
    const facts = ctx.factsOf(tutor);
    if (!isTutor(tutor, facts)) continue;
    const filter = tutorFilter(tutor);
    if (!filter) continue;
    // A cost the deck can't pay finds nothing.
    if (
      filter.sacrifices &&
      !pool.some(
        (c) => c.name !== tutor.name && frontTypeLine(c).toLowerCase().includes(filter.sacrifices!)
      )
    )
      continue;
    let best = { worth: 0, target: '', why: '' };
    for (const c of pool) {
      if (c.name === tutor.name || commanderNames.has(c.name)) continue;
      if (!tutorFinds(filter, c)) continue;
      // Into the graveyard, a card is found only if the deck gets it back.
      let reach = 1;
      if (filter.to === 'graveyard') {
        const creature = frontTypeLine(c).includes('Creature');
        reach =
          creature && recursion.reanimates ? REANIMATE_REACH : recursion.regrows ? REGROW_REACH : 0;
        if (reach === 0) continue;
      }
      const combo = nameKeys(c.name)
        .map((k) => pieces.get(k))
        .find(Boolean);
      const finisher = ctx.factsOf(c).roles.some((r) => r.role === 'finisher' && countsAsRole(r));
      const read = combo
        ? { worth: COMBO_TARGET, why: `a piece of ${combo}` }
        : finisher
          ? { worth: FINISHER_TARGET, why: 'a finisher' }
          : { worth: ctx.qualityOf(c).q, why: `in ${pct(ctx.qualityOf(c).q)} of decks` };
      const worth = read.worth * reach;
      if (worth > best.worth || (worth === best.worth && c.name < best.target)) {
        best = {
          worth,
          target: c.name,
          why:
            filter.to === 'graveyard' ? `${read.why}, into the graveyard to bring back` : read.why,
        };
      }
    }
    if (best.worth <= 0) continue;
    const role = facts.roles.find(
      (r) => (r.role === 'tutor' || r.role === 'ramp') && countsAsRole(r)
    );
    const v =
      (SPEED[role?.speed ?? 'sorcery'] ?? 0.85) *
      costFactor(facts.mv, false) *
      DESTINATION[filter.to] *
      (filter.onCombatHit ? COMBAT_HIT : 1) *
      best.worth;
    out.push({ name: tutor.name, v, target: best.target, why: best.why, phrase: filter.phrase });
  }
  return out.sort((a, b) => b.v - a.v || a.name.localeCompare(b.name));
}

export const tutorsTerm: TermFn = (deck, ctx) => {
  const tutors = readTutors(deck, ctx);
  const notes: CardNote[] = [];
  let value = 0;
  tutors.forEach((t, i) => {
    const v = TUTOR_SCALE * t.v * TUTOR_DECAY ** i;
    value += v;
    notes.push({
      name: t.name,
      value: v,
      note: `tutor #${i + 1}: finds ${t.target}, ${t.why} (${round2(t.v)})`,
    });
  });
  return {
    value,
    summary: tutors.length
      ? `${tutors.length} tutors, best finds ${tutors[0].target}`
      : 'no tutor finds anything here',
    cards: notes,
  };
};
