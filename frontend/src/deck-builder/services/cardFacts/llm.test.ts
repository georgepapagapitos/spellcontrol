import { describe, expect, it } from 'vitest';
import { extractCardFacts } from './extract';
import { GOLD } from './gold.fixtures';
import { HOLDOUT } from './gold.holdout.fixtures';
import {
  PROMPT_VERSION,
  REVIEW_SCHEMA,
  SYSTEM_PROMPT,
  buildUserMessage,
  draftOf,
  isReview,
  mergeReview,
  type Review,
} from './llm';
import { RESOURCE_AXIS, countsAsRole, type CardFacts } from './schema';

const gold = (name: string) => GOLD.find((g) => g.card.name === name)!;
const factsOf = (name: string): CardFacts => {
  const g = gold(name);
  return extractCardFacts(g.card, g.tags);
};

/** Structured outputs require every object to be closed and fully required. */
function assertStrict(schema: unknown, path = '$'): void {
  if (!schema || typeof schema !== 'object') return;
  const s = schema as Record<string, unknown>;
  if (s.type === 'object') {
    expect(s.additionalProperties, `${path} additionalProperties`).toBe(false);
    expect([...(s.required as string[])].sort(), `${path} required`).toEqual(
      Object.keys(s.properties as object).sort()
    );
  }
  for (const [k, v] of Object.entries(s)) {
    if (Array.isArray(v)) v.forEach((x, i) => assertStrict(x, `${path}.${k}[${i}]`));
    else assertStrict(v, `${path}.${k}`);
  }
}

describe('review schema and prompt', () => {
  it('is strict everywhere', () => {
    assertStrict(REVIEW_SCHEMA);
  });

  it('accepts the parser draft of every fixture card, so "keep it" is always valid', () => {
    for (const g of [...GOLD, ...HOLDOUT]) {
      const draft = draftOf(extractCardFacts(g.card, g.tags));
      expect(isReview(draft), g.card.name).toBe(true);
    }
  });

  it('rejects an answer outside the vocabulary', () => {
    const ok: Review = { roles: [], interaction: [], produces: ['mana'], payoffs: ['attack'] };
    expect(isReview(ok)).toBe(true);
    expect(isReview({ ...ok, produces: ['attack'] })).toBe(false); // payoff-only
    expect(isReview({ ...ok, payoffs: ['copy'] })).toBe(false); // produce-only
    expect(
      isReview({
        ...ok,
        roles: [
          {
            role: 'wincon',
            tier: 'primary',
            sub: null,
            speed: 'static',
            repeat: 'static',
            face: 0,
          },
        ],
      })
    ).toBe(false);
    expect(isReview(null)).toBe(false);
    expect(isReview({ roles: [] })).toBe(false);
  });

  it('versions the prompt and keeps it free of anything that varies per call', () => {
    expect(PROMPT_VERSION).toMatch(/^review-v\d+$/);
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('shows the model every face and the draft', () => {
    const g = gold('Fire // Ice');
    const msg = buildUserMessage(g.card, extractCardFacts(g.card, g.tags));
    expect(msg).toContain('Face 0: Fire');
    expect(msg).toContain('Face 1: Ice');
    expect(msg).toContain('Parser draft:');
    expect(JSON.parse(msg.split('Parser draft:\n')[1])).toEqual(
      draftOf(extractCardFacts(g.card, g.tags))
    );
  });
});

describe('mergeReview, tiers policy', () => {
  const liliana = factsOf('Liliana, Dreadhorde General');
  const review: Review = {
    roles: [
      {
        role: 'cardDraw',
        tier: 'secondary',
        sub: 'draw',
        speed: 'triggered',
        repeat: 'per-event',
        face: 0,
      },
      {
        role: 'removal',
        tier: 'primary',
        sub: 'edict',
        speed: 'sorcery',
        repeat: 'per-turn',
        face: 0,
      },
      {
        role: 'boardwipe',
        tier: 'primary',
        sub: null,
        speed: 'sorcery',
        repeat: 'per-turn',
        face: 0,
      },
      {
        role: 'finisher',
        tier: 'primary',
        sub: null,
        speed: 'sorcery',
        repeat: 'per-turn',
        face: 0,
      },
    ],
    interaction: [],
    produces: [],
    payoffs: [],
  };
  const merged = mergeReview(liliana, review);
  const role = (r: string) => merged.roles.find((x) => x.role === r)!;

  it('reorders primary and secondary on roles the parser read', () => {
    expect(role('cardDraw')).toMatchObject({
      tier: 'secondary',
      src: ['parser', 'tag', 'llm'],
      conf: 0.75,
    });
    expect(role('removal')).toMatchObject({ tier: 'primary' });
  });

  it('never promotes an incidental role into a slot on its own', () => {
    expect(role('boardwipe').tier).toBe('incidental');
  });

  it('records a role only the review names as incidental', () => {
    expect(role('finisher')).toMatchObject({
      tier: 'incidental',
      src: ['llm'],
      ability: -1,
      conf: 0.5,
    });
    expect(
      merged.roles
        .filter(countsAsRole)
        .map((r) => r.role)
        .sort()
    ).toEqual(['cardDraw', 'removal']);
  });

  it('keeps the parser speed, repeat, interaction and flows, and moves role strengths', () => {
    expect(role('removal')).toMatchObject({
      speed: 'sorcery',
      repeat: 'per-turn',
      limits: liliana.roles.find((r) => r.role === 'removal')!.limits,
    });
    expect(merged.interaction).toEqual(liliana.interaction);
    expect(merged.produces).toEqual(liliana.produces);
    expect(merged.strengths.removal).toBe(1);
    expect(merged.strengths.cardDraw).toBe(0.6);
    expect(merged.abilities).toBe(liliana.abilities);
  });
});

describe('mergeReview, replace policy', () => {
  const tithe = factsOf('Smothering Tithe');
  const review: Review = {
    roles: [
      {
        role: 'cardDraw',
        tier: 'secondary',
        sub: null,
        speed: 'triggered',
        repeat: 'per-event',
        face: 0,
      },
    ],
    interaction: [{ mode: 'destroy', hits: ['creature'], scope: 'single', side: 'any', face: 0 }],
    produces: ['cards'],
    payoffs: [],
  };
  const merged = mergeReview(tithe, review, 'replace');

  it('replaces roles but keeps a dropped parser role as incidental', () => {
    expect(merged.roles.find((r) => r.role === 'cardDraw')).toMatchObject({
      tier: 'secondary',
      src: ['llm'],
    });
    expect(merged.roles.find((r) => r.role === 'ramp')).toMatchObject({ tier: 'incidental' });
  });

  it('replaces interaction and extended flows, keeping axis flows', () => {
    expect(merged.interaction).toEqual([
      expect.objectContaining({ mode: 'destroy', src: ['llm'], ability: -1 }),
    ]);
    const extended = merged.produces.filter((f) => RESOURCE_AXIS[f.r] === null).map((f) => f.r);
    expect(extended).toEqual(['cards']);
    const axis = (f: CardFacts) => f.produces.filter((x) => RESOURCE_AXIS[x.r] !== null);
    expect(axis(merged)).toEqual(axis(tithe));
  });

  it('marks agreement with both provenances', () => {
    const agreed = mergeReview(tithe, { ...draftOf(tithe) }, 'replace');
    expect(agreed.roles.find((r) => r.role === 'ramp')).toMatchObject({
      src: ['parser', 'llm'],
      conf: 0.95,
    });
    expect(agreed.produces.find((f) => f.r === 'treasure')).toMatchObject({
      src: ['parser', 'llm'],
    });
  });
});
