import type { ScryfallCard } from '@/deck-builder/types';

/**
 * Odds for the cards that roll dice: cascade, reveal-until and look-at-top-N.
 *
 * Each card in `RULES` carries its own hand-written definition of a good hit,
 * read off its Scryfall oracle text (the fixtures in `mana-sim/__fixtures__`
 * assert the text each rule was written against). Nothing is simulated: a
 * reveal-until or a cascade lands on a uniformly random card among the ones
 * that qualify, and a look-at-N is a hypergeometric draw, so the odds are
 * exact for "this deck's cards, in a random order". That is also why there is
 * no Wilson interval here, unlike `castability.ts`, which measures.
 *
 * Library model: the deck's cards less the chance card itself (a commander
 * has no library copy to remove). Cards already drawn are not tracked, so the
 * odds describe the deck, not a particular turn.
 *
 * Not covered (the card text depends on a number the deck can't supply):
 * Synthetic Destiny, which reveals as many creatures as you exiled, and
 * Coiling Oracle, where a land-or-spell split changes no decision. Etali,
 * Primal Storm also exiles from opposing libraries; only your own top card is
 * counted.
 */

/** One result the card can produce, with its exact probability (0 to 1). */
export interface ChanceOutcome {
  id: string;
  /** Reads after a verb: "a land", "a creature of 4+". */
  label: string;
  p: number;
  /** A result the player would rather not get (a cascade into a mana creature). */
  weak: boolean;
}

export interface ChanceOdds {
  /** The chance card's name. */
  name: string;
  /** What the odds are conditioned on, ending "in this deck". */
  lead: string;
  /** The verb the good hits read after: "Finds", or "Casts" for a cascade. */
  verb: string;
  /** The good hits first, then the weak ones worth naming. */
  outcomes: ChanceOutcome[];
}

type Pred = (c: ScryfallCard) => boolean;

/** A weak outcome is named only once it is likely enough to matter. */
const WEAK_SHOWN_FROM = 0.15;

const frontName = (name: string) => name.split(' // ')[0];
const frontType = (c: ScryfallCard) => c.card_faces?.[0]?.type_line ?? c.type_line ?? '';
const isLand: Pred = (c) => /\bLand\b/.test(frontType(c));
const isCreature: Pred = (c) => /\bCreature\b/.test(frontType(c));
const isLegendary: Pred = (c) => /\bLegendary\b/.test(frontType(c));
const isSpell: Pred = (c) => !isLand(c);

function oracle(c: ScryfallCard): string {
  return c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text ?? '').join('\n') ?? '';
}

/** A creature that taps for mana. */
const isManaCreature: Pred = (c) =>
  isCreature(c) &&
  (c.produced_mana ? c.produced_mana.length > 0 : /\{T\}[^\n]*:[^\n]*\bAdd\b/.test(oracle(c)));

const mvOf = (c: ScryfallCard) => c.cmc ?? 0;

/** P(at least `a` of the `k` successes show up in `n` cards drawn from `m`). */
export function hypergeometricAtLeast(m: number, k: number, n: number, a: number): number {
  n = Math.min(n, m);
  if (a <= 0) return 1;
  if (k < a || n < a) return 0;
  // Sum the lower tail P(X < a) as a ratio of binomials; m is at most ~100.
  const choose = (x: number, y: number) => {
    if (y < 0 || y > x) return 0;
    let r = 1;
    for (let i = 1; i <= y; i++) r = (r * (x - y + i)) / i;
    return r;
  };
  const total = choose(m, n);
  let below = 0;
  for (let x = 0; x < a; x++) below += (choose(k, x) * choose(m - k, n - x)) / total;
  return Math.max(0, Math.min(1, 1 - below));
}

/** The first qualifying card of a shuffled library is uniform over the qualifying ones. */
const shareOf = (pool: ScryfallCard[], good: Pred) =>
  pool.length === 0 ? 0 : pool.filter(good).length / pool.length;

interface Spec {
  lead: string;
  verb?: string;
  /** Computes the outcomes against the deck's library. */
  outcomes: (lib: ScryfallCard[]) => Array<Omit<ChanceOutcome, 'id'> & { id?: string }>;
}

