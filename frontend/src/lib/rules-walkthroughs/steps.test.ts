import { describe, expect, it } from 'vitest';
import { buildSteps, checkWalkthrough, pass } from './steps';
import type { StackItem, StepPatch, Walkthrough } from './types';

const spell = (id: string, controller = 'a'): StackItem => ({
  id,
  name: id,
  kind: 'spell',
  controller,
});
const trig = (id: string, controller: string): StackItem => ({
  id,
  name: id,
  kind: 'trigger',
  controller,
});

const START: StepPatch = { type: 'start', priority: 'a', cr: ['117.3a'], why: 'Start.' };

function problems(patches: StepPatch[], players = ['a', 'b']): string[] {
  const w: Walkthrough = {
    id: 't',
    title: 'T',
    summary: '',
    setup: '',
    players: players.map((id) => ({ id, name: id })),
    steps: buildSteps(patches),
  };
  return checkWalkthrough(w);
}

const cast = (stack: StackItem[], actor = 'a'): StepPatch => ({
  type: 'cast',
  actor,
  stack,
  priority: actor,
  passes: 0,
  cr: ['117.3c'],
  why: 'Cast.',
});

const resolveTo = (stack: StackItem[], extra: Partial<StepPatch> = {}): StepPatch => ({
  type: 'resolve',
  stack,
  priority: 'a',
  passes: 0,
  cr: ['608.2'],
  why: 'Resolves.',
  ...extra,
});

describe('buildSteps', () => {
  it('carries state forward and leaves per-event fields behind', () => {
    const steps = buildSteps([
      { ...START, battlefield: { a: ['Forest'] } },
      { ...cast([spell('x')]), removes: undefined },
      pass('a', 'b', 1, 'Pass.'),
    ]);
    expect(steps[2].stack.map((s) => s.id)).toEqual(['x']);
    expect(steps[2].battlefield).toEqual({ a: ['Forest'] });
    expect(steps[2].actor).toBe('a');
  });
});

