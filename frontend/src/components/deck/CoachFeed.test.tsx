// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CoachFeed, type CoachFeedProps } from './CoachFeed';
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { CostPlan } from '@/deck-builder/services/deckBuilder/costAnalyzer';
import type { ComboMatch } from '@/types/combos';

vi.mock('@/lib/card-thumbs', () => ({
  useCardThumb: () => undefined,
}));
vi.mock('./useCardCarousel', () => ({
  useCardCarousel: () => ({ open: vi.fn(), preview: null }),
}));
vi.mock('./use-deck-hover-peek', () => ({
  useDeckHoverPeek: () => ({ listHandlers: {}, peek: null }),
}));

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
    optimize: undefined,
    synergy: [],
    substitutes: [],
    costPlan,
    bracketFit: undefined,
    oneAwayCombos: oneAway,
    planScore: undefined,
    roleCounts: {},
    roleTargets: {},
    deckSize: 99,
    deckTarget: 99,
    bracketOverridePresent: false,
    resolveOwnership: (name) => (name === 'Heliod, Sun-Crowned' ? 'owned' : undefined),
    ownedNames: new Set(['Heliod, Sun-Crowned']),
    onApplyMove: vi.fn(),
    onApplyAllDropIns: vi.fn(),
    ...over,
  };
}

describe('CoachFeed', () => {
  it('renders rows from every source and the filter chips with counts', () => {
    render(<CoachFeed {...makeProps()} />);
    expect(screen.getByText('Cultivate')).toBeTruthy();
    expect(screen.getByText('Esper Sentinel')).toBeTruthy();
    expect(screen.getByText('Heliod, Sun-Crowned')).toBeTruthy();
    const chips = screen.getByRole('group', { name: 'Filter suggestions' });
    expect(chips.textContent).toContain('Fix gaps');
    expect(chips.textContent).toContain('Budget');
    expect(chips.textContent).toContain('Combos');
  });

  it('filter chip narrows the feed to one lane', () => {
    render(<CoachFeed {...makeProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Combos/ }));
    expect(screen.getByText('Heliod, Sun-Crowned')).toBeTruthy();
    expect(screen.queryByText('Cultivate')).toBeNull();
  });

  it('combo completion row carries the resolved ownership badge', () => {
    render(<CoachFeed {...makeProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Combos/ }));
    // OwnershipBadge renders "Owned" for ownership:'owned'
    expect(screen.getByText('Owned')).toBeTruthy();
  });

  it('initialFilter prop change on a MOUNTED feed activates the chip (NBM preset on the Coach tab)', () => {
    const onFilterHandled = vi.fn();
    const { rerender } = render(<CoachFeed {...makeProps({ onFilterHandled })} />);
    expect(screen.getByText('Cultivate')).toBeTruthy();
    rerender(<CoachFeed {...makeProps({ onFilterHandled, initialFilter: 'budget' })} />);
    expect(screen.queryByText('Cultivate')).toBeNull();
    expect(screen.getByText('Esper Sentinel')).toBeTruthy();
    expect(onFilterHandled).toHaveBeenCalledTimes(1);
  });

  it('the same preset can re-fire after the parent clears the prop', () => {
    const onFilterHandled = vi.fn();
    const { rerender } = render(<CoachFeed {...makeProps({ onFilterHandled })} />);
    rerender(<CoachFeed {...makeProps({ onFilterHandled, initialFilter: 'budget' })} />);
    rerender(<CoachFeed {...makeProps({ onFilterHandled })} />); // parent cleared
    fireEvent.click(screen.getByRole('button', { name: 'All' })); // user wanders off
    rerender(<CoachFeed {...makeProps({ onFilterHandled, initialFilter: 'budget' })} />);
    expect(screen.queryByText('Cultivate')).toBeNull();
    expect(onFilterHandled).toHaveBeenCalledTimes(2);
  });

  it('initialFilter on mount activates the chip (deep-link from another tab)', () => {
    render(<CoachFeed {...makeProps({ initialFilter: 'budget' })} />);
    expect(screen.queryByText('Cultivate')).toBeNull();
    expect(screen.getByText('Esper Sentinel')).toBeTruthy();
  });

  it('budget filter shows the "Apply all drop-ins" action and dispatches the swap list', () => {
    const onApplyAllDropIns = vi.fn();
    render(<CoachFeed {...makeProps({ onApplyAllDropIns, initialFilter: 'budget' })} />);
    const btn = screen.getByRole('button', { name: /Apply all 1 drop-in/ });
    fireEvent.click(btn);
    expect(onApplyAllDropIns).toHaveBeenCalledWith([
      { removeName: 'Smothering Tithe', addName: 'Esper Sentinel' },
    ]);
  });

  it('deduplicates a card suggested by two sources (gap + combo)', () => {
    const dupCombo: ComboMatch[] = [
      {
        ...oneAway[0],
        combo: {
          ...oneAway[0].combo,
          cards: [
            { oracleId: 'o1', cardName: 'Walking Ballista', quantity: 1 },
            { oracleId: 'o3', cardName: 'Cultivate', quantity: 1 },
          ],
        },
        missingOracleIds: ['o3'],
      },
    ];
    render(<CoachFeed {...makeProps({ oneAwayCombos: dupCombo })} />);
    expect(screen.getAllByText('Cultivate')).toHaveLength(1);
  });

  it('cuts render in a collapsed disclosure group, not the main feed', () => {
    const props = makeProps({
      optimize: {
        additions: [],
        removals: [
          { name: 'Bad Card', reason: 'weak fit', inclusion: 2 } as unknown as NonNullable<
            CoachFeedProps['optimize']
          >['removals'][number],
        ],
      } as CoachFeedProps['optimize'],
    });
    render(<CoachFeed {...props} />);
    // The summary's text is split across nodes (icon + "Cuts (" + count) — match
    // on the <summary> element's full textContent.
    const summary = screen.getByText(
      (_, el) => el?.tagName === 'SUMMARY' && /Cuts \(1\)/.test(el.textContent ?? '')
    );
    expect(summary).toBeTruthy();
    // The cut row itself lives inside the disclosure group, not the main feed list.
    expect(screen.getByText('Bad Card')).toBeTruthy();
  });

  it('renders the tuned empty state when there is nothing to coach', () => {
    render(
      <CoachFeed
        {...makeProps({ gaps: [], costPlan: undefined, oneAwayCombos: [], synergy: [] })}
      />
    );
    expect(screen.getByText(/Nothing to coach/)).toBeTruthy();
  });
});
