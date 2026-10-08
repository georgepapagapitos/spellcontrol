// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachFeed, type CoachFeedProps } from './CoachFeed';
import type { GapAnalysisCard, ScryfallCard } from '@/deck-builder/types';
import type { CostPlan } from '@/deck-builder/services/deckBuilder/costAnalyzer';
import type { ComboMatch } from '@/types/combos';
import {
  resetSuggestionLabelsForTests,
  setSuggestionContext,
  setSuggestionLabelsEnabled,
} from '@/lib/util/suggestion-labels';

const sent = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@/lib/util/analytics', () => ({
  sendBeaconPayload: (p: Record<string, unknown>) => sent.push(p),
  normalizePath: (p: string) => p,
}));
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('./useCardCarousel', () => ({
  useCardCarousel: () => ({ open: vi.fn(), preview: null }),
}));
vi.mock('./use-deck-hover-peek', () => ({
  useDeckHoverPeek: () => ({ listHandlers: {}, peek: null }),
}));

const ATRAXA = '0b0a8d28-1b0f-4d3e-9a3e-5e1a5a7a1f11';

beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  resetSuggestionLabelsForTests();
  setSuggestionContext({
    id: 'deck-secret-1',
    commander: { name: "Atraxa, Praetors' Voice", oracle_id: ATRAXA } as ScryfallCard,
    partnerCommander: null,
  });
});

const gap: GapAnalysisCard = {
  name: 'Cultivate',
  role: 'ramp',
  roleLabel: 'Ramp',
  inclusion: 64,
} as GapAnalysisCard;

const costPlan: CostPlan = {
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

const oneAway: ComboMatch[] = [
  {
    combo: {
      id: 'combo-1',
      identity: 'W',
      produces: ['infinite damage'],
      prerequisites: null,
      description: null,
      manaNeeded: null,
      popularity: 100,
      cardCount: 2,
      bracket: 4,
      cards: [
        { oracleId: 'o1', cardName: 'Walking Ballista', quantity: 1 },
        { oracleId: 'o2', cardName: 'Heliod, Sun-Crowned', quantity: 1 },
      ],
    },
    presentOracleIds: ['o1'],
    missingOracleIds: ['o2'],
  },
];

function makeProps(over: Partial<CoachFeedProps> = {}): CoachFeedProps {
  return {
    gaps: [gap],
    synergy: [],
    substitutes: [],
    costPlan,
    oneAwayCombos: oneAway,
    roleCounts: {},
    roleTargets: {},
    deckSize: 99,
    deckTarget: 99,
    bracketOverridePresent: false,
    resolveOwnership: (name) => (name === 'Heliod, Sun-Crowned' ? 'owned' : undefined),
    ownedNames: new Set(['Heliod, Sun-Crowned']),
    deckNames: new Set(['smothering tithe']),
    onApplyMove: vi.fn(),
    onApplyAllDropIns: vi.fn(),
    onConvergeBracket: vi.fn(),
    ownedOnly: false,
    onOwnedOnlyChange: vi.fn(),
    ...over,
  };
}

describe('CoachFeed suggestion labels', () => {
  it('counts the lane it shows and labels an accepted add with its lane, rank and commander', () => {
    render(<CoachFeed {...makeProps()} />);
    expect(sent).toEqual([expect.objectContaining({ surface: 'coach:all', action: 'shown' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Add Cultivate' }));
    expect(sent[1]).toMatchObject({
      surface: 'coach:all',
      action: 'accept',
      reason: 'fill-gaps',
      cmdr: ATRAXA,
      cardIn: 'Cultivate',
    });
    expect(sent[1].rank).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(sent)).not.toContain('deck-secret-1');
  });

  it('names the lane the player was in', () => {
    render(<CoachFeed {...makeProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Combos/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Add Heliod/ }));
    expect(sent.map((p) => [p.surface, p.action])).toContainEqual(['coach:combos', 'shown']);
    expect(sent[sent.length - 1]).toMatchObject({
      surface: 'coach:combos',
      action: 'accept',
      rank: 1,
      cardIn: 'Heliod, Sun-Crowned',
    });
  });

  it('labels each swap of an "Apply all" with the card in and the card out', () => {
    render(<CoachFeed {...makeProps({ initialFilter: 'budget' })} />);
    fireEvent.click(screen.getByRole('button', { name: /Apply all 1 drop-in/ }));
    expect(sent[sent.length - 1]).toMatchObject({
      surface: 'coach:budget',
      action: 'accept',
      reason: 'budget',
      cardIn: 'Esper Sentinel',
      cardOut: 'Smothering Tithe',
    });
  });

  it('sends nothing when the player opted out', () => {
    setSuggestionLabelsEnabled(false);
    render(<CoachFeed {...makeProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Cultivate' }));
    expect(sent).toEqual([]);
  });
});
