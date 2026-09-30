/**
 * Interaction quality: what the deck's answers hit, how fast and how cheaply,
 * plus its protection. The roles term counts removal; this term asks whether
 * the answers are GOOD ones, so Path to Exile (instant, one mana, exiles any
 * creature) outranks Magus of the Abyss, and Lightning Greaves is recognised
 * as the protection piece it is.
 *
 * Each card's answer value is its best interaction fact (cardFacts/schema.ts):
 *
 *   v = breadth(hits) × speed × cost(mv) × mode × limits × repeat
 *
 * - breadth: any permanent 1, creature 0.7 (+0.1 with planeswalker), artifact
 *   or enchantment 0.35 each; a counter for any spell 0.8, noncreature 0.6.
 *   One-sided mass effects ×1.5 (Cyclonic Rift overloaded); symmetric wipes
 *   ×0.8 (a reset button, whose cost to a wide board is the nonbo term's).
 * - speed: instant/flash 1, a repeatable activation 0.95, a trigger 0.85,
 *   sorcery 0.75, static 0.7.
 * - cost: mana value 0-1 → 1, 2 → 0.92, 3 → 0.82, 4 → 0.7, 5 → 0.6, 6+ →
 *   0.5; free (its own alt cost, or free with a commander out) → 1.1.
 * - mode: exile/steal/counter 1, destroy/tuck 0.95, shrink 0.85, damage 0.8,
 *   neutralize 0.8, edict 0.75, fight 0.6, bounce 0.55.
 * - limits: conditional 0.8, combat-only 0.7, colour-restricted 0.75, soft
 *   counter 0.6, temporary 0.5 (not for shrink or damage, which still kill),
 *   a mana-value cap 0.8, token-only 0.3.
 * - repeat: a repeatable or per-turn effect ×1.3 (Royal Assassin).
 *
 * Answers are summed best first with decay ANSWER_DECAY per rank (the tenth
 * answer adds less than the first), scaled by ANSWER_SCALE card-equivalents.
 * A land's answer counts too: Boseiju, Who Endures is removal that costs no
 * spell slot (the roles term still counts removal among spells only, as the
 * report does). A "choose one or more" card answers the union of its modes
 * (Farewell exiles every creature, artifact and enchantment at once).
 * Protection (counted `protection` facts or `isProtectionPiece`, as the
 * card's text bears them out: factsReading.ts) is valued by speed × cost ×
 * repeat and summed with a steeper PROTECTION_DECAY: a deck wants a few
 * pieces, not ten. Where the commander has to survive or connect (a
 * repeating engine, attack triggers: the generator's E532 rule), a piece that
 * keeps it on the battlefield counts SURVIVAL_WEIGHT times.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import {
  countsAsRole,
  type CardFacts,
  type Hit,
  type InteractionFact,
  type Limit,
  type Speed,
} from '@/deck-builder/services/cardFacts';
import { isFreeInteraction, readsAsProtection } from '@/deck-builder/services/tagger/client';
import type { CardNote } from '../types';
import { isLandCard } from '../context';
import {
  commanderMustSurvive,
  isSurvivalPiece,
  protectsOnlyItself,
  rulesText,
} from '../factsReading';
import { round2, type TermFn } from './shared';

export const ANSWER_SCALE = 0.5;
export const ANSWER_DECAY = 0.9;
export const PROTECTION_SCALE = 0.6;
export const PROTECTION_DECAY = 0.6;
/**
 * A survival piece's weight where the commander must survive: half again. At
 * the plain weight a deck's second and third piece (Swiftfoot Boots beside
 * Lightning Greaves) read about 0.36 and 0.21 of a card, under the 0.2-0.3
 * quality gaps the first optimizer gate's search traded them for; at 1.5
 * they read 0.54 and 0.32.
 */
export const SURVIVAL_WEIGHT = 1.5;

const CHOOSE_SEVERAL = /\bchoose (?:one or more|any number)\b/i;

