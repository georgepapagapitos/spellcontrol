/**
 * Deck context for substitute ranking (E517): how well a candidate fits the
 * deck it would go into, read from card facts' resource flows. A card that
 * pays off a resource (Grave Pact pays off creatures dying) fits better the
 * more cards in the deck produce it (sac outlets, fodder, token makers); a
 * card that produces a resource fits better the more payoffs the deck runs.
 *
 * Only the synergy-axis resources count (schema.ts RESOURCE_AXIS): they are
 * computed by the same predicates as the deck's synergy analysis, so the
 * reason a row names ("Your Sacrifice / aristocrats engine: 9 cards feed it")
 * is the plan the rest of the deck view already shows. The tribal axis is
 * left out: a creature-type resource is only shared between cards of the SAME
 * type, which the flow record doesn't carry.
 */
import { AXES } from '../synergy/axes';
import { RESOURCE_AXIS, type CardFacts, type Resource } from '../cardFacts/schema';

export interface DeckProfile {
  /** Deck cards producing each resource. */
  producers: ReadonlyMap<Resource, number>;
  /** Deck cards paying off each resource. */
  payoffs: ReadonlyMap<Resource, number>;
}

export interface DeckFit {
  /** 0..1, saturating in the number of supporting cards. */
  fit: number;
  /** The strongest link: the resource, its engine name, which side the candidate is on, and the deck's count. */
  resource: Resource;
  engine: string;
  side: 'payoff' | 'producer';
  count: number;
}

/**
 * An axis as a player names the engine: the registry label's head, lower-cased
 * ("Sacrifice / aristocrats" → "sacrifice", "+1/+1 counters" stays whole).
 */
const ENGINE_NAME = new Map<string, string>(
  AXES.map((a) => {
    const head = a.label.split(' / ')[0];
    return [a.key, head.charAt(0).toLowerCase() + head.slice(1)];
  })
);

const counted = (r: Resource) => {
  const axis = RESOURCE_AXIS[r];
  return axis !== null && axis !== 'tribal';
};

/**
 * Count the deck's producers and payoffs per resource. `leaving` is the card
 * the substitute replaces: its own flows leave with it, so they don't count.
 */
export function deckProfile(deck: readonly CardFacts[], leaving?: CardFacts | null): DeckProfile {
  const producers = new Map<Resource, number>();
  const payoffs = new Map<Resource, number>();
  for (const f of deck) {
    if (leaving && f.oracleId === leaving.oracleId) continue;
    for (const p of f.produces) if (counted(p.r)) producers.set(p.r, (producers.get(p.r) ?? 0) + 1);
    for (const p of f.payoffs) if (counted(p.r)) payoffs.set(p.r, (payoffs.get(p.r) ?? 0) + 1);
  }
  return { producers, payoffs };
}

/**
 * Half-saturation point: four supporting cards make a link half as strong as
 * it can get. A deck with one sac outlet barely feeds a Grave Pact; one with
 * a dozen feeds it every turn.
 */
const HALF = 4;

/** The fewest supporting cards that make a link worth naming. */
export const MIN_SUPPORT = 3;

/** The candidate's strongest producer → payoff link into the deck, or null when none reaches MIN_SUPPORT. */
export function deckFit(c: CardFacts, deck: DeckProfile): DeckFit | null {
  const links: DeckFit[] = [];
  const consider = (r: Resource, side: DeckFit['side'], count: number) => {
    if (count < MIN_SUPPORT || !counted(r)) return;
    const engine = ENGINE_NAME.get(RESOURCE_AXIS[r] ?? '') ?? r;
    links.push({ fit: count / (count + HALF), resource: r, engine, side, count });
  };
  for (const p of c.payoffs) consider(p.r, 'payoff', deck.producers.get(p.r) ?? 0);
  for (const p of c.produces) consider(p.r, 'producer', deck.payoffs.get(p.r) ?? 0);
  // Strongest link; a tie goes to the payoff side, then the resource name, so it's stable.
  links.sort(
    (a, b) => b.fit - a.fit || a.side.localeCompare(b.side) || a.resource.localeCompare(b.resource)
  );
  return links[0] ?? null;
}
