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
 *                 × the best target's worth
 *
 * summed best first with decay TUTOR_DECAY: a second tutor for the same
 * combo is worth less than the first. What a tutor can find is read from its
 * text ("search your library for a green creature card"), so Worldly Tutor
 * finds Walking Ballista and not Heliod, and Crop Rotation, which the facts
 * file as land ramp, is the land tutor that finds Gaea's Cradle. A search
 * for a basic land is ramp, not a tutor.
 */
import type { DetectedCombo, ScryfallCard } from '@/deck-builder/types';
import { countsAsRole, type CardFacts } from '@/deck-builder/services/cardFacts';
import type { CardNote, ObjectiveContext, ObjectiveDeck } from '../types';
import { frontTypeLine, isLandCard } from '../context';
import { rulesText } from '../factsReading';
import { costFactor } from './interaction';
import { deckNameKeys, nameKeys, nonLandCards, pct, round2, type TermFn } from './shared';

export const TUTOR_SCALE = 0.6;
export const TUTOR_DECAY = 0.75;
export const COMBO_TARGET = 1;
export const FINISHER_TARGET = 0.8;

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
const BASIC_TYPES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);
const COLOURS: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

export interface TutorFilter {
  /** Card types it finds; empty means any card. */
  types: string[];
  /** Subtypes it names ("Equipment", "Aura", "Plains"). */
  subtypes: string[];
  colours: string[];
  legendary: boolean;
  /** Where the card goes. */
  to: 'hand' | 'top' | 'battlefield';
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
  const subtypes = words
    .filter((w) => /^(equipment|aura|vehicle|plains|island|swamp|mountain|forest)$/.test(w))
    .map((w) => w[0].toUpperCase() + w.slice(1));
  // "A Forest card", "a Plains or Island card": ramp by land type (Nature's
  // Lore, Farseek), not a search for a particular card.
  const landTypesOnly =
    subtypes.length > 0 &&
    subtypes.every((s) => BASIC_TYPES.has(s)) &&
    types.every((t) => t === 'land');
  if (landTypesOnly) return null;
  const after = text.slice(m.index);
  return {
    types,
    subtypes,
    colours: words.filter((w) => w in COLOURS).map((w) => COLOURS[w]),
    legendary: words.includes('legendary'),
    to: /onto the battlefield/i.test(after.slice(0, 160))
      ? 'battlefield'
      : /on top\b|on the top\b/i.test(after.slice(0, 160))
        ? 'top'
        : 'hand',
    phrase: phrase || 'card',
  };
}

export function tutorFinds(filter: TutorFilter, card: ScryfallCard): boolean {
  const type = frontTypeLine(card).toLowerCase();
  if (filter.types.length && !filter.types.some((t) => type.includes(t))) return false;
  if (filter.subtypes.length && !filter.subtypes.some((s) => type.includes(s.toLowerCase())))
    return false;
  if (filter.legendary && !type.includes('legendary')) return false;
  if (filter.colours.length) {
    const colours = card.card_faces?.[0]?.colors ?? card.colors ?? [];
    if (!filter.colours.every((c) => colours.includes(c))) return false;
  }
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
const DESTINATION = { hand: 1, top: 0.85, battlefield: 1.15 };

/** Complete combos in the deck, where the bracket lets combos count. */
function comboPieces(deck: ObjectiveDeck, ctx: ObjectiveContext): Map<string, DetectedCombo> {
  const target = ctx.customization.targetBracket;
  const pieces = new Map<string, DetectedCombo>();
  if (typeof target === 'number' && target <= 3) return pieces;
  const keys = deckNameKeys(deck);
  for (const combo of ctx.combos ?? []) {
    if (combo.cards.length < 2) continue;
    if (!combo.cards.every((n) => nameKeys(n).some((k) => keys.has(k)))) continue;
    for (const n of combo.cards) for (const k of nameKeys(n)) pieces.set(k, combo);
  }
  return pieces;
}

export interface TutorRead {
  name: string;
  v: number;
  target: string;
  why: string;
  phrase: string;
}

/** Every tutor in the deck with its best target, best first. */
export function readTutors(deck: ObjectiveDeck, ctx: ObjectiveContext): TutorRead[] {
  const pieces = comboPieces(deck, ctx);
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
    let best = { worth: 0, target: '', why: '' };
    for (const c of pool) {
      if (c.name === tutor.name || commanderNames.has(c.name)) continue;
      if (!tutorFinds(filter, c)) continue;
      const combo = nameKeys(c.name)
        .map((k) => pieces.get(k))
        .find(Boolean);
      const finisher = ctx.factsOf(c).roles.some((r) => r.role === 'finisher' && countsAsRole(r));
      const read = combo
        ? { worth: COMBO_TARGET, why: `a piece of ${combo.cards.join(' + ')}` }
        : finisher
          ? { worth: FINISHER_TARGET, why: 'a finisher' }
          : { worth: ctx.qualityOf(c).q, why: `in ${pct(ctx.qualityOf(c).q)} of decks` };
      if (read.worth > best.worth || (read.worth === best.worth && c.name < best.target)) {
        best = { worth: read.worth, target: c.name, why: read.why };
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
