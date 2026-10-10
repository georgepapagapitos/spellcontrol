import { buildSteps, pass } from './steps';
import type { StackItem, Walkthrough } from './types';

const TWO_PLAYERS = [
  { id: 'you', name: 'You' },
  { id: 'opp', name: 'Opponent' },
];

const divination: StackItem = {
  id: 'divination',
  name: 'Divination',
  kind: 'spell',
  controller: 'you',
  text: 'Draw two cards.',
};

/** S1: cast, pass, resolve, then pass on an empty stack to end the phase. */
export const basicLoop: Walkthrough = {
  id: 'cast-and-resolve',
  title: 'Cast a spell and let it resolve',
  summary: 'Who gets priority after each action, and when the phase ends.',
  players: TWO_PLAYERS,
  setup: "It's your main phase. You have Divination in hand and the mana to cast it.",
  steps: buildSteps([
    {
      type: 'start',
      priority: 'you',
      cr: ['117.3a'],
      why: 'Your main phase begins with an empty stack, and you get priority.',
    },
    {
      type: 'cast',
      actor: 'you',
      stack: [divination],
      cr: ['601.2', '405.2', '117.3c'],
      why: 'You cast Divination. It goes on the stack, and you keep priority because you cast it.',
    },
    pass('you', 'opp', 1, 'You pass. Priority goes to the next player in turn order.'),
    pass(
      'opp',
      'you',
      2,
      'Your opponent passes too. Every player has now passed in a row with Divination on top.',
      ['117.3d', '117.4']
    ),
    {
      type: 'resolve',
      stack: [],
      priority: 'you',
      passes: 0,
      cr: ['405.5', '608.2', '117.3b'],
      why: 'Divination resolves and you draw two cards. After anything resolves, the active player gets priority.',
    },
    pass('you', 'opp', 1, 'You pass with nothing on the stack.'),
    pass('opp', 'you', 2, 'Your opponent passes too.', ['117.3d', '117.4']),
    {
      type: 'step-end',
      priority: null,
      passes: 0,
      cr: ['117.4', '500.2'],
      why: 'Every player passed in a row on an empty stack, so the main phase ends. An empty stack alone never ends it: everyone has to pass first.',
    },
  ]),
};

const bolt: StackItem = {
  id: 'bolt',
  name: 'Lightning Bolt',
  kind: 'spell',
  controller: 'you',
  text: 'Lightning Bolt deals 3 damage to any target.',
  targets: ['Opponent'],
};

const shock: StackItem = {
  id: 'shock',
  name: 'Shock',
  kind: 'spell',
  controller: 'you',
  text: 'Shock deals 2 damage to any target.',
  targets: ['Opponent'],
};

/** S2: cast a second spell while holding priority; the last one cast resolves first. */
export const holdPriority: Walkthrough = {
  id: 'hold-priority',
  title: 'Hold priority',
  summary: 'Cast two spells before anyone else can act. The second resolves first.',
  players: TWO_PLAYERS,
  setup: "It's your main phase and your opponent is at 20 life. You hold Lightning Bolt and Shock.",
  steps: buildSteps([
    {
      type: 'start',
      priority: 'you',
      cr: ['117.3a'],
      why: 'You have priority with an empty stack.',
    },
    {
      type: 'cast',
      actor: 'you',
      stack: [bolt],
      cr: ['601.2c', '117.3c'],
      why: 'You cast Lightning Bolt at your opponent and keep priority.',
    },
    {
      type: 'cast',
      actor: 'you',
      stack: [bolt, shock],
      cr: ['405.2', '117.3c'],
      why: 'Instead of passing, you cast Shock. It goes on top of Lightning Bolt before your opponent has had priority at all.',
    },
    pass(
      'you',
      'opp',
      1,
      'You pass. Your opponent gets priority for the first time, with both spells already on the stack.'
    ),
    pass(
      'opp',
      'you',
      2,
      'Your opponent passes. The top of the stack resolves, and that is Shock.',
      ['117.3d', '117.4']
    ),
    {
      type: 'resolve',
      stack: [bolt],
      priority: 'you',
      passes: 0,
      cr: ['405.5', '120.3a', '117.3b'],
      why: 'Shock resolves and your opponent goes to 18 life. Lightning Bolt is still waiting, and you get priority again.',
    },
    pass('you', 'opp', 1, 'You pass.'),
    pass('opp', 'you', 2, 'Your opponent passes.', ['117.3d', '117.4']),
    {
      type: 'resolve',
      stack: [],
      priority: 'you',
      passes: 0,
      cr: ['405.5', '120.3a', '117.3b'],
      why: 'Lightning Bolt resolves and your opponent goes to 15. Last in, first out.',
    },
  ]),
};

const boltBears: StackItem = { ...bolt, id: 'bolt-bears', targets: ['Grizzly Bears'] };

const giantGrowth: StackItem = {
  id: 'giant-growth',
  name: 'Giant Growth',
  kind: 'spell',
  controller: 'opp',
  text: 'Target creature gets +3/+3 until end of turn.',
  targets: ['Grizzly Bears'],
};

