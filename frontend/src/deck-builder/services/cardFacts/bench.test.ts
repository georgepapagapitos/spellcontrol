import { describe, expect, it } from 'vitest';
import {
  bootstrapCI,
  f1,
  mulberry32,
  parseInteractionLabel,
  parseRoleLabel,
  precision,
  rate,
  recall,
  scoreCard,
  totals,
  type GoldCard,
} from './bench';
import type { CardFacts, InteractionFact, RoleFact } from './schema';

const role = (r: Partial<RoleFact> & Pick<RoleFact, 'role' | 'tier'>): RoleFact => ({
  sub: null,
  ability: 0,
  face: 0,
  speed: 'instant',
  repeat: 'once',
  limits: [],
  conf: 0.8,
  src: ['parser'],
  ...r,
});
const interaction = (
  f: Partial<InteractionFact> & Pick<InteractionFact, 'mode' | 'hits' | 'scope' | 'side'>
): InteractionFact => ({
  ability: 0,
  face: 0,
  speed: 'instant',
  repeat: 'once',
  limits: [],
  conf: 0.8,
  src: ['parser'],
  ...f,
});
const facts = (over: Partial<CardFacts>): CardFacts => ({
  oracleId: 'x',
  name: 'Test Card',
  layout: 'normal',
  types: [],
  keywords: [],
  pt: null,
  mv: null,
  abilities: [],
  roles: [],
  interaction: [],
  produces: [],
  payoffs: [],
  strengths: {},
  ...over,
});
const gold = (expect: GoldCard['expect'], faces = 1): GoldCard => ({
  card: {
    oracle_id: 'x',
    name: 'Test Card',
    card_faces:
      faces > 1 ? Array.from({ length: faces }, (_, i) => ({ name: `Face ${i}` })) : undefined,
  },
  tags: [],
  expect,
});

describe('labels', () => {
  it('parse role and interaction labels', () => {
    expect(parseRoleLabel('P triggered per-event f1')).toEqual({
      tier: 'primary',
      speed: 'triggered',
      repeat: 'per-event',
      face: 1,
    });
    expect(parseRoleLabel('I sorcery once')).toMatchObject({ tier: 'incidental', face: null });
    expect(parseInteractionLabel('destroy creature|planeswalker single any')).toEqual({
      mode: 'destroy',
      hits: 'creature|planeswalker',
      scope: 'single',
      side: 'any',
      face: null,
    });
  });
});

describe('scoreCard', () => {
  it('counts role membership only for slot-filling tiers', () => {
    const s = scoreCard(
      gold({
        roles: { removal: 'P instant once', boardwipe: 'I sorcery once' },
        interaction: [],
        produces: [],
        payoffs: [],
      }),
      facts({
        roles: [
          role({ role: 'removal', tier: 'secondary' }),
          role({ role: 'boardwipe', tier: 'incidental', speed: 'sorcery' }),
          role({ role: 'ramp', tier: 'primary' }),
        ],
      })
    );
    expect(s.roles).toEqual({ tp: 1, fp: 1, fn: 0 });
    // Tier compared on both labeled roles; removal is off by one step.
    expect(s.tier).toEqual({ agree: 1, total: 2 });
    expect(s.errors.map((e) => e.bucket).sort()).toEqual(['over-tagging', 'tier']);
  });

  it('buckets a miss on a back face as a face error, and a missed trigger as one', () => {
    const s = scoreCard(
      gold(
        {
          roles: { boardwipe: 'S triggered once f1', cardDraw: 'P triggered per-event' },
          interaction: [],
          produces: [],
          payoffs: [],
        },
        2
      ),
      facts({})
    );
    expect(s.errors.map((e) => e.bucket).sort()).toEqual(['face', 'missed-trigger']);
  });

  it('matches interaction on mode and scope, preferring equal hits, and grades side as polarity', () => {
    const s = scoreCard(
      gold({
        roles: {},
        interaction: ['destroy creature single any', 'destroy artifact single any'],
        produces: [],
        payoffs: [],
      }),
      facts({
        interaction: [
          interaction({ mode: 'destroy', hits: ['artifact'], scope: 'single', side: 'opponents' }),
          interaction({ mode: 'destroy', hits: ['creature'], scope: 'single', side: 'any' }),
          interaction({ mode: 'exile', hits: ['creature'], scope: 'mass', side: 'all' }),
        ],
      })
    );
    expect(s.interaction).toEqual({ tp: 2, fp: 1, fn: 0 });
    expect(s.hits).toEqual({ agree: 2, total: 2 });
    expect(s.side).toEqual({ agree: 1, total: 2 });
    expect(s.errors.find((e) => e.field === 'side')?.bucket).toBe('polarity');
  });

  it('scores only the extended resources', () => {
    const s = scoreCard(
      gold({
        roles: {},
        interaction: [],
        produces: ['mana', 'creature-token'],
        payoffs: ['attack'],
      }),
      facts({
        produces: [
          { r: 'mana', ability: 0, face: 0, repeat: 'static', conf: 0.8, src: ['parser'] },
        ],
        payoffs: [
          { r: 'cards', ability: 0, face: 0, repeat: 'static', conf: 0.8, src: ['parser'] },
        ],
      })
    );
    expect(s.flows).toEqual({ tp: 1, fp: 1, fn: 1 });
  });
});

describe('aggregation', () => {
  it('computes precision, recall, F1 and agreement, with empty sets at 1', () => {
    expect(precision({ tp: 3, fp: 1, fn: 0 })).toBe(0.75);
    expect(recall({ tp: 3, fp: 0, fn: 1 })).toBe(0.75);
    expect(f1({ tp: 1, fp: 1, fn: 1 })).toBe(0.5);
    expect(f1({ tp: 0, fp: 1, fn: 1 })).toBe(0);
    expect(precision({ tp: 0, fp: 0, fn: 0 })).toBe(1);
    expect(rate({ agree: 0, total: 0 })).toBe(1);
  });

  it('bootstraps a seeded interval around the point estimate', () => {
    const cards = [
      scoreCard(
        gold({ roles: { ramp: 'P instant once' }, interaction: [], produces: [], payoffs: [] }),
        facts({ roles: [role({ role: 'ramp', tier: 'primary' })] })
      ),
      scoreCard(
        gold({ roles: { ramp: 'P instant once' }, interaction: [], produces: [], payoffs: [] }),
        facts({})
      ),
    ];
    const t = totals(cards);
    expect(recall(t.roles)).toBe(0.5);
    const ci = bootstrapCI(cards, (x) => recall(x.roles), 500, 7);
    expect(ci).toEqual(bootstrapCI(cards, (x) => recall(x.roles), 500, 7));
    expect(ci[0]).toBeLessThanOrEqual(0.5);
    expect(ci[1]).toBeGreaterThanOrEqual(0.5);
  });

  it('draws a reproducible uniform stream', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    const xs = Array.from({ length: 5 }, () => a());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});
