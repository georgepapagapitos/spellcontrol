/**
 * Pairwise synergy, two readings:
 *
 * synergy (card facts). Every payoff flow is matched to the producers of the
 * same resource in the deck (cardFacts `produces` → `payoffs`, the trigger
 * and effect tuples projected onto resources: death, creature tokens, +1/+1
 * counters, landfall, the graveyard, ...). A payoff is only as good as what
 * feeds it:
 *
 *   supply(r, b) = Σ producers of r other than b, each conf × (0.5 if it
 *                  produces once, else 1); the commander counts COMMANDER_FEED
 *                  times (it is always on the table)
 *   card b       = PAYOFF_SCALE × conf × (1 − e^(−supply / PAYOFF_K)), its
 *                  best-fed resource
 *   commander    = COMMANDER_PAYOFF_SCALE × (1 − e^(−supply / COMMANDER_K))
 *                  per resource the commander pays off: Meren wants a deck of
 *                  things that die, and every feeder is named.
 *
 *   A payoff with nothing feeding it scores 0: that is the loss. Resources
 *   every deck makes ('mana', 'cards') are left out: they'd pay every
 *   payoff for nothing specific. Payoffs of ONE resource are redundant with
 *   each other: ranked best first, the k-th counts PAYOFF_REDUNDANCY^k (the
 *   tenth death payoff adds a quarter of what the first did), so a deck full
 *   of payoffs can't out-score one with the enablers and answers it needs.
 *
 * lift (E71 card pages, liftSynergy.ts). A seed's co-play pool says which
 * cards its players run with it. A card earns edgeScore(seed → card) from
 * every seed that is IN the deck (the commander is always one), so the reading
 * is deck-context aware: Skullclamp's lift from Pitiless Plunderer only counts
 * while Pitiless Plunderer is in the list. Per card, over the n in-deck seeds:
 *   LIFT_SCALE × (1 − e^(−(Σ edges / n) / LIFT_K)).
 * The mean edge, not the sum: with two dozen seeds a sum saturates for every
 * card and the term degrades into a count of cards any seed mentions. A
 * strong edge (lift 2 × 50% co-play) is ~95; a card every seed runs with at
 * that strength reads 0.85 of the scale, one in a third of the pools ~0.3.
 */
import { RESOURCES, type Resource } from '@/deck-builder/services/cardFacts';
import { edgeScore } from '../../liftSynergy';
import type { CardNote } from '../types';
import { frontTypeLine, isBasicLand } from '../context';
import { rulesText } from '../factsReading';
import { expSat, nameKeys, round2, type TermFn } from './shared';

export const PAYOFF_SCALE = 0.5;
export const PAYOFF_K = 3;
export const PAYOFF_REDUNDANCY = 0.85;
export const COMMANDER_FEED = 2;
export const COMMANDER_PAYOFF_SCALE = 2;
export const COMMANDER_K = 6;
export const LIFT_SCALE = 0.3;
export const LIFT_K = 50;

/**
 * Resources left out: every deck makes mana and cards, so matching on them
 * says nothing about fit; and the sacrifice axis's 'death', which counts a
 * Treasure or a land sacrificed and an opponent's creature dying, is read as
 * the parse's 'creature-death' instead (cardFacts schema, E513).
 */
const GENERIC: ReadonlySet<Resource> = new Set<Resource>(['mana', 'cards', 'death']);
const CAST_TRIGGER =
  /\bwhenever you cast an? (artifact|enchantment|instant|sorcery|creature|planeswalker|legendary) spell\b/i;

export const SYNERGY_RESOURCES: readonly Resource[] = RESOURCES.filter((r) => !GENERIC.has(r));