const out = (id: string, label: string, p: number, weak = false): Omit<ChanceOutcome, never> => ({
  id,
  label,
  p,
  weak,
});

/**
 * Cascade, k times from a spell of mana value `mv`. Misses go to the bottom,
 * so k cascades are k distinct qualifying cards drawn without replacement.
 * A good hit costs at least half the cascade spell; a mana creature is the
 * hit that wastes it.
 */
function cascade(mv: number, k: number): Spec {
  const t = Math.max(1, Math.ceil(mv / 2));
  return {
    lead: k > 1 ? `${k} cascades from ${mv}` : `Cascading from ${mv}`,
    verb: 'Casts',
    outcomes: (lib) => {
      const pool = lib.filter((c) => isSpell(c) && mvOf(c) < mv);
      const atLeastOne = (pred: Pred) =>
        hypergeometricAtLeast(pool.length, pool.filter(pred).length, k, 1);
      return [
        out(
          'spell',
          `a spell of ${t}${t < mv - 1 ? '+' : ''}`,
          atLeastOne((c) => mvOf(c) >= t)
        ),
        out('mana-creature', 'a mana creature', atLeastOne(isManaCreature), true),
      ];
    },
  };
}

/** Reveal until one creature, uniform over the creatures that qualify. */
function revealCreature(
  lead: string,
  eligible: Pred,
  good: Pred,
  goodLabel: string,
  weak?: [Pred, string]
): Spec {
  return {
    lead,
    outcomes: (lib) => {
      const pool = lib.filter((c) => isCreature(c) && eligible(c));
      const list = [out('good', goodLabel, shareOf(pool, good))];
      if (weak) list.push(out('weak', weak[1], shareOf(pool, weak[0]), true));
      return list;
    },
  };
}

const RULES: Record<string, Spec> = {
  'Bloodbraid Elf': cascade(4, 1),
  'Bituminous Blast': cascade(5, 1),
  'Apex Devastator': cascade(10, 4),
  'Shardless Agent': cascade(3, 1),
  'Maelstrom Wanderer': cascade(8, 2),
  // Yidris gives the spells you cast that turn cascade; modelled on a 6-drop.
  'Yidris, Maelstrom Wielder': cascade(6, 1),

  // Dies, exiles itself: a creature better than the 4-drop it was.
  Gamekeeper: revealCreature(
    'When it dies, in this deck',
    () => true,
    (c) => mvOf(c) >= 5,
    'a creature of 5+'
  ),
  // Sacrifice a 4-drop: a nonlegendary creature of lesser value, so 3 is the best it gets.
  'Kethek, Crucible Goliath': revealCreature(
    'Sacrificing a 4-drop, in this deck',
    (c) => !isLegendary(c) && mvOf(c) < 4,
    (c) => mvOf(c) === 3,
    'a creature of 3'
  ),
  // Aimed at your own 2-drop: a 5-drop or better is the upgrade, a 2 or less the loss.
  'Proteus Staff': revealCreature(
    'Turning a 2-drop, in this deck',
    () => true,
    (c) => mvOf(c) >= 5,
    'a creature of 5+',
    [(c) => mvOf(c) <= 2, 'a creature of 2 or less']
  ),

  'Ojer Kaslem, Deepest Growth': {
    lead: 'When it connects for 6, in this deck',
    outcomes: (lib) => [
      out('land', 'a land', hypergeometricAtLeast(lib.length, lib.filter(isLand).length, 6, 1)),
      out(
        'creature',
        'a creature of 4+',
        hypergeometricAtLeast(
          lib.length,
          lib.filter((c) => isCreature(c) && mvOf(c) >= 4).length,
          6,
          1
        )
      ),
    ],
  },
  // Sacrifice a 3-drop to put in a creature of up to 4; the 4 is the point.
  'Birthing Ritual': {
    lead: 'Sacrificing a 3-drop, in this deck',
    outcomes: (lib) => [
      out(
        'creature',
        'a creature of 4',
        hypergeometricAtLeast(
          lib.length,
          lib.filter((c) => isCreature(c) && mvOf(c) === 4).length,
          7,
          1
        )
      ),
    ],
  },
  'Collected Company': {
    lead: 'Looking at 6, in this deck',
    outcomes: (lib) => {
      const k = lib.filter((c) => isCreature(c) && mvOf(c) <= 3).length;
      return [
        out('one', 'a creature of 3 or less', hypergeometricAtLeast(lib.length, k, 6, 1)),
        out('two', 'two of them', hypergeometricAtLeast(lib.length, k, 6, 2)),
      ];
    },
  },
  // Your own top card only; the opponents' libraries are not the deck's to know.
  'Etali, Primal Storm': {
    lead: 'Your top card, in this deck',
    outcomes: (lib) => [
      out(
        'spell',
        'a spell of 4+',
        lib.length ? lib.filter((c) => isSpell(c) && mvOf(c) >= 4).length / lib.length : 0
      ),
      out('land', 'a land', lib.length ? lib.filter(isLand).length / lib.length : 0, true),
    ],
  },
};