const HIT_BREADTH: Partial<Record<Hit, number>> = {
  permanent: 1,
  'nonland-permanent': 1,
  creature: 0.7,
  planeswalker: 0.1,
  artifact: 0.35,
  enchantment: 0.35,
  battle: 0.05,
  land: 0.1,
  spell: 0.8,
  'noncreature-spell': 0.6,
  'creature-spell': 0.45,
  'instant-sorcery-spell': 0.4,
  ability: 0.3,
};

const SPEED: Record<Speed, number> = {
  instant: 1,
  flash: 1,
  activated: 0.95,
  triggered: 0.85,
  sorcery: 0.75,
  static: 0.7,
};

const MODE: Record<InteractionFact['mode'], number> = {
  exile: 1,
  steal: 1,
  counter: 1,
  destroy: 0.95,
  tuck: 0.95,
  shrink: 0.85,
  damage: 0.8,
  neutralize: 0.8,
  sacrifice: 0.75,
  fight: 0.6,
  bounce: 0.55,
};

const LIMIT: Partial<Record<string, number>> = {
  conditional: 0.8,
  combat: 0.7,
  colour: 0.75,
  'unless-pays': 0.6,
  temporary: 0.5,
  'token-only': 0.3,
  nontoken: 0.95,
  'until-leaves': 0.85,
  'additional-cost': 0.9,
};

/**
 * The commander free-cast wording (Fierce Guardianship, Deflecting Swat,
 * Flawless Maneuver). `isFreeInteraction` reads every free alt cost but, by
 * design, answers false for a protection piece (the generator must not boost
 * it twice), so protection's freeness is read here from the same wording.
 */
const COMMANDER_FREE_CAST =
  /if you control a commander,? you may cast this spell without paying its mana cost/i;

function oracleOf(card: ScryfallCard): string {
  return card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text ?? '').join('\n') ?? '';
}

/** Castable for no mana: its own alt cost (Force of Will, Solitude) or the commander clause. */
export function isFree(card: ScryfallCard): boolean {
  return isFreeInteraction(card) || COMMANDER_FREE_CAST.test(oracleOf(card));
}

export function costFactor(mv: number | null, free: boolean): number {
  if (free) return 1.1;
  const m = mv ?? 3;
  if (m <= 1) return 1;
  if (m === 2) return 0.92;
  if (m === 3) return 0.82;
  if (m === 4) return 0.7;
  if (m === 5) return 0.6;
  return 0.5;
}

function limitFactor(fact: InteractionFact): number {
  let f = 1;
  for (const l of fact.limits as readonly Limit[]) {
    // A -X/-X or damage "until end of turn" still kills: temporary only
    // weakens the modes it undoes (a steal, a bounce that comes back).
    if (l === 'temporary' && (fact.mode === 'shrink' || fact.mode === 'damage')) continue;
    if (/^(mv|power|toughness)[<>]=/.test(l)) f *= 0.8;
    else f *= LIMIT[l] ?? 1;
  }
  return f;
}

function breadth(fact: InteractionFact): number {
  let b = 0;
  for (const h of fact.hits) b += HIT_BREADTH[h] ?? 0;
  b = Math.min(1, b);
  if (fact.scope === 'mass') b *= fact.side === 'all' ? 0.8 : fact.side === 'opponents' ? 1.5 : 1;
  return b;
}

