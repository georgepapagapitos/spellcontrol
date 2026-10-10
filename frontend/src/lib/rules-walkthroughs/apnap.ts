import { buildSteps, pass } from './steps';
import type { StackItem, Walkthrough } from './types';

const vortex = (id: string, controller: string): StackItem => ({
  id,
  name: 'Sulfuric Vortex',
  kind: 'trigger',
  controller,
  text: 'Deals 2 damage to the player whose upkeep it is.',
});

const arena: StackItem = {
  id: 'arena',
  name: 'Phyrexian Arena',
  kind: 'trigger',
  controller: 'you',
  text: 'You draw a card and lose 1 life.',
};

const yourVortex = vortex('your-vortex', 'you');
const bensVortex = vortex('ben-vortex', 'ben');
const caisVortex = vortex('cai-vortex', 'cai');

/** S9: four triggers from one event, put on the stack in APNAP order. */
export const apnap: Walkthrough = {
  id: 'apnap-order',
  title: 'Triggers in APNAP order',
  summary: 'Several players have triggers at once. The active player stacks theirs first.',
  players: [
    { id: 'you', name: 'You' },
    { id: 'ana', name: 'Ana' },
    { id: 'ben', name: 'Ben' },
    { id: 'cai', name: 'Cai' },
  ],
  setup:
    "A four-player game and it's your turn. You control Sulfuric Vortex and Phyrexian Arena. Ben and Cai each control a Sulfuric Vortex.",
  oracle: {
    'Sulfuric Vortex':
      "At the beginning of each player's upkeep, this enchantment deals 2 damage to that player.\nIf a player would gain life, that player gains no life instead.",
    'Phyrexian Arena': 'At the beginning of your upkeep, you draw a card and lose 1 life.',
  },
  steps: buildSteps([
    {
      type: 'start',
      priority: null,
      battlefield: {
        you: ['Sulfuric Vortex', 'Phyrexian Arena'],
        ben: ['Sulfuric Vortex'],
        cai: ['Sulfuric Vortex'],
      },
      cr: ['502.1'],
      why: 'Your untap step is over. Nobody gets priority during it.',
    },
    {
      type: 'turn',
      pending: [yourVortex, arena, bensVortex, caisVortex],
      cr: ['503.1a', '603.2'],
      why: 'Your upkeep begins and four abilities trigger: two of yours and one each for Ben and Cai.',
    },
    {
      type: 'trigger',
      stack: [arena, yourVortex],
      pending: [bensVortex, caisVortex],
      cr: ['603.3b', '101.4'],
      why: 'You are the active player, so yours go on first, in the order you choose. You put Phyrexian Arena on the bottom.',
    },
    {
      type: 'trigger',
      stack: [arena, yourVortex, bensVortex],
      pending: [caisVortex],
      cr: ['603.3b', '101.4'],
      why: "Ana has nothing waiting, so Ben is next in turn order. Ben's Vortex goes on above yours.",
    },
    {
      type: 'trigger',
      stack: [arena, yourVortex, bensVortex, caisVortex],
      pending: [],
      priority: 'you',
      cr: ['603.3b', '117.5'],
      why: "Cai's goes on last, so it is on top. Now you get priority.",
    },
    pass('you', 'ana', 1, 'You pass.'),
    pass('ana', 'ben', 2, 'Ana passes.'),
    pass('ben', 'cai', 3, 'Ben passes.'),
    pass('cai', 'you', 4, 'Cai passes. All four players passed in a row.', ['117.3d', '117.4']),
    {
      type: 'resolve',
      stack: [arena, yourVortex, bensVortex],
      priority: 'you',
      passes: 0,
      cr: ['405.5', '120.3a', '117.3b'],
      why: "Cai's Vortex resolves first and deals 2 damage to you. Triggers stacked last resolve first, so the active player's resolve last.",
    },
  ]),
};