/** Whether this card has odds worth showing. */
export function isChanceCard(card: ScryfallCard): boolean {
  return Object.prototype.hasOwnProperty.call(RULES, frontName(card.name));
}

/**
 * The odds for `card` against `deck` (the deck's cards, commanders excluded;
 * one copy of `card` is taken out as the spell itself). Null for any card
 * that is not on the list.
 *
 * Weak outcomes are kept only when likely enough to name.
 */
export function chanceOdds(card: ScryfallCard, deck: readonly ScryfallCard[]): ChanceOdds | null {
  const name = frontName(card.name);
  if (!Object.prototype.hasOwnProperty.call(RULES, name)) return null;
  const spec = RULES[name];
  const lib = [...deck];
  const own = lib.findIndex((c) => frontName(c.name) === name);
  if (own >= 0) lib.splice(own, 1);
  const outcomes = spec
    .outcomes(lib)
    .filter((o) => !o.weak || o.p >= WEAK_SHOWN_FROM)
    .map((o) => ({ ...o, id: o.id ?? o.label }));
  return { name: card.name, lead: spec.lead, verb: spec.verb ?? 'Finds', outcomes };
}

/** 0–1 as "93%". A real chance never reads 0% or 100%. */
export function formatChance(p: number): string {
  if (p <= 0) return '0%';
  if (p >= 1) return '100%';
  const pct = Math.round(p * 100);
  return pct < 1 ? '<1%' : pct > 99 ? '99%' : `${pct}%`;
}

/**
 * The one-line read for the card preview: the lead, then the good hits
 * ("Finds a land 93% · a creature of 4+ 91%"), then the weak ones ("Or a
 * mana creature 18%").
 */
export function chanceLine(odds: ChanceOdds): string {
  const good = odds.outcomes.filter((o) => !o.weak);
  const weak = odds.outcomes.filter((o) => o.weak);
  const parts = [odds.lead];
  if (good.length) {
    parts.push(
      good
        .map((o, i) => `${i === 0 ? `${odds.verb} ` : ''}${o.label} ${formatChance(o.p)}`)
        .join(' · ')
    );
  }
  for (const o of weak) parts.push(`Or ${o.label} ${formatChance(o.p)}`);
  return parts.join(' · ');
}

/**
 * For add-card suggestions: the one weak result a candidate card is likely to
 * produce in this deck, e.g. `{ text: 'Cascades into a mana creature 42%' }`.
 * Null when the card is not a chance card or nothing weak is likely.
 */
export function chanceProblem(
  card: ScryfallCard,
  deck: readonly ScryfallCard[]
): { label: string; p: number; text: string } | null {
  const odds = chanceOdds(card, deck);
  const weak = odds?.outcomes.filter((o) => o.weak).sort((a, b) => b.p - a.p)[0];
  if (!weak) return null;
  const verb = odds!.verb === 'Casts' ? 'Cascades into' : 'Finds';
  return { label: weak.label, p: weak.p, text: `${verb} ${weak.label} ${formatChance(weak.p)}` };
}