export const synergyTerm: TermFn = (deck, ctx) => {
  const commanderNames = new Set(deck.commanders.map((c) => c.name));
  const all = [...deck.commanders, ...deck.cards.filter((c) => !isBasicLand(c))];
  // producers[r] = [name, weight]; one entry per copy of a card.
  const producers = new Map<Resource, Array<{ name: string; w: number }>>();
  const payoffs: Array<{ name: string; r: Resource; conf: number }> = [];
  for (const card of all) {
    const facts = ctx.factsOf(card);
    const isCmd = commanderNames.has(card.name);
    const made = new Map<Resource, number>();
    for (const f of facts.produces) {
      if (GENERIC.has(f.r)) continue;
      const w = f.conf * (f.repeat === 'once' ? 0.5 : 1) * (isCmd ? COMMANDER_FEED : 1);
      made.set(f.r, Math.max(made.get(f.r) ?? 0, w));
    }
    for (const [r, w] of made) {
      let list = producers.get(r);
      if (!list) producers.set(r, (list = []));
      list.push({ name: card.name, w });
    }
    const paid = new Map<Resource, number>();
    for (const f of facts.payoffs) {
      if (GENERIC.has(f.r)) continue;
      paid.set(f.r, Math.max(paid.get(f.r) ?? 0, f.conf));
    }
    for (const [r, conf] of paid) payoffs.push({ name: card.name, r, conf });
  }

  // A payoff that triggers on CASTING a kind of spell ("whenever you cast an
  // enchantment spell": Sythis) is fed by cards of that kind, not by a card
  // that puts one onto the battlefield (Enduring Ideal).
  const byName = new Map(all.map((c) => [c.name, c]));
  const castKind = new Map<string, string | null>();
  const castKindOf = (name: string) => {
    if (!castKind.has(name)) {
      const card = byName.get(name);
      const m = card && CAST_TRIGGER.exec(rulesText(card));
      castKind.set(name, m ? m[1].toLowerCase() : null);
    }
    return castKind.get(name)!;
  };
  const supplyFor = (r: Resource, except: string) => {
    const kind = castKindOf(except);
    return (producers.get(r) ?? []).filter(
      (p) =>
        p.name !== except &&
        (!kind || frontTypeLine(byName.get(p.name)!).toLowerCase().includes(kind))
    );
  };

  const notes: CardNote[] = [];
  let value = 0;
  // Non-commander payoffs: each card's best-fed resource.
  const best = new Map<string, { v: number; r: Resource; feeders: string[] }>();
  const commanderLines: string[] = [];
  for (const p of payoffs) {
    const feed = supplyFor(p.r, p.name);
    const supply = feed.reduce((s, f) => s + f.w, 0);
    if (commanderNames.has(p.name)) {
      const v = COMMANDER_PAYOFF_SCALE * expSat(supply, COMMANDER_K);
      if (v <= 0) continue;
      value += v;
      commanderLines.push(`${p.name} pays off ${p.r} (${round2(supply)} supply)`);
      // The commander's payoff value is its feeders' doing: share it among them.
      for (const f of feed) {
        notes.push({
          name: f.name,
          value: (v * f.w) / supply,
          note: `feeds ${p.name}'s ${p.r} payoff`,
        });
      }
      continue;
    }
    const v = PAYOFF_SCALE * p.conf * expSat(supply, PAYOFF_K);
    const prev = best.get(p.name);
    if (!prev || v > prev.v) {
      best.set(p.name, {
        v,
        r: p.r,
        feeders: [...new Set(feed.map((f) => f.name))],
      });
    }
  }
  let dead = 0;
  const byResource = new Map<Resource, Array<[string, { v: number; feeders: string[] }]>>();
  for (const [name, b] of best) {
    if (b.v <= 0) {
      dead++;
      continue;
    }
    let list = byResource.get(b.r);
    if (!list) byResource.set(b.r, (list = []));
    list.push([name, b]);
  }
  for (const [r, list] of byResource) {
    list.sort(([an, a], [bn, b]) => b.v - a.v || an.localeCompare(bn));
    list.forEach(([name, b], k) => {
      const v = b.v * PAYOFF_REDUNDANCY ** k;
      value += v;
      notes.push({
        name,
        value: v,
        names: b.feeders,
        note: `pays off ${r} (payoff ${k + 1} of ${list.length}), fed by ${b.feeders.slice(0, 4).join(', ')}${b.feeders.length > 4 ? ` and ${b.feeders.length - 4} more` : ''}`,
      });
    });
  }
  return {
    value,
    summary: `${best.size - dead} fed payoffs, ${dead} with nothing feeding them${commanderLines.length ? `; ${commanderLines.join('; ')}` : ''}`,
    cards: notes,
  };
};

export const liftTerm: TermFn = (deck, ctx) => {
  const pools = ctx.liftPools;
  if (!pools || pools.size === 0) return { value: 0, summary: 'no lift pools', cards: [] };
  // Seeds present in the deck, each with its pool keyed by lowercase name.
  const inDeck = new Map<string, string>(); // key -> deck name
  for (const c of [...deck.commanders, ...deck.cards]) {
    for (const k of nameKeys(c.name)) inDeck.set(k, c.name);
  }
  const seeds: Array<{
    seed: string;
    pool: Map<string, { lift: number; coPlayPct: number; numDecks: number }>;
  }> = [];
  for (const [seed, entries] of pools) {
    if (!nameKeys(seed).some((k) => inDeck.has(k))) continue;
    const pool = new Map<string, { lift: number; coPlayPct: number; numDecks: number }>();
    for (const e of entries) for (const k of nameKeys(e.name)) pool.set(k, e);
    seeds.push({ seed, pool });
  }
  if (seeds.length === 0) return { value: 0, summary: 'no lift seed is in the deck', cards: [] };

  const notes: CardNote[] = [];
  let value = 0;
  const seen = new Set<string>();
  for (const card of deck.cards) {
    if (seen.has(card.name) || isBasicLand(card)) continue;
    seen.add(card.name);
    const keys = nameKeys(card.name);
    let sum = 0;
    const by: Array<{ seed: string; e: number }> = [];
    for (const { seed, pool } of seeds) {
      if (keys.some((k) => nameKeys(seed).includes(k))) continue; // a seed never lifts itself
      const hit = keys.map((k) => pool.get(k)).find(Boolean);
      if (!hit) continue;
      const e = edgeScore(hit);
      sum += e;
      by.push({ seed, e });
    }
    if (sum <= 0) continue;
    const v = LIFT_SCALE * expSat(sum / seeds.length, LIFT_K);
    value += v;
    by.sort((a, b) => b.e - a.e);
    notes.push({
      name: card.name,
      value: v,
      names: by.map((b) => b.seed),
      note: `lifted by ${by
        .slice(0, 3)
        .map((b) => b.seed)
        .join(', ')}`,
    });
  }
  return {
    value,
    summary: `${notes.length} cards lifted by ${seeds.length} in-deck seeds`,
    cards: notes,
  };
};
