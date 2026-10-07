/**
 * The discovery slot (E515): up to DISCOVERY_MAX picks a deck, each a card that
 * is LINKED to what the deck already does (it makes what a card in the deck
 * pays off, or pays off what a card in the deck makes) and that the commander's
 * page plays little, so no priority term in the generator ever reached it.
 *
 * WHAT IT IS NOT. Not a priority term. Hyper Focus (E230) and the synergy ratio
 * (E510) both promoted low-inclusion cards by a score and failed their gates:
 * low inclusion mostly means weak, and a promotion is zero-sum against the
 * slots (the displaced card was a premium generic). So this is a move made
 * AFTER the whole-deck search, on the finished list, inside the same trust
 * region, and it earns a slot only by clearing all of:
 *
 *  1. Links. Cards of the deck (and the commander) that the pick feeds or is
 *     fed by, read from the card-facts `produces` / `payoffs` flows (the same
 *     flows the objective's synergy term matches). fit = Σ over the best link
 *     of each partner of (confidence × confidence × repeatability), at least
 *     DISCOVERY_MIN_PARTNERS distinct partners, so one coincidence is no link.
 *     A two-way link (X feeds P and P feeds X) whose cards share a known
 *     Commander Spellbook combo is a verified loop and weighs more; an
 *     unverified loop is just two links.
 *  2. A commander-independent quality bar: EDHREC's global rank (play rate
 *     across every deck), mana value, and likeness to a proven card (a card
 *     the page plays at PROVEN_PCT or more does the same things) or a rank
 *     that needs no such vouching.
 *  3. A slot that is filler. It may cut only a spell the page plays under
 *     FILLER_MAX_PCT and no more than it plays the pick, which the pick does
 *     not out-cost by more than PRICE_ALLOWANCE, that the protection set does
 *     not hold (a staple, a staple rock, a combo piece or a tutor of one, a
 *     protection piece, a Game Changer, a signature card), that is not a
 *     must-include or a lock, and that is not a partner of its own link. The
 *     trust region's role floors and caps, class floors and bracket tier apply
 *     unchanged, so the last card of a role at its target never leaves.
 *  4. The whole deck must not lose: the full objective score after the swap
 *     is at least DISCOVERY_MIN_DELTA above before, and no hard constraint is
 *     worse.
 *
 * Pure and deterministic (ties break by name). Off unless the caller runs it.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { RESOURCES, type CardFacts, type Resource } from '@/deck-builder/services/cardFacts';
import { jaccard, similarityTags } from '@/deck-builder/services/cardFacts/similarity';
import { normalizeCardName } from '../cardIdentity';
import { classCounts } from './classFloors';
import { cardIneligibility } from './constraints';
import { isLandCard } from './context';
import { applyMove, memoRoleOf } from './judge';
import { scoreDeck } from './index';
import { STAPLE_ROCKS } from './optimizer';
import { protectedCards, inclusionPct } from './protections';
import { SYNERGY_RESOURCES } from './terms/synergy';
import {
  countRoles,
  factsRoleOf,
  gameChangerCount,
  trustVerdict,
  type TrustOptions,
} from './trustRegion';
import type { ObjectiveContext, ObjectiveDeck, ObjectiveScore } from './types';

/**
 * Whether the swap leaves any one hard check worse. The summed magnitude is not
 * enough: a pick that cures a colour-identity slip while breaking the owned
 * share by as much nets zero, and the owned share is the user's (E509).
 */
function breaksMore(before: ObjectiveScore, after: ObjectiveScore): boolean {
  const was = new Map<string, number>();
  for (const v of before.violations) was.set(v.check, (was.get(v.check) ?? 0) + v.magnitude);
  const now = new Map<string, number>();
  for (const v of after.violations) now.set(v.check, (now.get(v.check) ?? 0) + v.magnitude);
  return [...now].some(([check, magnitude]) => magnitude > (was.get(check) ?? 0));
}