/** S3 and S12: a response resolves first, and casting it resets the pass count. */
export const respond: Walkthrough = {
  id: 'respond-to-a-spell',
  title: 'Respond to a spell',
  summary: 'Your opponent answers your spell with one of their own.',
  players: TWO_PLAYERS,
  setup: 'Your opponent controls Grizzly Bears, a 2/2, and holds Giant Growth.',
  steps: buildSteps([
    {
      type: 'start',
      priority: 'you',
      battlefield: { opp: ['Grizzly Bears, 2/2'] },
      cr: ['117.3a'],
      why: 'You have priority in your main phase.',
    },
    {
      type: 'cast',
      actor: 'you',
      stack: [boltBears],
      cr: ['601.2c', '117.3c'],
      why: 'You cast Lightning Bolt at Grizzly Bears.',
    },
    pass(
      'you',
      'opp',
      1,
      'You pass, and your opponent gets priority with your spell on the stack.'
    ),
    {
      type: 'cast',
      actor: 'opp',
      stack: [boltBears, giantGrowth],
      priority: 'opp',
      passes: 0,
      cr: ['405.2', '117.3c'],
      why: 'Your opponent responds with Giant Growth on Grizzly Bears. It goes on top of your spell, and the pass count starts over.',
    },
    pass(
      'opp',
      'you',
      1,
      'Your opponent passes back to you. That is one pass, because casting Giant Growth reset the count.'
    ),
    pass(
      'you',
      'opp',
      2,
      'You pass too. Both players passed in a row, so the top object resolves.',
      ['117.3d', '117.4']
    ),
    {
      type: 'resolve',
      stack: [boltBears],
      priority: 'you',
      passes: 0,
      battlefield: { opp: ['Grizzly Bears, 5/5'] },
      cr: ['405.5', '608.2', '117.3b'],
      why: 'Giant Growth resolves first, so Grizzly Bears is a 5/5 until end of turn. You get priority as the active player.',
    },
    pass('you', 'opp', 1, 'You pass.'),
    pass('opp', 'you', 2, 'Your opponent passes.', ['117.3d', '117.4']),
    {
      type: 'resolve',
      stack: [],
      priority: 'you',
      passes: 0,
      battlefield: { opp: ['Grizzly Bears, 5/5 with 3 damage'] },
      cr: ['608.2b', '120.3e', '704.5g'],
      why: 'Lightning Bolt resolves and deals 3 damage to Grizzly Bears. A 5/5 survives 3 damage.',
    },
  ]),
};

const visionary: StackItem = {
  id: 'visionary',
  name: 'Elvish Visionary',
  kind: 'spell',
  controller: 'you',
  text: 'Creature spell, 1/1.',
};

const visionaryTrigger: StackItem = {
  id: 'visionary-trigger',
  name: 'Elvish Visionary',
  kind: 'trigger',
  controller: 'you',
  text: 'When this creature enters, draw a card.',
};

/** S4: a creature spell, its entering, and its enters trigger. */
export const creatureEnters: Walkthrough = {
  id: 'creature-enters',
  title: 'A creature enters',
  summary: 'A creature is a spell until it resolves. Then its enters ability triggers.',
  players: TWO_PLAYERS,
  setup: "It's your main phase and you cast a creature with an enters ability.",
  oracle: { 'Elvish Visionary': 'When this creature enters, draw a card.' },
  steps: buildSteps([
    {
      type: 'start',
      priority: 'you',
      cr: ['117.3a'],
      why: 'You have priority in your main phase.',
    },
    {
      type: 'cast',
      actor: 'you',
      stack: [visionary],
      cr: ['601.2', '117.3c'],
      why: 'You cast Elvish Visionary. Until it resolves it is a creature spell, and players can respond to it like any other spell.',
    },
    pass('you', 'opp', 1, 'You pass.'),
    pass('opp', 'you', 2, 'Your opponent passes without responding.', ['117.3d', '117.4']),
    {
      type: 'resolve',
      stack: [],
      pending: [visionaryTrigger],
      priority: null,
      passes: 0,
      battlefield: { you: ['Elvish Visionary'] },
      cr: ['608.3a', '603.6a', '603.2'],
      why: 'Elvish Visionary resolves and enters the battlefield, with no chance to respond in between. Its enters ability triggers and waits.',
    },
    {
      type: 'trigger',
      stack: [visionaryTrigger],
      pending: [],
      priority: 'you',
      cr: ['117.5', '704.3', '603.3'],
      why: 'Before anyone gets priority, the game checks state-based actions, then puts the trigger on the stack. Then you get priority.',
    },
    pass('you', 'opp', 1, 'You pass.'),
    pass('opp', 'you', 2, 'Your opponent passes.', ['117.3d', '117.4']),
    {
      type: 'resolve',
      stack: [],
      priority: 'you',
      passes: 0,
      cr: ['608.2', '117.3b'],
      why: 'The trigger resolves and you draw a card.',
    },
  ]),
};
