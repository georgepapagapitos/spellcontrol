/**
 * Accuracy benchmark for card facts against a hand-labeled gold set
 * (gold.fixtures.ts). Pure: gold.test.ts holds the floors, and
 * scripts/card-facts-llm.mjs prints the same numbers for the deterministic
 * and the LLM-reviewed records.
 *
 * What is scored:
 *  - roles: membership as a deck slot would count it (primary + secondary on
 *    both sides; see countsAsRole), per role and micro-averaged; then, on
 *    roles both sides name, agreement on tier, speed, repeat and face.
 *  - interaction: fact-level precision/recall, a fact matching on mode and
 *    scope; then, on matched pairs, exact agreement on `hits` and `side`.
 *  - flows: the extended resources only (RESOURCE_AXIS null). Axis resources
 *    reproduce classifyCard by construction and are gated by its own labeled
 *    corpus (synergy/classify.test.ts) plus the parity test here.
 *
 * Confidence intervals resample CARDS with a seeded PRNG, so a rerun gives the
 * same interval.
 */
import {
  FACT_ROLES,
  RESOURCE_AXIS,
  countsAsRole,
  type CardFacts,
  type FactRole,
  type FactsInputCard,
  type Repeat,
  type Resource,
  type Speed,
  type Tier,
} from './schema';

export interface GoldExpect {
  /** role → "T SPEED REPEAT [fN]", T ∈ P | S | I. */
  roles: Partial<Record<FactRole, string>>;
  /** "mode hits scope side [fN]", hits sorted and |-joined. */
  interaction: string[];
  produces: Resource[];
  payoffs: Resource[];
}

export interface GoldCard {
  card: FactsInputCard;
  tags: string[];
  expect: GoldExpect;
}

export interface Counts {
  tp: number;
  fp: number;
  fn: number;
}

export interface Agreement {
  agree: number;
  total: number;
}

export const ERROR_BUCKETS = [
  'polarity',
  'role-confusion',
  'face',
  'missed-trigger',
  'over-tagging',
  'tier',
  'other',
] as const;
export type ErrorBucket = (typeof ERROR_BUCKETS)[number];

export interface BenchError {
  card: string;
  field: 'role' | 'tier' | 'interaction' | 'hits' | 'side' | 'flow';
  bucket: ErrorBucket;
  detail: string;
}

/** Per-card tallies: the unit the bootstrap resamples. */
export interface CardScore {
  name: string;
  roles: Counts;
  byRole: Record<FactRole, Counts>;
  tier: Agreement;
  speed: Agreement;
  repeat: Agreement;
  face: Agreement;
  interaction: Counts;
  hits: Agreement;
  side: Agreement;
  flows: Counts;
  errors: BenchError[];
}

const TIER_OF: Record<string, Tier> = { P: 'primary', S: 'secondary', I: 'incidental' };

interface RoleLabel {
  tier: Tier;
  speed: Speed;
  repeat: Repeat;
  face: number | null;
}

export function parseRoleLabel(label: string): RoleLabel {
  const [t, speed, repeat, face] = label.split(' ');
  return {
    tier: TIER_OF[t],
    speed: speed as Speed,
    repeat: repeat as Repeat,
    face: face ? Number(face.slice(1)) : null,
  };
}

interface InteractionLabel {
  mode: string;
  hits: string;
  scope: string;
  side: string;
  face: number | null;
}

export function parseInteractionLabel(label: string): InteractionLabel {
  const [mode, hits, scope, side, face] = label.split(' ');
  return { mode, hits, scope, side, face: face ? Number(face.slice(1)) : null };
}

const zero = (): Counts => ({ tp: 0, fp: 0, fn: 0 });
const none = (): Agreement => ({ agree: 0, total: 0 });

const EXTENDED = new Set(
  (Object.keys(RESOURCE_AXIS) as Resource[]).filter((r) => RESOURCE_AXIS[r] === null)
);

