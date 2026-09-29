/**
 * The optional LLM review pass (schema.ts, pipeline step 3): a model reads a
 * card's oracle text and the deterministic record's roles, interaction and
 * extended flows, and returns the corrected set in a strict JSON schema.
 * scripts/card-facts-llm.mjs does the network part (and caches every answer
 * per oracle id + model + prompt version); this module holds the prompt, the
 * schema and the merge, so they are versioned and unit-tested.
 *
 * Bump PROMPT_VERSION whenever the prompt or the schema changes: cached
 * answers are keyed on it, so a stale answer can never be merged.
 */
import {
  FACT_ROLES,
  HITS,
  MODES,
  REPEATS,
  RESOURCE_AXIS,
  ROLE_SUBS,
  SCOPES,
  SIDES,
  SPEEDS,
  TIERS,
  TIER_WEIGHT,
  countsAsRole,
  type CardFacts,
  type FactsInputCard,
  type FlowFact,
  type InteractionFact,
  type Resource,
  type RoleFact,
} from './schema';

export const PROMPT_VERSION = 'review-v2';

const EXTENDED_RESOURCES = (Object.keys(RESOURCE_AXIS) as Resource[]).filter(
  (r) => RESOURCE_AXIS[r] === null
);
/** Resources only a trigger can reward; never "produced". */
const PAYOFF_ONLY: Resource[] = ['ltb', 'cast-noncreature', 'cast-creature', 'attack'];
/** Resources a card makes but no card in this vocabulary is rewarded by. */
const PRODUCE_ONLY: Resource[] = [
  'other-token',
  'gy-to-hand',
  'gy-to-battlefield',
  'other-counter',
  'copy',
  'untap',
  'extra-combat',
];
const PRODUCIBLE = EXTENDED_RESOURCES.filter((r) => !PAYOFF_ONLY.includes(r));
const PAYABLE = EXTENDED_RESOURCES.filter((r) => !PRODUCE_ONLY.includes(r));

export interface ReviewRole {
  role: RoleFact['role'];
  tier: RoleFact['tier'];
  sub: RoleFact['sub'];
  speed: RoleFact['speed'];
  repeat: RoleFact['repeat'];
  face: number;
}
export interface ReviewInteraction {
  mode: InteractionFact['mode'];
  hits: InteractionFact['hits'];
  scope: InteractionFact['scope'];
  side: InteractionFact['side'];
  face: number;
}
export interface Review {
  roles: ReviewRole[];
  interaction: ReviewInteraction[];
  produces: Resource[];
  payoffs: Resource[];
}

const enumOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });

/** Strict JSON schema for the answer (structured outputs: additionalProperties false everywhere). */
export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['roles', 'interaction', 'produces', 'payoffs'],
  properties: {
    roles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['role', 'tier', 'sub', 'speed', 'repeat', 'face'],
        properties: {
          role: enumOf(FACT_ROLES),
          tier: enumOf(TIERS),
          sub: { anyOf: [enumOf(ROLE_SUBS), { type: 'null' }] },
          speed: enumOf(SPEEDS),
          repeat: enumOf(REPEATS),
          face: { type: 'integer' },
        },
      },
    },
    interaction: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'hits', 'scope', 'side', 'face'],
        properties: {
          mode: enumOf(MODES),
          hits: { type: 'array', items: enumOf(HITS) },
          scope: enumOf(SCOPES),
          side: enumOf(SIDES),
          face: { type: 'integer' },
        },
      },
    },
    produces: { type: 'array', items: enumOf(PRODUCIBLE) },
    payoffs: { type: 'array', items: enumOf(PAYABLE) },
  },
} as const;