/** Discovery picks a deck. The slot is a handful of cards of 99, not a theme. */
export const DISCOVERY_MAX = 2;
/** A pick is played by the commander's page in under this share (%): above it the generator already weighs it. */
export const DISCOVERY_MAX_PCT = 15;
/** Only filler is cut: a card the page plays in under this share (%). */
export const FILLER_MAX_PCT = 25;
/** A card the page plays at this share (%) or more is "proven" for the likeness check. */
export const PROVEN_PCT = 25;
/** Likeness (Jaccard over card-facts tags) to a proven card that vouches for a pick. */
export const SIMILAR_MIN = 0.3;
/** EDHREC global rank (lower is more played): the bar, and the rank that needs no likeness vouching. */
export const RANK_MAX = 9000;
export const RANK_UNVOUCHED = 3000;
/** Mana value ceiling; an engine that repeats may cost one more. */
export const CMC_MAX = 4;
/** Distinct deck cards a pick must be linked to, and the least summed link strength. */
export const DISCOVERY_MIN_PARTNERS = 2;
export const DISCOVERY_MIN_FIT = 1.2;
/** The commander is always on the table: a link to it weighs this much more. */
export const COMMANDER_LINK = 1.5;
/** A verified loop (a known combo between the pair) weighs this much more. */
export const LOOP_BONUS = 1.5;
/** The full objective may not fall by more than this (0: it must not lose). */
export const DISCOVERY_MIN_DELTA = 0.1;
/**
 * The first live pairwise run (2026-10-07) took Birds of Paradise (23% of the
 * page's decks) for Kor Spiritdancer (14%) and a $29 card for a $63 one: the
 * Hyper Focus direction, a less played card for a more played one. So a pick is
 * played on the page at least as much as the card it replaces, and costs at
 * most this much more.
 */
export const PRICE_ALLOWANCE = 3;
/** Candidates ranked by fit that are priced against the deck, and pairs scored in full. */
const SHORTLIST = 12;
const FULL_CHECKS = 4;

/**
 * Resources too broad to promise a link on: nearly every deck makes and uses
 * them (graveyard cards, enters/leaves triggers, any loyalty ability), so a
 * label naming one says nothing the deck's own text does not (the first live
 * probe's "makes loyalty counters for Ajani" was a planeswalker's own ability).
 * The objective's synergy term still reads them; the discovery slot does not.
 */
export const VAGUE_RESOURCES: readonly Resource[] = [
  'graveyard',
  'loyalty',
  'etb',
  'ltb',
  'untap',
  'copy',
  'cast-creature',
  'cast-noncreature',
  'creature-type',
  'group-hug',
  'discard',
  'mill',
];
const GENERIC = new Set<Resource>([
  ...RESOURCES.filter((r) => !SYNERGY_RESOURCES.includes(r)),
  ...VAGUE_RESOURCES,
]);
const REPEAT_WEIGHT: Record<string, number> = {
  once: 0.5,
  'per-turn': 0.9,
  'per-event': 1,
  repeatable: 1,
  static: 0.8,
};
const repeatWeight = (r: string) => REPEAT_WEIGHT[r] ?? 0.5;

const NOUN: Partial<Record<Resource, string>> = {
  treasure: 'Treasure',
  clue: 'Clues',
  food: 'Food',
  'creature-token': 'creature tokens',
  'other-token': 'tokens',
  'plus1-counter': '+1/+1 counters',
  'other-counter': 'counters',
  'creature-death': 'creature deaths',
  lifegain: 'life gain',
  landfall: 'landfall',
  graveyard: 'graveyard cards',
  artifact: 'artifacts',
  equipment: 'equipment',
  enchantment: 'enchantments',
  'instant-sorcery': 'instants and sorceries',
  'cast-noncreature': 'noncreature spells',
  'cast-creature': 'creature spells',
  'gy-to-hand': 'cards returned from the graveyard',
  'gy-to-battlefield': 'reanimation',
  'opp-discard': 'opponent discards',
  etb: 'enters-the-battlefield triggers',
  ltb: 'leaves-the-battlefield triggers',
  loyalty: 'loyalty counters',
  copy: 'copies',
  untap: 'untaps',
  'extra-combat': 'extra combats',
};
const nounOf = (r: Resource) => NOUN[r] ?? r.replace(/-/g, ' ');

