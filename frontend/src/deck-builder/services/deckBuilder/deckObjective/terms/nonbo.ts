/**
 * Nonbos: cards that fight the deck's own plan.
 *
 * - hard nonbos (warn, from nonbo.ts E80): a continuous symmetric effect that
 *   switches off an engine the deck is invested in (Rest in Peace in a
 *   graveyard deck, Torpor Orb beside ETB value): HARD_NONBO each;
 * - a graveyard wipe in a graveyard deck (nonbo.ts): GRAVEYARD_TENSION each;
 * - qualified payoffs the deck can barely feed ("another black creature" in a
 *   colorless token deck, E106): QUALIFIED each;
 * - symmetric board wipes, GRADED: the cost is how much of the deck's OWN
 *   board the wipe hits, not a flag. nonbo.ts flags a wipe only once the deck
 *   crosses the investment threshold (five token producers and payoffs), so
 *   one card that tipped the count put every wipe in the deck on the bill at
 *   once (adding Doubling Season to Atraxa read −1.5). Here:
 *
 *     exposure = Σ own nonland permanents the wipe hits (commander included),
 *                a creature-token maker counting 1 + TOKEN_WEIGHT under a
 *                creature wipe (its army dies with it)
 *                ÷ own nonland permanents
 *     cost     = WIPE_SELF_SCALE × exposure
 *
 *   A modal or overload wipe is read at its kindest mode (the caster picks);
 *   a mana-value bound counts only the permanents inside it (Austere
 *   Command's "mana value 3 or less"); a wipe that brings creatures back
 *   (Living Death) costs nothing, as nonbo.ts rules. So Wrath of God costs a
 *   deck whose board is a sixth creatures about 0.17 and a token deck whose
 *   board is mostly token makers close to the full scale, while the
 *   interaction term credits the wipe the same small amount in both.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import type { CardFacts, Hit, InteractionFact } from '@/deck-builder/services/cardFacts';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { nonboFindings, qualifiedTriggerFindings } from '../../nonbo';
import type { CardNote, ObjectiveContext } from '../types';
import { frontTypeLine } from '../context';
import { rulesText, tokensGoToOthers } from '../factsReading';
import { nonLandCards, pct, type TermFn } from './shared';

export const HARD_NONBO = 1;
export const GRAVEYARD_TENSION = 0.5;
export const QUALIFIED = 0.3;
/**
 * Half a card at full exposure. A wipe that clears the deck's whole board is a
 * reset button its players still run (Toxic Deluge is in a third of Meren of
 * Clan Nel Toth's decks), so the cost offsets its interaction credit rather
 * than burying it; at 1 the search cut Toxic Deluge from Meren first.
 */
export const WIPE_SELF_SCALE = 0.5;
export const TOKEN_WEIGHT = 0.5;

/** "Create a 1/1 black Rat creature token": the card makes creature tokens itself. */
function makesOwnCreatureTokens(card: ScryfallCard): boolean {
  return /\bcreates? [^.]*\bcreature tokens?\b/i.test(rulesText(card)) && !tokensGoToOthers(card);
}

/** nonbo.ts's wipe-tension message: those findings are replaced by the graded cost. */
const WIPE_TENSION = /^It sweeps the deck's own /;

const WIPE_MODES = new Set<InteractionFact['mode']>([
  'destroy',
  'exile',
  'damage',
  'shrink',
  'bounce',
  'sacrifice',
  'tuck',
]);