/** The stable system prompt: task, vocabulary and the labeling rules. */
export const SYSTEM_PROMPT = `You review machine-extracted facts about one Magic: The Gathering card for a Commander deck builder. You get the card's Oracle text and a draft read by a rules-based parser. Return the corrected, complete set of facts as JSON matching the schema. Keep what the draft got right; fix what it got wrong; add what it missed. Judge only from the Oracle text given, as the card plays in a Commander game.

ROLES (one entry per role the card fills; omit roles it does not fill):
- ramp: adds mana, puts lands onto the battlefield, extra land drops, reduces what your spells cost, makes Treasure. A land's own mana ability is never ramp.
- cardDraw: draws cards, card selection that nets cards (loot, dig, impulse draw, playing cards off the top), Clues, the monarch, returning cards from graveyard to hand when repeatable or more than one.
- tutor: searches your library for a nonland card (a basic-land search that puts the land onto the battlefield is ramp instead; a land-only tutor to hand is an incidental tutor).
- removal: answers an opponent's permanent one or a few at a time: destroy, exile, bounce, tuck, damage, -N/-N, fight, forced sacrifice (edict), gain control permanently, or an Aura that neutralizes it.
- counterspell: counters a spell or ability (including returning a spell to its owner's hand). Never removal.
- boardwipe: affects every creature (or every nonland permanent of some types) at once, symmetric or one-sided. Mass land destruction alone is not a board wipe.
- protection: gives your permanents or you hexproof, shroud, indestructible, protection, phasing, redirection or damage prevention, or makes your spells uncounterable.
- recursion: returns cards from your graveyard to hand or battlefield, or lets you cast them from the graveyard (not a card that only returns itself).
- finisher: wins the game outright, a mass pump big enough to end it (overrun), extra combats, an X drain to every opponent, or taking every creature for a turn.
- graveyardHate: exiles or shuffles away graveyards, or stops cards from reaching them.

A land is never ramp, including a land that fetches or sacrifices itself for a land (Evolving Wilds). A card's keyword abilities written only as a keyword (Cycling, Flashback, Kicker, Evoke, Equip) are not read for roles or flows.

TIER (how the role counts in a deck):
- primary: the card's main job.
- secondary: a real second job: a later ability, a mode that isn't the card's point, a land's spell side, a spell you must prepare first. A spell whose whole job is drawing ONE card with some library selection (Opt, Ponder, Preordain, Impulse, Faithless Looting) is secondary: selection, not card advantage. A one-shot ritual that adds a fixed amount of mana (Dark Ritual) is secondary.
- incidental: a rider (draw one card on top of something else, one Treasure), a planeswalker ultimate (a minus cost larger than its starting loyalty), anything on a transformed back face, or a role the card only brushes. Incidental roles never fill a deck slot.

SUB (optional detail): ramp: dork, rock, mana, land, extra-land, ritual, treasure, cost-reducer, untap, doubler. cardDraw: draw, cantrip, loot, wheel, impulse, dig, group, monarch, clue, gy-to-hand. tutor: any, creature, artifact, enchantment, instant-sorcery, planeswalker, land-card, permanent, other. removal: spot, bounce, edict. recursion: to-hand, to-battlefield, cast-from-gy. finisher: alt-win, overrun, extra-combat, drain, mass-steal. Use null when none fits.

SPEED of the ability that fills the role: instant (an instant), flash (the enters trigger of a permanent with flash), sorcery (a sorcery, a non-flash permanent's enters trigger, a loyalty ability, "activate only as a sorcery"), activated (an activated ability usable any time), triggered (any other triggered ability), static.
REPEAT: once, per-turn (tap abilities, loyalty, "at the beginning of"), per-event ("whenever"), repeatable (an activated ability bounded only by its cost), static. An ability whose cost sacrifices or discards the card itself is once.
FACE: 0 for the front face or a one-faced card, 1 for the second face.

INTERACTION (every removal, wipe and counter effect, one entry each):
- mode: destroy, exile, bounce, damage, shrink (-N/-N or -1/-1 counters), sacrifice (forced), tuck (into a library), steal, neutralize (Pacifism-style Auras, tap-locks), fight, counter.
- hits: creature, artifact, enchantment, planeswalker, land, battle, nonland-permanent, permanent; for counters: spell, noncreature-spell, creature-spell, instant-sorcery-spell, ability. "Any target" damage hits creature, planeswalker, battle.
- scope: single, multi (two or more targets), mass (all/each).
- side: any (you choose the target), opponents (only opponents' things), all (every player's, yours included).
A temporary steal (until end of turn) is not interaction.

FLOWS. Creature tokens, +1/+1 counters, dying, entering, lifegain and similar synergy resources are tracked elsewhere: never express them here. Only these:
- produces (what the card itself makes for you):
  mana (it adds mana; a land that taps for mana produces mana), cards (it draws cards or puts library cards into your hand), treasure / clue / food (it creates that token), other-token (it creates a NONCREATURE token other than Treasure, Clue or Food: Blood, Map, Powerstone, Incubator, Junk, Role, Shard; never a creature token), gy-to-hand / gy-to-battlefield (it returns a card from a graveyard to hand / to the battlefield; casting from the graveyard is neither), other-counter (it puts counters other than +1/+1 and loyalty: charge, oil, experience, quest, time), copy (it copies a spell or makes a token copy of a permanent), untap (it untaps permanents), extra-combat (it adds a combat phase).
- payoffs (what a trigger or cost of the card rewards):
  cast-noncreature / cast-creature ("whenever YOU cast" that kind of spell; an opponent's casting is not a payoff), cards ("whenever you draw"), attack (a creature of yours attacking or dealing combat damage), ltb (the words "leaves the battlefield" about a permanent other than this one; "dies" is not ltb), mana ("whenever you tap a land for mana"), treasure / clue / food (it sacrifices or rewards sacrificing that token).

Answer with the JSON object only.`;