export interface DiscoveryLink {
  /** 'makes': the pick produces what the partner pays off. 'feeds-on': the partner produces what the pick pays off. */
  kind: 'makes' | 'feeds-on';
  resource: Resource;
  partner: string;
  strength: number;
  /** The pair share a known combo. */
  combo?: boolean;
}

export interface DiscoveryPick {
  cut: ScryfallCard;
  card: ScryfallCard;
  links: DiscoveryLink[];
  fit: number;
  /** The one-line label naming the exact link, for the build report. */
  label: string;
  /** Full objective score change. */
  delta: number;
  /** EDHREC inclusion on the page, percent (null off the page), and the global rank. */
  inclusion: number | null;
  rank: number | null;
  price: string | null;
}

export interface DiscoveryResult {
  deck: ObjectiveDeck;
  picks: DiscoveryPick[];
  /** Candidates that cleared each stage, for tests and the panel read. */
  stages: { candidates: number; barred: number; linked: number; paired: number };
}

export interface DiscoveryOptions {
  /** Names that never leave (must-includes, locks). */
  locks?: readonly string[];
  max?: number;
  trust?: TrustOptions;
  /** Names never brought in (cards the search or a repair cut). */
  exclude?: ReadonlySet<string>;
  /** Overrides FILLER_MAX_PCT / RANK_MAX (tests). */
  fillerMaxPct?: number;
}

const key = (name: string) => normalizeCardName(frontFaceName(name));

/** The quality bar every pick clears, whatever the commander. Null when it does. */
export function qualityBarProblem(
  card: ScryfallCard,
  facts: CardFacts,
  proven: readonly CardFacts[]
): string | null {
  const rank = card.edhrec_rank;
  if (!rank || rank > RANK_MAX) return 'global play rate too low';
  const repeats = facts.produces.concat(facts.payoffs).some((f) => f.repeat === 'repeatable');
  if (card.cmc > CMC_MAX + (repeats ? 1 : 0)) return 'costs too much';
  if (rank > RANK_UNVOUCHED) {
    const tags = similarityTags(facts);
    if (!proven.some((p) => jaccard(tags, similarityTags(p)) >= SIMILAR_MIN)) {
      return 'resembles no proven card';
    }
  }
  return null;
}

export interface FlowIndex {
  producers: Map<Resource, Array<{ name: string; w: number; commander: boolean }>>;
  payoffs: Map<Resource, Array<{ name: string; w: number; commander: boolean }>>;
}

function flowIndex(deck: ObjectiveDeck, ctx: ObjectiveContext, skip?: string): FlowIndex {
  const producers: FlowIndex['producers'] = new Map();
  const payoffs: FlowIndex['payoffs'] = new Map();
  const add = (
    m: FlowIndex['producers'],
    r: Resource,
    e: { name: string; w: number; commander: boolean }
  ) => {
    let l = m.get(r);
    if (!l) m.set(r, (l = []));
    l.push(e);
  };
  const cmd = new Set(deck.commanders.map((c) => c.name));
  for (const card of [...deck.commanders, ...deck.cards]) {
    if (card.name === skip) continue;
    const facts = ctx.factsOf(card);
    const commander = cmd.has(card.name);
    const best = (fs: CardFacts['produces'], rep: boolean) => {
      const m = new Map<Resource, number>();
      for (const f of fs) {
        if (GENERIC.has(f.r)) continue;
        const w = f.conf * (rep ? repeatWeight(f.repeat) : 1);
        m.set(f.r, Math.max(m.get(f.r) ?? 0, w));
      }
      return m;
    };
    for (const [r, w] of best(facts.produces, true))
      add(producers, r, { name: card.name, w, commander });
    for (const [r, w] of best(facts.payoffs, false))
      add(payoffs, r, { name: card.name, w, commander });
  }
  return { producers, payoffs };
}

