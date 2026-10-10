import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { CastabilityRow } from '@/lib/deck-analysis/castability';
import { chanceProblem } from '@/lib/deck-analysis/chance-cards';
import fixture from '@/lib/mana-sim/__fixtures__/chance-cards.fixture.json';
import { jodah, brago } from '@/lib/mana-sim/__fixtures__/decks';
import { problemSegmentsFor, ProblemSegments } from './add-problem-segments';
import type { AddProblems } from './use-add-castability';

const row = {
  name: '{3}{R}{R}',
  cost: '{3}{R}{R}',
  mv: 5,
  rate: 0.86,
  bar: 0.94,
  short: { symbol: 'R', share: 0.14 },
  commander: false,
} as CastabilityRow;

const none: AddProblems = { cast: new Map(), chance: new Map() };
const text = (problems: AddProblems, name: string) =>
  renderToStaticMarkup(<ProblemSegments segments={problemSegmentsFor(name, problems)} />).replace(
    /<[^>]+>/g,
    ''
  );

describe('problemSegmentsFor', () => {
  it('is empty for a card with nothing wrong, so its row stays quiet', () => {
    expect(problemSegmentsFor('Sol Ring', none)).toEqual([]);
  });

  it('reads a castability miss', () => {
    expect(text({ ...none, cast: new Map([['Glorybringer', row]]) }, 'Glorybringer')).toBe(
      ' · ▾ Short on red in 14%'
    );
  });

  it('reads a chance card against the deck, in the same style', () => {
    const agent = (fixture.cards as unknown as ScryfallCard[]).find(
      (c) => c.name === 'Shardless Agent'
    )!;
    const deck = [...jodah().library, ...brago([]).library];
    const manaCreatures = deck.filter(
      (c) => c.cmc <= 3 && /Creature/.test(c.type_line) && c.produced_mana?.length
    );
    const problem = chanceProblem(agent, [...manaCreatures, ...manaCreatures])!;
    const line = text({ ...none, chance: new Map([[agent.name, problem]]) }, agent.name);
    expect(line).toMatch(/^ · ▾ Cascades into a mana creature \d+%$/);
  });

  it('lists both kinds, castability first', () => {
    const chance = new Map([['X', { label: 'a land', p: 0.4, text: 'Finds a land 40%' }]]);
    expect(text({ cast: new Map([['X', row]]), chance }, 'X')).toBe(
      ' · ▾ Short on red in 14% · ▾ Finds a land 40%'
    );
  });
});

describe('cost of the chance half', () => {
  it('prices every candidate in a 100-card deck well inside a frame budget', () => {
    const cards = fixture.cards as unknown as ScryfallCard[];
    const deck = [...jodah().library, ...brago([]).library];
    const start = performance.now();
    for (let i = 0; i < 100; i++) chanceProblem(cards[i % cards.length], deck);
    expect(performance.now() - start).toBeLessThan(250);
  });
});