/** A card's best answer, with the fact that gave it. Null when it answers nothing. */
export function answerValue(
  card: ScryfallCard,
  facts: CardFacts
): { v: number; fact: InteractionFact } | null {
  if (facts.interaction.length === 0) return null;
  const free = isFree(card);
  let best: { v: number; fact: InteractionFact } | null = null;
  const modes = [...facts.interaction];
  // "Choose one or more": the modes happen together, so their hits add up.
  const together = facts.interaction.filter((f) => f.limits.includes('modal'));
  if (together.length > 1 && CHOOSE_SEVERAL.test(rulesText(card))) {
    const first = together[0];
    const sameShape = together.every(
      (f) => f.scope === first.scope && f.side === first.side && f.mode === first.mode
    );
    if (sameShape) {
      modes.push({ ...first, hits: [...new Set(together.flatMap((f) => f.hits))] });
    }
  }
  for (const fact of modes) {
    const repeat = fact.repeat === 'repeatable' || fact.repeat === 'per-turn' ? 1.3 : 1;
    const v =
      breadth(fact) *
      SPEED[fact.speed] *
      costFactor(facts.mv, free) *
      MODE[fact.mode] *
      limitFactor(fact) *
      repeat;
    if (v > 0 && (!best || v > best.v)) best = { v, fact };
  }
  return best;
}

/** A protection piece's value (Lightning Greaves, Heroic Intervention, Fierce Guardianship). */
export function protectionValue(card: ScryfallCard, facts: CardFacts): number {
  const fact = facts.roles.find((r) => r.role === 'protection' && countsAsRole(r));
  if (!fact && !readsAsProtection(card)) return 0;
  // The tagger's flag, like the facts, is read against the text (Kaito Shizuki).
  if (protectsOnlyItself(card)) return 0;
  const speed = fact ? SPEED[fact.speed] : 1;
  const repeat = fact && (fact.repeat === 'static' || fact.repeat === 'repeatable') ? 1.2 : 1;
  // A static equipment/aura/permanent protects every turn; its "speed" is the
  // fact's (static 0.7) but it never has to be held up, so floor it at 0.9.
  const effectiveSpeed = fact?.speed === 'static' ? Math.max(0.9, speed) : speed;
  return effectiveSpeed * costFactor(facts.mv, isFree(card)) * repeat;
}

function describe(fact: InteractionFact): string {
  const scope = fact.scope === 'mass' ? (fact.side === 'all' ? 'all ' : "opponents' ") : '';
  return `${fact.speed} ${fact.mode} ${scope}${fact.hits.join('/')}`;
}

export const interactionTerm: TermFn = (deck, ctx) => {
  const answers: Array<{ name: string; v: number; note: string }> = [];
  const protection: Array<{ name: string; v: number; survival: boolean }> = [];
  const mustSurvive = commanderMustSurvive(deck.commanders);
  const seen = new Set<string>();
  for (const card of deck.cards) {
    if (seen.has(card.name)) continue; // basics repeat; no basic answers anything
    seen.add(card.name);
    const facts = ctx.factsOf(card);
    const a = answerValue(card, facts);
    if (a) answers.push({ name: card.name, v: a.v, note: describe(a.fact) });
    if (isLandCard(card)) continue;
    const p = protectionValue(card, facts);
    if (p <= 0) continue;
    const survival = mustSurvive && isSurvivalPiece(card, facts, deck.commanders);
    protection.push({ name: card.name, v: survival ? p * SURVIVAL_WEIGHT : p, survival });
  }
  answers.sort((a, b) => b.v - a.v || a.name.localeCompare(b.name));
  protection.sort((a, b) => b.v - a.v || a.name.localeCompare(b.name));

  const notes: CardNote[] = [];
  let value = 0;
  answers.forEach((a, i) => {
    const v = ANSWER_SCALE * a.v * ANSWER_DECAY ** i;
    value += v;
    notes.push({ name: a.name, value: v, note: `answer #${i + 1}: ${a.note} (${round2(a.v)})` });
  });
  protection.forEach((p, i) => {
    const v = PROTECTION_SCALE * p.v * PROTECTION_DECAY ** i;
    value += v;
    notes.push({
      name: p.name,
      value: v,
      note: `protection #${i + 1} (${round2(p.v)})${p.survival ? ': keeps the commander on the battlefield' : ''}`,
    });
  });
  return {
    value,
    summary: `${answers.length} answers (best ${answers
      .slice(0, 3)
      .map((a) => a.name)
      .join(', ')}), ${protection.length} protection pieces`,
    cards: notes,
  };
};