/** Cards whose names appear together in a known combo (the Commander Spellbook data the generator holds). */
function comboPairs(ctx: ObjectiveContext): Set<string> {
  const pairs = new Set<string>();
  for (const c of ctx.combos ?? []) {
    const names = c.cards.map(key);
    for (const a of names) for (const b of names) if (a < b) pairs.add(`${a}|${b}`);
  }
  return pairs;
}

/** The links of `card` to the deck behind `idx`, best link per partner, and the fit they add up to. */
export function linksOf(
  card: ScryfallCard,
  facts: CardFacts,
  idx: FlowIndex,
  known: ReadonlySet<string>
): { links: DiscoveryLink[]; fit: number } {
  const bestPer = new Map<string, DiscoveryLink>();
  const take = (l: DiscoveryLink) => {
    const prev = bestPer.get(l.partner);
    if (!prev || l.strength > prev.strength) bestPer.set(l.partner, l);
  };
  const isCombo = (partner: string) => {
    const [a, b] = [key(card.name), key(partner)].sort();
    return known.has(`${a}|${b}`);
  };
  const made = new Map<Resource, number>();
  for (const f of facts.produces) {
    if (GENERIC.has(f.r)) continue;
    made.set(f.r, Math.max(made.get(f.r) ?? 0, f.conf * repeatWeight(f.repeat)));
  }
  const paid = new Map<Resource, number>();
  for (const f of facts.payoffs) {
    if (GENERIC.has(f.r)) continue;
    paid.set(f.r, Math.max(paid.get(f.r) ?? 0, f.conf));
  }
  for (const [r, w] of made) {
    for (const p of idx.payoffs.get(r) ?? []) {
      if (p.name === card.name) continue;
      take({
        kind: 'makes',
        resource: r,
        partner: p.name,
        strength: w * p.w * (p.commander ? COMMANDER_LINK : 1),
      });
    }
  }
  for (const [r, w] of paid) {
    for (const s of idx.producers.get(r) ?? []) {
      if (s.name === card.name) continue;
      take({
        kind: 'feeds-on',
        resource: r,
        partner: s.name,
        strength: w * s.w * (s.commander ? COMMANDER_LINK : 1),
      });
    }
  }
  // A loop: the pair feed each other, and a known combo says the pair works.
  const links = [...bestPer.values()];
  for (const l of links) {
    const back = l.kind === 'makes' ? paid : made;
    const mutual = [...back.keys()].some((r) =>
      (l.kind === 'makes' ? idx.producers : idx.payoffs).get(r)?.some((e) => e.name === l.partner)
    );
    if (mutual && isCombo(l.partner)) {
      l.combo = true;
      l.strength *= LOOP_BONUS;
    }
  }
  links.sort((a, b) => b.strength - a.strength || a.partner.localeCompare(b.partner));
  return { links, fit: links.reduce((s, l) => s + l.strength, 0) };
}

/** "makes Treasure for Marionette Master and Pitiless Plunderer" / "pays off the creature tokens that X makes". */
export function labelFor(links: readonly DiscoveryLink[]): string {
  const top = links.slice(0, 3);
  const byResource = new Map<string, DiscoveryLink[]>();
  for (const l of top) {
    const k = `${l.kind}:${l.resource}`;
    byResource.set(k, [...(byResource.get(k) ?? []), l]);
  }
  const join = (xs: string[]) =>
    xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
  const parts = [...byResource.values()].map((group) => {
    const { kind, resource } = group[0];
    const names = join(group.map((g) => g.partner));
    const combo = group.some((g) => g.combo) ? ', a known combo' : '';
    return kind === 'makes'
      ? `makes ${nounOf(resource)} for ${names}${combo}`
      : `pays off the ${nounOf(resource)} that ${names} makes${combo}`;
  });
  return parts.join('; ');
}