/** The permanent types a hit list reaches. */
function hitTypes(hits: readonly Hit[]): Set<string> {
  const t = new Set<string>();
  for (const h of hits) {
    if (h === 'permanent' || h === 'nonland-permanent') {
      for (const x of ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle']) t.add(x);
    } else if (['creature', 'artifact', 'enchantment', 'planeswalker', 'battle'].includes(h)) {
      t.add(h);
    }
  }
  return t;
}

function mvBound(fact: InteractionFact): ((mv: number) => boolean) | null {
  for (const l of fact.limits) {
    const m = /^mv(<=|>=)(\d+)$/.exec(l);
    if (m) return m[1] === '<=' ? (mv) => mv <= +m[2] : (mv) => mv >= +m[2];
  }
  return null;
}

interface Own {
  name: string;
  types: string[];
  mv: number;
  tokens: boolean;
  /** Front-face colours. */
  colors: string[];
  /** Printed toughness, null when not a number (a creature's "*"). */
  toughness: number | null;
  /** Front-face type line, lowercased (for a "non-Elf" exception). */
  typeLine: string;
}

/** What the wipe's own text narrows it to, beyond the fact's hit list. */
interface WipeText {
  /** "-2/-2": only creatures of toughness this or less die. Null for -X/-X or no shrink. */
  shrink: number | null;
  /** "permanents of the color of your choice": the caster names a colour. */
  colourChoice: boolean;
  /** "Non-Elf creatures get -2/-2" (Eyeblight Massacre): the creature type it spares. */
  spares: string | null;
}

function wipeText(card: ScryfallCard): WipeText {
  const text = rulesText(card);
  const m = /\bgets? -(\d+)\/-\d+\b/i.exec(text);
  const non = /\bnon-?([a-z]+) creatures?\b/i.exec(text);
  return {
    shrink: m ? Number(m[1]) : null,
    colourChoice:
      /\bof the colou?r of (?:your|its controller's) choice\b|\bchoose a colou?r\b/i.test(text),
    // "Nonblack creatures" names a colour, "nontoken" a kind: only a creature
    // type ("Non-Elf") spares part of the deck's own board.
    spares: non && !NOT_A_TYPE.has(non[1].toLowerCase()) ? non[1].toLowerCase() : null,
  };
}

const NOT_A_TYPE = new Set([
  'white',
  'blue',
  'black',
  'red',
  'green',
  'token',
  'legendary',
  'artifact',
  'attacking',
  'blocking',
]);

/** The share of the deck's own nonland permanents one wipe mode hits. */
function exposureOf(
  fact: InteractionFact,
  self: string,
  own: readonly Own[],
  text: WipeText,
  colour: string | null = null
): number {
  const types = hitTypes(fact.hits);
  if (types.size === 0 || own.length === 0) return 0;
  const inBound = mvBound(fact);
  let hit = 0;
  for (const o of own) {
    if (o.name === self) continue;
    if (!o.types.some((t) => types.has(t))) continue;
    if (inBound && !inBound(o.mv)) continue;
    if (colour && !o.colors.includes(colour)) continue;
    if (text.spares && o.typeLine.includes(text.spares)) continue;
    if (fact.mode === 'shrink' && text.shrink !== null && o.toughness !== null) {
      if (o.toughness > text.shrink) continue;
    }
    hit += 1 + (o.tokens && types.has('creature') ? TOKEN_WEIGHT : 0);
  }
  return Math.min(1, hit / own.length);
}

/** The exposure at the colour the caster would name: the one the deck's board has least of. */
function exposureRead(fact: InteractionFact, self: string, own: readonly Own[], text: WipeText) {
  if (!text.colourChoice) return exposureOf(fact, self, own, text);
  return Math.min(...['W', 'U', 'B', 'R', 'G'].map((c) => exposureOf(fact, self, own, text, c)));
}

/** A symmetric wipe's exposure at its kindest optional mode, or null when the card isn't one. */
export function wipeExposure(
  card: ScryfallCard,
  facts: CardFacts,
  own: readonly Own[]
): number | null {
  const wipes = facts.interaction.filter(
    (f) => f.scope === 'mass' && f.side === 'all' && WIPE_MODES.has(f.mode)
  );
  if (wipes.length === 0) return null;
  // Living Death: the creatures come back in the same breath (nonbo.ts's rule).
  if (facts.roles.some((r) => r.role === 'recursion' && r.sub === 'to-battlefield')) return 0;
  const optional = (f: InteractionFact) =>
    f.limits.includes('modal') || f.limits.includes('overload');
  const forced = wipes.filter((f) => !optional(f));
  const chosen = wipes.filter(optional);
  // A mode that isn't a wipe (Golgari Charm's "destroy target enchantment",
  // an overload spell's single target) lets the caster wipe nothing.
  const otherMode =
    facts.interaction.some((f) => optional(f) && !wipes.includes(f)) ||
    facts.roles.some((r) => r.limits.includes('modal') && r.role !== 'boardwipe');
  // "Destroy all ... except": the exception is usually the deck's own kind,
  // and the fact doesn't say which, so no cost is claimed.
  const exempt = (f: InteractionFact) => f.limits.includes('except');
  const text = wipeText(card);
  const read = (f: InteractionFact) => (exempt(f) ? 0 : exposureRead(f, card.name, own, text));
  // Forced effects all happen; among optional modes the caster takes the kindest.
  const forcedCost = forced.length ? Math.max(...forced.map(read)) : 0;
  const optionalCost =
    chosen.length && forced.length === 0 && !otherMode ? Math.min(...chosen.map(read)) : 0;
  return Math.max(forcedCost, optionalCost);
}

/** The deck's own nonland permanents, as the wipe exposure reads them. */
export function ownBoard(
  cards: readonly ScryfallCard[],
  ctx: Pick<ObjectiveContext, 'factsOf'>
): Own[] {
  const out: Own[] = [];
  for (const c of cards) {
    const facts = ctx.factsOf(c);
    const types = facts.types.filter((t) => t !== 'land' && t !== 'instant' && t !== 'sorcery');
    if (types.length === 0 || /\bLand\b/.test(frontTypeLine(c))) continue;
    const face = c.card_faces?.[0];
    const t = Number(face?.toughness ?? c.toughness);
    out.push({
      name: c.name,
      types,
      mv: facts.mv ?? c.cmc ?? 0,
      tokens: facts.produces.some((p) => p.r === 'creature-token'),
      colors: face?.colors ?? c.colors ?? [],
      toughness: Number.isFinite(t) ? t : null,
      typeLine: frontTypeLine(c).toLowerCase(),
    });
  }
  return out;
}

export const nonboTerm: TermFn = (deck, ctx) => {
  const spells = nonLandCards(deck);
  const invested = new Set<string>(analyzeDeckSynergy([...deck.commanders, ...spells]).invested);
  const notes: CardNote[] = [];
  for (const f of nonboFindings(spells, invested)) {
    if (!f.card || WIPE_TENSION.test(f.message)) continue;
    notes.push({
      name: f.card,
      value: -(f.severity === 'warn' ? HARD_NONBO : GRAVEYARD_TENSION),
      note: f.message,
    });
  }
  const byName = new Map(spells.map((c) => [c.name, c]));
  for (const f of qualifiedTriggerFindings(spells)) {
    if (!f.card) continue;
    // A card that makes its own matching tokens feeds itself (Lord Skitter,
    // Sewer King makes a Rat every combat): the finding can't hold for it.
    const self = byName.get(f.card);
    if (self && makesOwnCreatureTokens(self)) continue;
    notes.push({ name: f.card, value: -QUALIFIED, note: f.message });
  }
  const own = ownBoard([...deck.commanders, ...spells], ctx);
  for (const card of spells) {
    if (card.isMustInclude) continue; // the user forced it: their call, as in nonbo.ts
    const exposure = wipeExposure(card, ctx.factsOf(card), own);
    if (!exposure) continue;
    notes.push({
      name: card.name,
      value: -WIPE_SELF_SCALE * exposure,
      note: `a symmetric wipe that hits ${pct(exposure)} of the deck's own board`,
    });
  }
  const value = notes.reduce((s, n) => s + n.value, 0);
  return {
    value,
    summary: notes.length
      ? `${notes.length} cards cost the plan (invested in ${[...invested].join(', ') || 'nothing'})`
      : `no nonbo (invested in ${[...invested].join(', ') || 'nothing'})`,
    cards: notes,
  };
};