function describeCard(card: FactsInputCard): string {
  const faces =
    card.card_faces && card.card_faces.length > 0
      ? card.card_faces
      : [
          {
            name: card.name,
            type_line: card.type_line,
            mana_cost: card.mana_cost,
            oracle_text: card.oracle_text,
            loyalty: card.loyalty,
          },
        ];
  const lines = [`Card: ${card.name} (layout: ${card.layout ?? 'normal'})`];
  faces.forEach((f, i) => {
    lines.push(
      `Face ${i}: ${f.name} | ${f.mana_cost ?? ''} | ${f.type_line ?? ''}${f.loyalty ? ` | loyalty ${f.loyalty}` : ''}`
    );
    lines.push(f.oracle_text ?? '');
  });
  return lines.join('\n');
}

/** The draft, in the answer's own shape, so "keep it" is a copy. */
export function draftOf(facts: CardFacts): Review {
  return {
    roles: facts.roles
      .filter((r) => r.src.includes('parser'))
      .map((r) => ({
        role: r.role,
        tier: r.tier,
        sub: r.sub,
        speed: r.speed,
        repeat: r.repeat,
        face: r.face,
      })),
    interaction: facts.interaction.map((f) => ({
      mode: f.mode,
      hits: f.hits,
      scope: f.scope,
      side: f.side,
      face: f.face,
    })),
    produces: facts.produces.filter((f) => RESOURCE_AXIS[f.r] === null).map((f) => f.r),
    payoffs: facts.payoffs.filter((f) => RESOURCE_AXIS[f.r] === null).map((f) => f.r),
  };
}

/** The per-card user message. */
export function buildUserMessage(card: FactsInputCard, facts: CardFacts): string {
  return `${describeCard(card)}\n\nParser draft:\n${JSON.stringify(draftOf(facts))}`;
}

const LLM_CONF = 0.75;
const AGREED_CONF = 0.95;
/** An LLM-only claim: recorded, never counted, until a second source agrees. */
const UNCONFIRMED_CONF = 0.5;

/**
 * How a review changes a record.
 *  - `tiers` (the default, and the one the pilot supports): the parser keeps
 *    role membership, speed, repeat, face, interaction and flows. On a role
 *    the parser read and the review names too, the review may reorder
 *    primary and secondary; judging a card's main job is what rules do worst
 *    (the blind holdout's first run: 0.67 tier agreement). It never moves a
 *    role into or out of the counted set on its own, and a role only the
 *    review names is recorded as incidental. On the 300-card pilot with
 *    claude-sonnet-5-5 this lifted holdout tier agreement 0.849 → 0.925 and
 *    changed nothing else.
 *  - `replace`: the review replaces roles, interaction and extended flows; a
 *    parser role it dropped is kept as incidental so the disagreement stays
 *    visible. On the same pilot it cost role precision (0.957 → 0.800) and
 *    flow precision (0.977 → 0.811) on the holdout; kept so the comparison
 *    can be rerun.
 * Tuples, axis flows and niche function strengths always stay the parser's.
 */
export type MergePolicy = 'tiers' | 'replace';

export function mergeReview(
  facts: CardFacts,
  review: Review,
  policy: MergePolicy = 'tiers'
): CardFacts {
  const roles = policy === 'tiers' ? mergeTiers(facts, review) : replaceRoles(facts, review);
  roles.sort(
    (a, b) =>
      TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) ||
      a.ability - b.ability ||
      a.role.localeCompare(b.role)
  );
  const reviewed =
    policy === 'replace'
      ? {
          interaction: replaceInteraction(facts, review),
          produces: replaceFlows(facts.produces, review.produces),
          payoffs: replaceFlows(facts.payoffs, review.payoffs),
        }
      : { interaction: facts.interaction, produces: facts.produces, payoffs: facts.payoffs };
  return { ...facts, ...reviewed, roles, strengths: roleStrengths(facts.strengths, roles) };
}

function mergeTiers(facts: CardFacts, review: Review): RoleFact[] {
  const reviewed = new Map(review.roles.map((r) => [r.role, r]));
  const out: RoleFact[] = facts.roles.map((det) => {
    const r = reviewed.get(det.role);
    if (!r) return det;
    const fromParser = det.src.includes('parser');
    // The review may reorder primary and secondary on a role the parser read;
    // it never moves a role into or out of the counted set on its own.
    const keep = !fromParser || countsAsRole(det) !== countsAsRole(r);
    const tier = keep ? det.tier : r.tier;
    return {
      ...det,
      tier,
      sub: det.sub ?? r.sub,
      conf: fromParser && det.tier === r.tier ? AGREED_CONF : LLM_CONF,
      src: [...det.src, 'llm'],
    };
  });
  for (const r of review.roles) {
    if (out.some((x) => x.role === r.role)) continue;
    out.push({
      role: r.role,
      tier: 'incidental',
      sub: r.sub,
      ability: -1,
      face: r.face,
      speed: r.speed,
      repeat: r.repeat,
      limits: [],
      conf: UNCONFIRMED_CONF,
      src: ['llm'],
    });
  }
  return out;
}