/** The discovery pass. See the file header for the rules. */
export function discover(
  seed: ObjectiveDeck,
  candidates: readonly ScryfallCard[],
  baseCtx: ObjectiveContext,
  options: DiscoveryOptions = {}
): DiscoveryResult {
  const max = options.max ?? DISCOVERY_MAX;
  const fillerMax = options.fillerMaxPct ?? FILLER_MAX_PCT;
  const trust: TrustOptions = options.trust ?? {};
  const roleOf = memoRoleOf(trust.roleOf ?? baseCtx.roleOf ?? factsRoleOf(baseCtx));
  const known = comboPairs(baseCtx);
  const fastCtx = (c: ObjectiveContext): ObjectiveContext => ({
    ...c,
    weights: { ...c.weights, mana: 0, winline: 0 },
  });
  const locked = new Set(
    [
      ...(baseCtx.customization.mustIncludeCards ?? []),
      ...STAPLE_ROCKS,
      ...(options.locks ?? []),
    ].map(key)
  );
  const commanderKeys = new Set(seed.commanders.map((c) => key(c.name)));
  const seen = new Set<string>();
  const pool = [...candidates]
    .filter((c) => {
      const k = key(c.name);
      if (seen.has(k) || commanderKeys.has(k) || options.exclude?.has(c.name)) return false;
      seen.add(k);
      return !isLandCard(c) && cardIneligibility(c, baseCtx) === null;
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const stages = { candidates: pool.length, barred: 0, linked: 0, paired: 0 };
  const picks: DiscoveryPick[] = [];
  const taken = new Set<string>(); // discovery picks and their link partners: never cut by a later pick
  let deck = seed;

  while (picks.length < max) {
    const ctx: ObjectiveContext = { ...baseCtx, slotOrder: deck.cards.map((c) => c.name) };
    const inDeck = new Set(deck.cards.map((c) => key(c.name)));
    const idx = flowIndex(deck, ctx);
    const proven = deck.cards
      .filter((c) => !isLandCard(c) && inclusionPct(c, ctx) >= PROVEN_PCT)
      .map((c) => ctx.factsOf(c));

    // 1-2. Linked, played little on the page, and past the quality bar.
    const linked: Array<{ card: ScryfallCard; links: DiscoveryLink[]; fit: number }> = [];
    for (const card of pool) {
      if (inDeck.has(key(card.name))) continue;
      if (inclusionPct(card, ctx) >= DISCOVERY_MAX_PCT) continue;
      const facts = ctx.factsOf(card);
      if (qualityBarProblem(card, facts, proven)) {
        if (picks.length === 0) stages.barred++;
        continue;
      }
      const { links, fit } = linksOf(card, facts, idx, known);
      if (links.length < DISCOVERY_MIN_PARTNERS || fit < DISCOVERY_MIN_FIT) continue;
      linked.push({ card, links, fit });
    }
    if (picks.length === 0) stages.linked = linked.length;
    linked.sort((a, b) => b.fit - a.fit || a.card.name.localeCompare(b.card.name));
    const shortlist = linked.slice(0, SHORTLIST);
    if (shortlist.length === 0) break;

    // 3. The filler a pick may take.
    const protectedNow = protectedCards(deck, ctx, trust.stapleBar);
    const rolesNow = countRoles(deck, roleOf);
    const classesNow = classCounts(deck, ctx);
    const gcNow = gameChangerCount(deck, ctx);
    const fast = fastCtx(ctx);
    const fastNow = scoreDeck(deck, fast).total;
    const removable = deck.cards
      .map((c, i) => ({ c, i }))
      .filter(
        ({ c, i }) =>
          !isLandCard(c) &&
          !locked.has(key(c.name)) &&
          !taken.has(c.name) &&
          !protectedNow.has(c.name) &&
          inclusionPct(c, ctx) < fillerMax &&
          deck.cards.findIndex((d) => d.name === c.name) === i
      );
    const priceOf = (c: ScryfallCard) =>
      parseFloat(getCardPrice(c, ctx.customization.currency ?? 'USD') ?? '') || 0;
    const loss = new Map<number, number>();
    for (const { i } of removable) {
      const without = { commanders: deck.commanders, cards: deck.cards.filter((_, j) => j !== i) };
      loss.set(i, fastNow - scoreDeck(without, fast).total);
    }

    // Pairs by fast gain, those inside the trust region and still linked
    // without the card they cut, then the best few in full.
    const pairs: Array<{
      cand: (typeof shortlist)[number];
      out: number;
      links: DiscoveryLink[];
      fit: number;
      est: number;
    }> = [];
    for (const cand of shortlist) {
      const withCand = scoreDeck(applyMove(deck, { out: [], in: [cand.card] }), fast).total;
      const gain = withCand - fastNow;
      const incoming = inclusionPct(cand.card, ctx);
      const incomingPrice = priceOf(cand.card);
      for (const { c, i } of removable) {
        if (inclusionPct(c, ctx) > incoming) continue;
        if (incomingPrice > priceOf(c) + PRICE_ALLOWANCE) continue;
        // Same slot kind: the deck keeps its land count and its nonland count.
        const verdict = trustVerdict(rolesNow, [c], [cand.card], ctx, protectedNow, 0, {
          ...trust,
          roleOf,
          classesNow,
          gameChangersNow: gcNow,
        });
        if (verdict.blocked) continue;
        pairs.push({
          cand,
          out: i,
          links: cand.links,
          fit: cand.fit,
          est: gain - (loss.get(i) ?? 0),
        });
      }
    }
    stages.paired = Math.max(stages.paired, pairs.length);
    pairs.sort(
      (a, b) =>
        b.est - a.est ||
        a.cand.card.name.localeCompare(b.cand.card.name) ||
        deck.cards[a.out].name.localeCompare(deck.cards[b.out].name)
    );

    let chosen: DiscoveryPick | null = null;
    let nextDeck = deck;
    const before = scoreDeck(deck, ctx);
    const triedCut = new Map<string, number>();
    let checks = 0;
    for (const p of pairs) {
      if (checks >= FULL_CHECKS) break;
      const cutCard = deck.cards[p.out];
      // The pick's links must survive without the card it cuts.
      const idxWithout = flowIndex(deck, ctx, cutCard.name);
      const re = linksOf(p.cand.card, ctx.factsOf(p.cand.card), idxWithout, known);
      if (re.links.length < DISCOVERY_MIN_PARTNERS || re.fit < DISCOVERY_MIN_FIT) continue;
      const per = (triedCut.get(p.cand.card.name) ?? 0) + 1;
      triedCut.set(p.cand.card.name, per);
      if (per > 2) continue;
      checks++;
      const next = applyMove(deck, { out: [p.out], in: [p.cand.card] });
      const after = scoreDeck(next, ctx);
      if (breaksMore(before, after)) continue;
      const delta = after.total - before.total;
      if (delta < DISCOVERY_MIN_DELTA) continue;
      if (chosen && delta <= chosen.delta) continue;
      const price = getCardPrice(p.cand.card, ctx.customization.currency ?? 'USD');
      chosen = {
        cut: cutCard,
        card: p.cand.card,
        links: re.links,
        fit: re.fit,
        label: labelFor(re.links),
        delta,
        inclusion: ctx.qualityOf(p.cand.card).inclusionPct,
        rank: p.cand.card.edhrec_rank ?? null,
        price: price ?? null,
      };
      nextDeck = next;
    }
    if (!chosen) break;
    picks.push(chosen);
    taken.add(chosen.card.name);
    for (const l of chosen.links) taken.add(l.partner);
    deck = nextDeck;
  }
  return { deck, picks, stages };
}
