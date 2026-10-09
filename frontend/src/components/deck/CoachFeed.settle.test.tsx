// @vitest-environment happy-dom
//
// The feed's first paint (E627): it holds its skeleton until the analysis is ready
// AND the combos are checked (for at most the pairing budget), then rows; a source
// that lands later adds rows after the painted ones and never moves one.
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachFeed, type CoachFeedProps } from './CoachFeed';
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { CostPlan } from '@/deck-builder/services/deckBuilder/costAnalyzer';
import type { ComboMatch } from '@/types/combos';

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('./useCardCarousel', () => ({
  useCardCarousel: () => ({ open: vi.fn(), preview: null }),
}));
vi.mock('./use-deck-hover-peek', () => ({
  useDeckHoverPeek: () => ({ listHandlers: {}, peek: null }),
}));

const gap = {
  name: 'Cultivate',
  role: 'ramp',
  roleLabel: 'Ramp',
  inclusion: 64,
} as GapAnalysisCard;
const costPlan = {
  spellRows: [
    {
      id: 'Smothering Tithe',
      currentName: 'Smothering Tithe',
      currentPrice: 24,
      currentInclusion: 41,
      currentCmc: 4,
      suggestionName: 'Esper Sentinel',
      suggestionPrice: 8,
      suggestionInclusion: 38,
      suggestionCmc: 1,
      savings: 16,
      confidence: 'drop-in',
      category: 'spell',
    },
  ],
  landRows: [],
} as unknown as CostPlan;

const combo = (id: string, missing: string): ComboMatch => ({
  combo: {
    id,
    identity: 'W',
    produces: ['infinite damage'],
    prerequisites: null,
    description: null,
    manaNeeded: null,
    popularity: 100,
    cardCount: 2,
    bracket: 4,
    cards: [
      { oracleId: `${id}-a`, cardName: 'Walking Ballista', quantity: 1 },
      { oracleId: `${id}-b`, cardName: missing, quantity: 1 },
    ],
  },
  presentOracleIds: [`${id}-a`],
  missingOracleIds: [`${id}-b`],
});
const heliod = combo('combo-1', 'Heliod, Sun-Crowned');

function makeProps(over: Partial<CoachFeedProps> = {}): CoachFeedProps {
  return {
    gaps: [gap],
    optimize: undefined,
    synergy: [],
    substitutes: [],
    costPlan,
    bracketFit: undefined,
    oneAwayCombos: [],
    planScore: undefined,
    roleCounts: {},
    roleTargets: {},
    deckSize: 99,
    deckTarget: 99,
    bracketOverridePresent: false,
    resolveOwnership: () => undefined,
    ownedNames: new Set(),
    deckNames: new Set(['smothering tithe']),
    onApplyMove: vi.fn(),
    onApplyAllDropIns: vi.fn(),
    onConvergeBracket: vi.fn(),
    ownedOnly: false,
    onOwnedOnlyChange: vi.fn(),
    ...over,
  };
}

const rowNames = (container: HTMLElement) =>
  [...container.querySelectorAll('.coach-feed-rows > li .deck-card-row-name')].map(
    (n) => n.textContent
  );
const skeleton = () => screen.queryByRole('status', { name: /Analyzing your deck/ });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the feed while the combos are checked', () => {
  it('holds the skeleton, then paints the rows once the combos land', () => {
    const { container, rerender } = render(<CoachFeed {...makeProps({ combosLoading: true })} />);
    expect(skeleton()).toBeTruthy();
    expect(container.querySelector('.coach-feed-rows')).toBeNull();

    rerender(<CoachFeed {...makeProps({ combosLoading: false, oneAwayCombos: [heliod] })} />);
    expect(skeleton()).toBeNull();
    expect(rowNames(container)).toContain('Heliod, Sun-Crowned');
    expect(rowNames(container)).toContain('Cultivate');
  });

  it('paints what it has once the budget runs out, so a slow check never blanks the feed', () => {
    const { container } = render(<CoachFeed {...makeProps({ combosLoading: true })} />);
    expect(skeleton()).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(4001);
    });
    expect(skeleton()).toBeNull();
    expect(rowNames(container)).toEqual(expect.arrayContaining(['Cultivate', 'Esper Sentinel']));
  });

  it('puts rows from a source that lands late after the painted ones', () => {
    const { container, rerender } = render(<CoachFeed {...makeProps()} />);
    const painted = rowNames(container);
    expect(painted.length).toBeGreaterThan(0);
    expect(painted).not.toContain('Heliod, Sun-Crowned');

    rerender(<CoachFeed {...makeProps({ oneAwayCombos: [heliod] })} />);
    const after = rowNames(container);
    expect(after.slice(0, painted.length)).toEqual(painted);
    expect(after).toContain('Heliod, Sun-Crowned');
  });

  it('keeps the painted order when the budget ran out and the combos land afterwards', () => {
    const { container, rerender } = render(<CoachFeed {...makeProps({ combosLoading: true })} />);
    act(() => {
      vi.advanceTimersByTime(4001);
    });
    const painted = rowNames(container);
    rerender(<CoachFeed {...makeProps({ combosLoading: false, oneAwayCombos: [heliod] })} />);
    const after = rowNames(container);
    expect(after.slice(0, painted.length)).toEqual(painted);
    expect(after).toContain('Heliod, Sun-Crowned');
  });
});