function replaceRoles(facts: CardFacts, review: Review): RoleFact[] {
  const byRole = new Map(facts.roles.map((r) => [r.role, r]));
  const out: RoleFact[] = review.roles.map((r) => {
    const det = byRole.get(r.role);
    const fromParser = det?.src.includes('parser') ?? false;
    return {
      role: r.role,
      tier: r.tier,
      sub: r.sub,
      ability: det?.ability ?? -1,
      face: r.face,
      speed: r.speed,
      repeat: r.repeat,
      limits: det?.limits ?? [],
      conf: fromParser && det?.tier === r.tier ? AGREED_CONF : LLM_CONF,
      src: fromParser ? ['parser', 'llm'] : ['llm'],
    };
  });
  for (const det of facts.roles) {
    if (out.some((r) => r.role === det.role)) continue;
    out.push({ ...det, tier: 'incidental', conf: Math.min(det.conf, 0.4) });
  }
  return out;
}

function replaceInteraction(facts: CardFacts, review: Review): InteractionFact[] {
  const pool = facts.interaction.map((f) => ({ f, used: false }));
  return review.interaction.map((x) => {
    const match = pool.find((p) => !p.used && p.f.mode === x.mode && p.f.scope === x.scope);
    if (match) match.used = true;
    return {
      mode: x.mode,
      hits: x.hits,
      scope: x.scope,
      side: x.side,
      ability: match?.f.ability ?? -1,
      face: x.face,
      speed: match?.f.speed ?? facts.abilities[0]?.speed ?? 'static',
      repeat: match?.f.repeat ?? 'once',
      limits: match?.f.limits ?? [],
      conf: match ? AGREED_CONF : LLM_CONF,
      src: match ? ['parser', 'llm'] : ['llm'],
    };
  });
}

function replaceFlows(kept: FlowFact[], reviewed: Resource[]): FlowFact[] {
  const out = kept.filter((f) => RESOURCE_AXIS[f.r] !== null);
  for (const r of new Set(reviewed)) {
    const det = kept.find((f) => f.r === r);
    out.push(
      det
        ? { ...det, conf: AGREED_CONF, src: ['parser', 'llm'] }
        : { r, ability: -1, face: 0, repeat: 'static', conf: LLM_CONF, src: ['llm'] }
    );
  }
  return out.sort((a, b) => a.r.localeCompare(b.r));
}

/** Role strengths follow the merged roles; niche function strengths stay. */
function roleStrengths(
  previous: Record<string, number>,
  roles: RoleFact[]
): Record<string, number> {
  const strengths: Record<string, number> = {};
  for (const [k, v] of Object.entries(previous)) {
    if (!(FACT_ROLES as readonly string[]).includes(k.split('/')[0])) strengths[k] = v;
  }
  for (const r of roles) {
    strengths[r.role] = Math.max(strengths[r.role] ?? 0, TIER_WEIGHT[r.tier]);
    if (r.sub)
      strengths[`${r.role}/${r.sub}`] = Math.max(
        strengths[`${r.role}/${r.sub}`] ?? 0,
        TIER_WEIGHT[r.tier]
      );
  }
  return Object.fromEntries(Object.entries(strengths).sort(([a], [b]) => a.localeCompare(b)));
}

/** Validate a parsed answer against the schema's enums (structured outputs guarantee shape, not trust). */
export function isReview(x: unknown): x is Review {
  if (!x || typeof x !== 'object') return false;
  const r = x as Review;
  const inList = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v);
  return (
    Array.isArray(r.roles) &&
    r.roles.every(
      (y) =>
        inList(FACT_ROLES, y.role) &&
        inList(TIERS, y.tier) &&
        (y.sub === null || inList(ROLE_SUBS, y.sub)) &&
        inList(SPEEDS, y.speed) &&
        inList(REPEATS, y.repeat) &&
        Number.isInteger(y.face)
    ) &&
    Array.isArray(r.interaction) &&
    r.interaction.every(
      (y) =>
        inList(MODES, y.mode) &&
        Array.isArray(y.hits) &&
        y.hits.every((h) => inList(HITS, h)) &&
        inList(SCOPES, y.scope) &&
        inList(SIDES, y.side) &&
        Number.isInteger(y.face)
    ) &&
    Array.isArray(r.produces) &&
    r.produces.every((p) => inList(PRODUCIBLE, p)) &&
    Array.isArray(r.payoffs) &&
    r.payoffs.every((p) => inList(PAYABLE, p))
  );
}