describe('checkWalkthrough', () => {
  it('accepts a full cast, pass, resolve, step-end loop', () => {
    expect(
      problems([
        START,
        cast([spell('x')]),
        pass('a', 'b', 1, 'Pass.'),
        pass('b', 'a', 2, 'Pass.'),
        resolveTo([]),
        pass('a', 'b', 1, 'Pass.'),
        pass('b', 'a', 2, 'Pass.'),
        { type: 'step-end', priority: null, passes: 0, cr: ['500.2'], why: 'Ends.' },
      ])
    ).toEqual([]);
  });

  it('requires a start step, once, with a rule and an explanation on every step', () => {
    expect(problems([{ ...cast([spell('x')]) }])).toContainEqual(
      expect.stringContaining('the first step must be "start"')
    );
    expect(problems([START, { ...START }])).toContainEqual(
      expect.stringContaining('can only be the first step')
    );
    expect(problems([{ ...START, cr: [], why: ' ' }])).toEqual([
      't step 0 (start): cites no rule',
      't step 0 (start): has no explanation',
    ]);
  });

  it('flags unknown players', () => {
    expect(problems([{ ...START, priority: 'z', battlefield: { q: [] } }])).toEqual([
      't step 0: unknown player "z" as priority',
      't step 0: unknown player "q" as battlefield owner',
    ]);
  });

  it('catches a cast without priority, a reused id, and a cast that keeps the pass count', () => {
    const out = problems([
      START,
      cast([spell('x')]),
      pass('a', 'b', 1, 'Pass.'),
      { ...cast([spell('x'), spell('x', 'a')], 'a'), priority: 'a', passes: 1 },
    ]);
    expect(out).toEqual(
      expect.arrayContaining([
        expect.stringContaining('a acted without priority'),
        expect.stringContaining('reuses the id "x"'),
        expect.stringContaining('passes must reset to 0'),
      ])
    );
  });

  it('catches a cast that rewrites the stack, or adds the wrong kind or owner', () => {
    expect(problems([START, cast([spell('x'), spell('y')])])).toContainEqual(
      expect.stringContaining('exactly one object')
    );
    expect(problems([START, { ...cast([{ ...spell('x', 'b'), kind: 'ability' }]) }])).toEqual(
      expect.arrayContaining([
        expect.stringContaining('belongs to someone else'),
        expect.stringContaining('a cast must add a spell'),
      ])
    );
  });

  it('wants priority held back while a cast trigger waits', () => {
    const withTrigger: StepPatch = {
      ...cast([spell('x')]),
      pending: [trig('t', 'a')],
    };
    expect(problems([START, withTrigger])).toContainEqual(
      expect.stringContaining('priority should be null')
    );
  });

  it('catches a pass that moves priority wrong or changes the stack', () => {
    expect(problems([START, pass('a', 'a', 1, 'Pass.')])).toContainEqual(
      expect.stringContaining('priority should go to b')
    );
    expect(problems([START, { ...pass('a', 'b', 2, 'Pass.'), stack: [spell('x')] }])).toEqual(
      expect.arrayContaining([
        expect.stringContaining('changes nothing on the stack'),
        expect.stringContaining('passes should be 1'),
      ])
    );
    expect(
      problems([START, pass('a', 'b', 1, 'P.'), pass('b', 'a', 2, 'P.'), pass('a', 'b', 3, 'P.')])
    ).toContainEqual(expect.stringContaining('more passes in a row than players'));
  });

  it('catches a resolution before everyone passed, or of more than the top', () => {
    const out = problems([START, cast([spell('x')]), pass('a', 'b', 1, 'P.'), resolveTo([])]);
    expect(out).toContainEqual(expect.stringContaining('before every player passed'));
    expect(
      problems([START, pass('a', 'b', 1, 'P.'), pass('b', 'a', 2, 'P.'), resolveTo([])])
    ).toContainEqual(expect.stringContaining('resolved with an empty stack'));
    const two = [spell('x'), spell('y')];
    expect(
      problems([
        START,
        cast([two[0]]),
        cast(two),
        pass('a', 'b', 1, 'P.'),
        pass('b', 'a', 2, 'P.'),
        resolveTo([two[1]]),
      ])
    ).toContainEqual(expect.stringContaining('only the top object leaves'));
  });

  it('lets a resolution remove a named object below it, and nothing it did not name', () => {
    const two = [spell('x'), spell('y', 'b')];
    const lead: StepPatch[] = [
      START,
      cast([two[0]]),
      pass('a', 'b', 1, 'P.'),
      cast(two, 'b'),
      pass('b', 'a', 1, 'P.'),
      pass('a', 'b', 2, 'P.'),
    ];
    expect(problems([...lead, resolveTo([], { removes: ['x'] })])).toEqual([]);
    expect(problems([...lead, resolveTo([], { removes: ['q'] })])).toContainEqual(
      expect.stringContaining('removes something that was not on the stack')
    );
    expect(problems([START, { ...cast([spell('x')]), removes: ['x'] }])).toContainEqual(
      expect.stringContaining('only a resolution removes')
    );
  });

  it('enforces APNAP when triggers go on the stack', () => {
    const players = ['a', 'b', 'c'];
    const turn: StepPatch = {
      type: 'turn',
      priority: null,
      pending: [trig('ta', 'a'), trig('tb', 'b'), trig('tc', 'c')],
      cr: ['503.1a'],
      why: 'Upkeep.',
    };
    const put = (stack: StackItem[], pending: StackItem[], priority: string | null): StepPatch => ({
      type: 'trigger',
      stack,
      pending,
      priority,
      cr: ['603.3b'],
      why: 'Stack.',
    });
    const [ta, tb, tc] = [trig('ta', 'a'), trig('tb', 'b'), trig('tc', 'c')];
    expect(
      problems([{ ...START, priority: null }, turn, put([ta, tb, tc], [], 'a')], players)
    ).toEqual([]);
    expect(
      problems([{ ...START, priority: null }, turn, put([tb, ta, tc], [], 'a')], players)
    ).toContainEqual(expect.stringContaining('not in APNAP order'));
    expect(
      problems([{ ...START, priority: null }, turn, put([tb], [ta, tc], null)], players)
    ).toEqual([expect.stringContaining('an earlier player still has a trigger waiting')]);
    expect(problems([{ ...START, priority: null }, turn, put([ta], [tc], null)], players)).toEqual([
      expect.stringContaining('the waiting list must lose exactly what moved'),
    ]);
    expect(
      problems(
        [{ ...START, priority: null }, turn, put([trig('zz', 'a')], [tb, tc], null)],
        players
      )
    ).toContainEqual(expect.stringContaining('put something on that was not waiting'));
    expect(
      problems([{ ...START, priority: null }, turn, put([], [ta, tb, tc], null)], players)
    ).toContainEqual(expect.stringContaining('must put waiting triggers on top'));
  });

  it('keeps turn-based actions and step ends off a live stack', () => {
    const turn: StepPatch = {
      type: 'turn',
      priority: 'a',
      passes: 1,
      cr: ['508.1'],
      why: 'Attack.',
    };
    expect(problems([START, cast([spell('x')]), turn])).toEqual(
      expect.arrayContaining([
        expect.stringContaining('need an empty stack'),
        expect.stringContaining('nobody has priority during a turn-based action'),
        expect.stringContaining('passes must be 0'),
      ])
    );
    const end: StepPatch = {
      type: 'step-end',
      priority: 'a',
      passes: 0,
      cr: ['500.2'],
      why: 'End.',
    };
    expect(problems([START, cast([spell('x')]), end])).toEqual(
      expect.arrayContaining([
        expect.stringContaining('before every player passed'),
        expect.stringContaining('non-empty stack'),
        expect.stringContaining('nobody holds priority once a step ends'),
      ])
    );
  });
});
