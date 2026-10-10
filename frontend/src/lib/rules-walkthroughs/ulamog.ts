import { buildSteps, pass } from './steps';
import type { StackItem, Walkthrough } from './types';

const TWO_PLAYERS = [
  { id: 'you', name: 'You' },
  { id: 'opp', name: 'Opponent' },
];

const ULAMOG = 'Ulamog, the Ceaseless Hunger';

const ORACLE = {
  [ULAMOG]:
    'When you cast this spell, exile two target permanents.\nIndestructible\nWhenever Ulamog attacks, defending player exiles the top twenty cards of their library.',
};

/** Every Ulamog walkthrough follows these. */
const RULINGS = [`${ULAMOG}: 2015-08-25`];

const ulamog: StackItem = {
  id: 'ulamog',
  name: ULAMOG,
  kind: 'spell',
  controller: 'you',
  text: 'Creature spell, 10/10 indestructible.',
};

const castTrigger = (targets: string[]): StackItem => ({
  id: 'cast-trigger',
  name: 'Ulamog',
  kind: 'trigger',
  controller: 'you',
  text: 'Exile two target permanents.',
  targets,
});

/** The trigger before its targets are chosen: they're picked as it goes on the stack. */
const { targets: _unchosen, ...untargeted } = castTrigger([]);

const castSteps = (targets: [string, string]) => [
  {
    type: 'cast' as const,
    actor: 'you',
    stack: [ulamog],
    pending: [untargeted],
    priority: null,
    cr: ['601.2i', '603.2'],
    why: 'You cast Ulamog. The moment it becomes cast, its first ability triggers and waits. Nobody has priority yet.',
  },
  {
    type: 'trigger' as const,
    stack: [ulamog, castTrigger(targets)],
    pending: [],
    priority: 'you',
    cr: ['603.3', '603.3d', '117.5'],
    why: `Before anyone gets priority, the trigger goes on the stack above Ulamog. You choose its targets now: ${targets[0]} and ${targets[1]}.`,
  },
];

/** S5: the cast trigger goes on above the spell and resolves first. */
export const ulamogCast: Walkthrough = {
  id: 'ulamog-cast-trigger',
  title: 'Ulamog: the cast trigger',
  summary: 'A trigger that goes on the stack above the spell that caused it.',
  players: TWO_PLAYERS,
  setup: 'You have ten mana and Ulamog in hand. Your opponent controls Sol Ring and Rhystic Study.',
  oracle: ORACLE,
  rulings: RULINGS,
  steps: buildSteps([
    {
      type: 'start',
      priority: 'you',
      battlefield: { opp: ['Sol Ring', 'Rhystic Study'] },
      cr: ['117.3a'],
      why: 'You have priority in your main phase.',
    },
    ...castSteps(['Sol Ring', 'Rhystic Study']),
    pass('you', 'opp', 1, 'You pass.'),
    pass(
      'opp',
      'you',
      2,
      'Your opponent passes. The trigger is on top, so it resolves before Ulamog.',
      ['117.3d', '117.4']
    ),
    {
      type: 'resolve',
      stack: [ulamog],
      priority: 'you',
      passes: 0,
      battlefield: { opp: [] },
      cr: ['608.2b', '701.13a', '406.3', '117.3b'],
      why: 'The trigger resolves and exiles Sol Ring and Rhystic Study face up. Ulamog is still on the stack.',
    },
    pass('you', 'opp', 1, 'You pass.'),
    pass('opp', 'you', 2, 'Your opponent passes.', ['117.3d', '117.4']),
    {
      type: 'resolve',
      stack: [],
      priority: 'you',
      passes: 0,
      battlefield: { you: [ULAMOG], opp: [] },
      cr: ['608.3a', '117.3b'],
      why: 'Ulamog resolves and enters the battlefield.',
    },
  ]),
};

const counterspell: StackItem = {
  id: 'counterspell',
  name: 'Counterspell',
  kind: 'spell',
  controller: 'opp',
  text: 'Counter target spell.',
  targets: [ULAMOG],
};

