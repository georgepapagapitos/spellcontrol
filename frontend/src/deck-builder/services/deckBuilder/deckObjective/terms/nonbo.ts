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
import { nonLandCards, pct, type TermFn } from './shared';

export const HARD_NONBO = 1;
export const GRAVEYARD_TENSION = 0.5;
export const QUALIFIED = 0.3;
export const WIPE_SELF_SCALE = 1;
export const TOKEN_WEIGHT = 0.5;

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
}

/** The share of the deck's own nonland permanents one wipe mode hits. */
function exposureOf(fact: InteractionFact, self: string, own: readonly Own[]): number {
  const types = hitTypes(fact.hits);
  if (types.size === 0 || own.length === 0) return 0;
  const inBound = mvBound(fact);
  let hit = 0;
  for (const o of own) {
    if (o.name === self) continue;
    if (!o.types.some((t) => types.has(t))) continue;
    if (inBound && !inBound(o.mv)) continue;
    hit += 1 + (o.tokens && types.has('creature') ? TOKEN_WEIGHT : 0);
  }
  return Math.min(1, hit / own.length);
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
  // Forced effects all happen; among optional modes the caster takes the kindest.
  const forcedCost = forced.length
    ? Math.max(...forced.map((f) => exposureOf(f, card.name, own)))
    : 0;
  const optionalCost =
    chosen.length && forced.length === 0
      ? Math.min(...chosen.map((f) => exposureOf(f, card.name, own)))
      : 0;
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
    out.push({
      name: c.name,
      types,
      mv: facts.mv ?? c.cmc ?? 0,
      tokens: facts.produces.some((p) => p.r === 'creature-token'),
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
  for (const f of qualifiedTriggerFindings(spells)) {
    if (!f.card) continue;
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
