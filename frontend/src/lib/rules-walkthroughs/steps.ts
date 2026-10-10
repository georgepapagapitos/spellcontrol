import type {
  PlayerId,
  StackItem,
  StepPatch,
  Walkthrough,
  WalkthroughState,
  WalkthroughStep,
} from './types';

const EMPTY: WalkthroughState = {
  stack: [],
  pending: [],
  priority: null,
  passes: 0,
  battlefield: {},
};

/**
 * Expand authored patches into full steps: each step starts from the state
 * after the previous one, so an author writes only what changed.
 */
export function buildSteps(patches: StepPatch[]): WalkthroughStep[] {
  const out: WalkthroughStep[] = [];
  let prev: WalkthroughState = EMPTY;
  for (const patch of patches) {
    const step: WalkthroughStep = {
      stack: prev.stack,
      pending: prev.pending,
      priority: prev.priority,
      passes: prev.passes,
      battlefield: prev.battlefield,
      ...patch,
    };
    out.push(step);
    prev = step;
  }
  return out;
}

/** An authoring shorthand: `actor` passes and priority moves to `to`. */
export function pass(
  actor: PlayerId,
  to: PlayerId,
  passes: number,
  why: string,
  cr: string[] = ['117.3d']
): StepPatch {
  return { type: 'pass', actor, priority: to, passes, cr, why };
}

const ids = (items: StackItem[]) => items.map((i) => i.id).join(',');

/**
 * Every way a walkthrough's states disagree with the priority and stack rules
 * (CR 117, 405, 603.3b), as readable problems. Empty means consistent.
 *
 * It checks the state each step claims against the step before it: who may
 * act, what the stack must look like after, how passes count and reset, and
 * APNAP order when triggers go on the stack. It is a check on hand-written
 * data, not a rules engine: it never decides what a card does.
 */
export function checkWalkthrough(w: Walkthrough): string[] {
  const problems: string[] = [];
  const order = w.players.map((p) => p.id);
  const n = order.length;
  const active = order[0];
  const seat = (id: PlayerId) => order.indexOf(id);
  const next = (id: PlayerId) => order[(seat(id) + 1) % n];
  const seen = new Set<string>();

  const known = (id: PlayerId | null | undefined, what: string, at: string) => {
    if (id != null && !order.includes(id))
      problems.push(`${at}: unknown player "${id}" as ${what}`);
  };

  w.steps.forEach((s, i) => {
    const at = `${w.id} step ${i}`;
    const fail = (msg: string) => problems.push(`${at} (${s.type}): ${msg}`);
    if (s.cr.length === 0) fail('cites no rule');
    if (!s.why.trim()) fail('has no explanation');
    known(s.priority, 'priority', at);
    known(s.actor, 'actor', at);
    for (const item of [...s.stack, ...s.pending]) known(item.controller, 'controller', at);
    for (const id of Object.keys(s.battlefield)) known(id, 'battlefield owner', at);

    if (i === 0) {
      if (s.type !== 'start') fail('the first step must be "start"');
      for (const item of [...s.stack, ...s.pending]) seen.add(item.id);
      return;
    }
    const p = w.steps[i - 1];
    const priorityAfter = s.pending.length > 0 ? null : active;

    switch (s.type) {
      case 'start':
        fail('"start" can only be the first step');
        break;

      case 'cast':
      case 'activate': {
        if (s.removes) fail('only a resolution removes other objects');
        if (s.actor !== p.priority) fail(`${s.actor} acted without priority`);
        const added = s.stack.slice(p.stack.length);
        if (ids(s.stack.slice(0, p.stack.length)) !== ids(p.stack) || added.length !== 1) {
          fail('must put exactly one object on top of the existing stack');
          break;
        }
        const [item] = added;
        if (seen.has(item.id)) fail(`reuses the id "${item.id}"`);
        seen.add(item.id);
        if (item.controller !== s.actor) fail('the new object belongs to someone else');
        if (item.kind !== (s.type === 'cast' ? 'spell' : 'ability')) {
          fail(`a ${s.type} must add a ${s.type === 'cast' ? 'spell' : 'ability'}`);
        }
        if (s.passes !== 0) fail('passes must reset to 0 when something is added');
        // 117.3c, unless something triggered on the cast (601.2i, 603.3).
        const expected = s.pending.length > 0 ? null : s.actor;
        if (s.priority !== expected) fail(`priority should be ${expected}`);
        for (const item of s.pending) seen.add(item.id);
        break;
      }

      case 'pass':
        if (s.actor !== p.priority) fail(`${s.actor} passed without priority`);
        if (ids(s.stack) !== ids(p.stack) || ids(s.pending) !== ids(p.pending)) {
          fail('a pass changes nothing on the stack');
        }
        if (s.passes !== p.passes + 1) fail(`passes should be ${p.passes + 1}`);
        if (s.passes > n) fail('more passes in a row than players');
        if (p.priority && s.priority !== next(p.priority)) {
          fail(`priority should go to ${next(p.priority)}`);
        }
        break;

      case 'resolve':
        if (p.passes !== n) fail('resolved before every player passed in a row');
        if (p.stack.length === 0) fail('resolved with an empty stack');
        {
          const removes = new Set(s.removes ?? []);
          const below = p.stack.slice(0, -1);
          if ([...removes].some((id) => !below.some((i) => i.id === id))) {
            fail('removes something that was not on the stack');
          }
          if (ids(s.stack) !== ids(below.filter((i) => !removes.has(i.id)))) {
            fail('only the top object leaves, plus anything it removes');
          }
        }
        if (s.passes !== 0) fail('passes must reset after a resolution');
        if (s.priority !== priorityAfter) fail(`priority should be ${priorityAfter}`);
        for (const item of s.pending) seen.add(item.id);
        break;

      case 'trigger': {
        const moved = s.stack.slice(p.stack.length);
        if (ids(s.stack.slice(0, p.stack.length)) !== ids(p.stack) || moved.length === 0) {
          fail('must put waiting triggers on top of the existing stack');
          break;
        }
        const waiting = new Set(p.pending.map((t) => t.id));
        if (moved.some((t) => !waiting.has(t.id))) fail('put something on that was not waiting');
        const left = p.pending.filter((t) => !moved.some((m) => m.id === t.id));
        if (ids(s.pending) !== ids(left)) fail('the waiting list must lose exactly what moved');
        // 603.3b: APNAP. Seats never go backwards, here or into what is left.
        const seats = moved.map((t) => seat(t.controller));
        if (seats.some((v, k) => k > 0 && v < seats[k - 1])) fail('not in APNAP order');
        const last = Math.max(...seats);
        if (s.pending.some((t) => seat(t.controller) < last)) {
          fail('an earlier player still has a trigger waiting');
        }
        if (s.passes !== 0) fail('passes must reset when something is added');
        if (s.priority !== priorityAfter) fail(`priority should be ${priorityAfter}`);
        break;
      }

      case 'turn':
        if (p.stack.length > 0 || s.stack.length > 0)
          fail('turn-based actions need an empty stack');
        if (s.priority !== null) fail('nobody has priority during a turn-based action');
        if (s.passes !== 0) fail('passes must be 0');
        for (const item of s.pending) seen.add(item.id);
        break;

      case 'step-end':
        if (p.passes !== n) fail('the step ended before every player passed in a row');
        if (p.stack.length > 0 || s.stack.length > 0) fail('the step ended with a non-empty stack');
        if (s.priority !== null || s.passes !== 0) fail('nobody holds priority once a step ends');
        break;
    }
  });
  return problems;
}