/** S6: countering Ulamog doesn't stop the trigger already on the stack. */
export const ulamogCountered: Walkthrough = {
  id: 'ulamog-countered',
  title: 'Ulamog: countered',
  summary: 'Counter the spell and its cast trigger still resolves.',
  players: TWO_PLAYERS,
  setup: 'The same table as the cast trigger, but your opponent holds Counterspell.',
  oracle: ORACLE,
  rulings: RULINGS,
  steps: buildSteps([
    {
      type: 'start',
      priority: 'you',
      battlefield: { opp: ['Sol Ring', 'Rhystic Study'] },
      cr: ['117.3a'],
      why: 'You have priority in your main phase.',
    },
    ...castSteps(['Sol Ring', 'Rhystic Study']),
    pass('you', 'opp', 1, 'You pass.'),
    {
      type: 'cast',
      actor: 'opp',
      stack: [ulamog, castTrigger(['Sol Ring', 'Rhystic Study']), counterspell],
      priority: 'opp',
      passes: 0,
      cr: ['601.2c', '117.3c'],
      why: "Your opponent casts Counterspell on Ulamog. The trigger can't be its target: Counterspell counters spells, and the trigger is an ability.",
    },
    pass('opp', 'you', 1, 'Your opponent passes.'),
    pass('you', 'opp', 2, 'You pass.', ['117.3d', '117.4']),
    {
      type: 'resolve',
      removes: ['ulamog'],
      stack: [castTrigger(['Sol Ring', 'Rhystic Study'])],
      priority: 'you',
      passes: 0,
      cr: ['701.6a', '113.7a', '117.3b'],
      why: 'Counterspell resolves and Ulamog goes to your graveyard. The trigger stays: once an ability triggers, it no longer depends on its source.',
    },
    pass('you', 'opp', 1, 'You pass.'),
    pass('opp', 'you', 2, 'Your opponent passes.', ['117.3d', '117.4']),
    {
      type: 'resolve',
      stack: [],
      priority: 'you',
      passes: 0,
      battlefield: { opp: [] },
      cr: ['608.2b', '701.13a', '117.3b'],
      why: 'The trigger resolves and exiles Sol Ring and Rhystic Study, even though Ulamog never reached the battlefield.',
    },
  ]),
};

const elder: StackItem = {
  id: 'elder',
  name: 'Sakura-Tribe Elder',
  kind: 'ability',
  controller: 'opp',
  text: 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
};

/** S7: one target becomes illegal; the trigger still exiles the other. */
export const ulamogIllegalTarget: Walkthrough = {
  id: 'ulamog-illegal-target',
  title: 'Ulamog: a target disappears',
  summary: 'One of two targets leaves in response. The other is still exiled.',
  players: TWO_PLAYERS,
  setup: 'Your opponent controls Sol Ring and Sakura-Tribe Elder.',
  oracle: {
    ...ORACLE,
    'Sakura-Tribe Elder':
      'Sacrifice this creature: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
  },
  rulings: RULINGS,
  steps: buildSteps([
    {
      type: 'start',
      priority: 'you',
      battlefield: { opp: ['Sol Ring', 'Sakura-Tribe Elder'] },
      cr: ['117.3a'],
      why: 'You have priority in your main phase.',
    },
    ...castSteps(['Sol Ring', 'Sakura-Tribe Elder']),
    pass('you', 'opp', 1, 'You pass.'),
    {
      type: 'activate',
      actor: 'opp',
      stack: [ulamog, castTrigger(['Sol Ring', 'Sakura-Tribe Elder']), elder],
      priority: 'opp',
      passes: 0,
      battlefield: { opp: ['Sol Ring'] },
      cr: ['602.2', '117.3c'],
      why: 'Your opponent sacrifices Sakura-Tribe Elder to activate its ability. The sacrifice is the cost, so the Elder is gone before the ability resolves.',
    },
    pass('opp', 'you', 1, 'Your opponent passes.'),
    pass('you', 'opp', 2, 'You pass.', ['117.3d', '117.4']),
    {
      type: 'resolve',
      stack: [ulamog, castTrigger(['Sol Ring', 'Sakura-Tribe Elder'])],
      priority: 'you',
      passes: 0,
      battlefield: { opp: ['Sol Ring', 'Forest, tapped'] },
      cr: ['608.2', '117.3b'],
      why: "The Elder's ability resolves and a Forest enters tapped under your opponent's control.",
    },
    pass('you', 'opp', 1, 'You pass.'),
    pass('opp', 'you', 2, 'Your opponent passes.', ['117.3d', '117.4']),
    {
      type: 'resolve',
      stack: [ulamog],
      priority: 'you',
      passes: 0,
      battlefield: { opp: ['Forest, tapped'] },
      cr: ['608.2b', '701.13a', '117.3b'],
      why: 'The trigger checks its targets as it resolves. The Elder left the battlefield, so it is an illegal target, but Sol Ring is legal and is exiled. Had both targets gone, the trigger would not resolve at all.',
    },
    pass('you', 'opp', 1, 'You pass.'),
    pass('opp', 'you', 2, 'Your opponent passes.', ['117.3d', '117.4']),
    {
      type: 'resolve',
      stack: [],
      priority: 'you',
      passes: 0,
      battlefield: { you: [ULAMOG], opp: ['Forest, tapped'] },
      cr: ['608.3a', '117.3b'],
      why: 'Ulamog resolves and enters the battlefield.',
    },
  ]),
};