export function scoreCard(gold: GoldCard, facts: CardFacts): CardScore {
  const name = gold.card.name;
  const errors: BenchError[] = [];
  const byRole = Object.fromEntries(FACT_ROLES.map((r) => [r, zero()])) as Record<FactRole, Counts>;
  const roles = zero();
  const tier = none();
  const speed = none();
  const repeat = none();
  const face = none();

  const expected = new Map<FactRole, RoleLabel>();
  for (const [role, label] of Object.entries(gold.expect.roles) as [FactRole, string][])
    expected.set(role, parseRoleLabel(label));
  const predicted = new Map(facts.roles.map((r) => [r.role, r]));
  const multiFace = (gold.card.card_faces?.length ?? 0) > 1;

  for (const role of FACT_ROLES) {
    const want = expected.get(role);
    const got = predicted.get(role);
    const wantCounts = want ? want.tier !== 'incidental' : false;
    const gotCounts = got ? countsAsRole(got) : false;
    if (wantCounts && gotCounts) {
      roles.tp++;
      byRole[role].tp++;
    } else if (gotCounts) {
      roles.fp++;
      byRole[role].fp++;
      const confused = [...expected.entries()].some(
        ([r, l]) =>
          r !== role &&
          l.tier !== 'incidental' &&
          !(predicted.get(r) && countsAsRole(predicted.get(r)!))
      );
      errors.push({
        card: name,
        field: 'role',
        bucket:
          multiFace && got!.face > 0
            ? 'face'
            : want
              ? 'tier'
              : confused
                ? 'role-confusion'
                : 'over-tagging',
        detail: `+${role} (${got!.tier}${want ? `, labeled ${want.tier}` : ''})`,
      });
    } else if (wantCounts) {
      roles.fn++;
      byRole[role].fn++;
      const confused = facts.roles.some((r) => countsAsRole(r) && !expected.has(r.role));
      errors.push({
        card: name,
        field: 'role',
        bucket:
          multiFace && want!.face !== null && want!.face > 0
            ? 'face'
            : got
              ? 'tier'
              : confused
                ? 'role-confusion'
                : want!.speed === 'triggered'
                  ? 'missed-trigger'
                  : 'other',
        detail: `-${role}${got ? ` (got ${got.tier})` : ''}`,
      });
    }
    if (want && got) {
      tier.total++;
      speed.total++;
      repeat.total++;
      if (want.tier === got.tier) tier.agree++;
      else if (wantCounts === gotCounts)
        errors.push({
          card: name,
          field: 'tier',
          bucket: 'tier',
          detail: `${role} ${got.tier} ≠ ${want.tier}`,
        });
      if (want.speed === got.speed) speed.agree++;
      if (want.repeat === got.repeat) repeat.agree++;
      if (want.face !== null) {
        face.total++;
        if (want.face === got.face) face.agree++;
      }
    }
  }

  // Interaction: greedy match on mode + scope, preferring equal hits.
  const interaction = zero();
  const hits = none();
  const side = none();
  const pool = facts.interaction.map((f) => ({ f, used: false }));
  for (const label of gold.expect.interaction.map(parseInteractionLabel)) {
    const candidates = pool.filter(
      (p) => !p.used && p.f.mode === label.mode && p.f.scope === label.scope
    );
    const pick =
      candidates.find((p) => [...p.f.hits].sort().join('|') === label.hits) ?? candidates[0];
    if (!pick) {
      interaction.fn++;
      errors.push({
        card: name,
        field: 'interaction',
        bucket: label.face !== null && label.face > 0 ? 'face' : 'other',
        detail: `-${label.mode} ${label.hits} ${label.scope} ${label.side}`,
      });
      continue;
    }
    pick.used = true;
    interaction.tp++;
    hits.total++;
    side.total++;
    const gotHits = [...pick.f.hits].sort().join('|');
    if (gotHits === label.hits) hits.agree++;
    else
      errors.push({
        card: name,
        field: 'hits',
        bucket: 'other',
        detail: `${label.mode}: ${gotHits} ≠ ${label.hits}`,
      });
    if (pick.f.side === label.side) side.agree++;
    else
      errors.push({
        card: name,
        field: 'side',
        bucket: 'polarity',
        detail: `${label.mode}: ${pick.f.side} ≠ ${label.side}`,
      });
  }
  for (const p of pool) {
    if (p.used) continue;
    interaction.fp++;
    errors.push({
      card: name,
      field: 'interaction',
      bucket: p.f.face > 0 ? 'face' : 'over-tagging',
      detail: `+${p.f.mode} ${[...p.f.hits].sort().join('|')} ${p.f.scope} ${p.f.side}`,
    });
  }

  // Extended flows.
  const flows = zero();
  for (const [dir, want, got] of [
    ['produces', gold.expect.produces, facts.produces.map((f) => f.r)],
    ['payoffs', gold.expect.payoffs, facts.payoffs.map((f) => f.r)],
  ] as const) {
    const w = new Set(want.filter((r) => EXTENDED.has(r)));
    const g = new Set(got.filter((r) => EXTENDED.has(r)));
    for (const r of g) {
      if (w.has(r)) flows.tp++;
      else {
        flows.fp++;
        errors.push({ card: name, field: 'flow', bucket: 'over-tagging', detail: `+${dir}:${r}` });
      }
    }
    for (const r of w) {
      if (g.has(r)) continue;
      flows.fn++;
      errors.push({
        card: name,
        field: 'flow',
        bucket: dir === 'payoffs' ? 'missed-trigger' : 'other',
        detail: `-${dir}:${r}`,
      });
    }
  }

  return { name, roles, byRole, tier, speed, repeat, face, interaction, hits, side, flows, errors };
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export const precision = (c: Counts) => (c.tp + c.fp === 0 ? 1 : c.tp / (c.tp + c.fp));
export const recall = (c: Counts) => (c.tp + c.fn === 0 ? 1 : c.tp / (c.tp + c.fn));
export const f1 = (c: Counts) => {
  const p = precision(c);
  const r = recall(c);
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
};
export const rate = (a: Agreement) => (a.total === 0 ? 1 : a.agree / a.total);

const addCounts = (a: Counts, b: Counts): Counts => ({
  tp: a.tp + b.tp,
  fp: a.fp + b.fp,
  fn: a.fn + b.fn,
});
const addAgree = (a: Agreement, b: Agreement): Agreement => ({
  agree: a.agree + b.agree,
  total: a.total + b.total,
});

export interface BenchTotals {
  cards: number;
  roles: Counts;
  byRole: Record<FactRole, Counts>;
  tier: Agreement;
  speed: Agreement;
  repeat: Agreement;
  face: Agreement;
  interaction: Counts;
  hits: Agreement;
  side: Agreement;
  flows: Counts;
  buckets: Record<ErrorBucket, number>;
}

export function totals(scores: readonly CardScore[]): BenchTotals {
  const t: BenchTotals = {
    cards: scores.length,
    roles: zero(),
    byRole: Object.fromEntries(FACT_ROLES.map((r) => [r, zero()])) as Record<FactRole, Counts>,
    tier: none(),
    speed: none(),
    repeat: none(),
    face: none(),
    interaction: zero(),
    hits: none(),
    side: none(),
    flows: zero(),
    buckets: Object.fromEntries(ERROR_BUCKETS.map((b) => [b, 0])) as Record<ErrorBucket, number>,
  };
  for (const s of scores) {
    t.roles = addCounts(t.roles, s.roles);
    for (const r of FACT_ROLES) t.byRole[r] = addCounts(t.byRole[r], s.byRole[r]);
    t.tier = addAgree(t.tier, s.tier);
    t.speed = addAgree(t.speed, s.speed);
    t.repeat = addAgree(t.repeat, s.repeat);
    t.face = addAgree(t.face, s.face);
    t.interaction = addCounts(t.interaction, s.interaction);
    t.hits = addAgree(t.hits, s.hits);
    t.side = addAgree(t.side, s.side);
    t.flows = addCounts(t.flows, s.flows);
    for (const e of s.errors) t.buckets[e.bucket]++;
  }
  return t;
}

/** Deterministic PRNG (mulberry32) so a bootstrap interval is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BOOTSTRAP_SEED = 512;

/**
 * Percentile bootstrap 95% interval for a metric over cards: resample the
 * cards with replacement `iterations` times and take the 2.5th/97.5th
 * percentiles of the metric.
 */
export function bootstrapCI(
  scores: readonly CardScore[],
  metric: (t: BenchTotals) => number,
  iterations = 1000,
  seed = BOOTSTRAP_SEED
): [number, number] {
  const rand = mulberry32(seed);
  const values: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const sample: CardScore[] = [];
    for (let j = 0; j < scores.length; j++) sample.push(scores[Math.floor(rand() * scores.length)]);
    values.push(metric(totals(sample)));
  }
  values.sort((a, b) => a - b);
  return [
    values[Math.floor(iterations * 0.025)],
    values[Math.min(iterations - 1, Math.floor(iterations * 0.975))],
  ];
}

/** The headline metrics, one place for the test floors and the report. */
export const HEADLINE: Record<string, (t: BenchTotals) => number> = {
  'roles.precision': (t) => precision(t.roles),
  'roles.recall': (t) => recall(t.roles),
  'roles.tier': (t) => rate(t.tier),
  'roles.speed': (t) => rate(t.speed),
  'roles.repeat': (t) => rate(t.repeat),
  'interaction.precision': (t) => precision(t.interaction),
  'interaction.recall': (t) => recall(t.interaction),
  'interaction.hits': (t) => rate(t.hits),
  'interaction.side': (t) => rate(t.side),
  'flows.precision': (t) => precision(t.flows),
  'flows.recall': (t) => recall(t.flows),
};

export function benchmark(
  gold: readonly GoldCard[],
  predict: (g: GoldCard) => CardFacts
): CardScore[] {
  return gold.map((g) => scoreCard(g, predict(g)));
}