const attackTrigger: StackItem = {
  id: 'attack-trigger',
  name: 'Ulamog',
  kind: 'trigger',
  controller: 'you',
  text: 'Defending player exiles the top twenty cards of their library.',
};

const swords: StackItem = {
  id: 'swords',
  name: 'Swords to Plowshares',
  kind: 'spell',
  controller: 'opp',
  text: 'Exile target creature. Its controller gains life equal to its power.',
  targets: [ULAMOG],
};

/** S8: the attack trigger, removing Ulamog in response, and a short library. */
export const ulamogAttacks: Walkthrough = {
  id: 'ulamog-attacks',
  title: 'Ulamog: the attack trigger',
  summary: 'Remove the attacker in response and the trigger still resolves.',
  players: TWO_PLAYERS,
  setup:
    'Ulamog has been on your battlefield since your last turn. Your opponent has 14 cards left in their library and Swords to Plowshares in hand.',
  oracle: {
    ...ORACLE,
    'Swords to Plowshares': 'Exile target creature. Its controller gains life equal to its power.',
  },
  rulings: RULINGS,
  steps: buildSteps([
    {
      type: 'start',
      priority: null,
      battlefield: { you: [ULAMOG] },
      cr: ['508.1'],
      why: 'Your declare attackers step begins.',
    },
    {
      type: 'turn',
      pending: [attackTrigger],
      battlefield: { you: [`${ULAMOG}, attacking`] },
      cr: ['508.1', '508.1a', '508.3a'],
      why: "You declare Ulamog as an attacker, attacking your opponent. Declaring attackers doesn't use the stack, and it triggers Ulamog's attack ability.",
    },
    {
      type: 'trigger',
      stack: [attackTrigger],
      pending: [],
      priority: 'you',
      cr: ['508.2', '603.3', '117.5'],
      why: 'The trigger goes on the stack before anyone gets priority. Then you get priority as the active player.',
    },
    pass('you', 'opp', 1, 'You pass.'),
    {
      type: 'cast',
      actor: 'opp',
      stack: [attackTrigger, swords],
      priority: 'opp',
      passes: 0,
      cr: ['601.2c', '117.3c'],
      why: "Your opponent casts Swords to Plowshares on Ulamog. Indestructible doesn't help, because exile isn't destruction.",
    },
    pass('opp', 'you', 1, 'Your opponent passes.'),
    pass('you', 'opp', 2, 'You pass.', ['117.3d', '117.4']),
    {
      type: 'resolve',
      stack: [attackTrigger],
      priority: 'you',
      passes: 0,
      battlefield: { you: [] },
      cr: ['608.2', '506.4', '117.3b'],
      why: 'Swords to Plowshares resolves. Ulamog is exiled, which removes it from combat, and you gain 10 life.',
    },
    pass('you', 'opp', 1, 'You pass.'),
    pass('opp', 'you', 2, 'Your opponent passes.', ['117.3d', '117.4']),
    {
      type: 'resolve',
      stack: [],
      priority: 'you',
      passes: 0,
      cr: ['113.7a', '406.3', '704.5b'],
      why: "The trigger resolves anyway. With 14 cards left, your opponent exiles all 14 face up. They don't lose until they would draw from the empty library.",
    },
  ]),
};
