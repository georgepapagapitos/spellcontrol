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
    // Swap rows need their outgoing card in the deck to be offered at all.
    deckNames: new Set(['smothering tithe']),
    onApplyMove: vi.fn(),
    onApplyAllDropIns: vi.fn(),
    ownedOnly: false,
    onOwnedOnlyChange: vi.fn(),
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
      // Cut rows only render while their card is still in the deck.
      deckNames: new Set(['smothering tithe', 'bad card']),
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

  // ── PR-2: Fit? button ───────────────────────────────────────────────────

  it('Fit? button is present on add rows when onPreviewFit is provided', () => {
    const onPreviewFit = vi.fn();
    render(<CoachFeed {...makeProps({ onPreviewFit })} />);
    // Cultivate is an add row — should have a Fit? button
    const fitBtns = screen.getAllByRole('button', {
      name: (n) => n.startsWith('Will ') && n.endsWith(' fit this deck?'),
    });
    expect(fitBtns.length).toBeGreaterThan(0);
  });

  it('Fit? button is present on swap rows when onPreviewFit is provided', () => {
    const onPreviewFit = vi.fn();
    render(<CoachFeed {...makeProps({ onPreviewFit })} />);
    // Esper Sentinel is a budget swap row — should have a Fit? button
    expect(screen.getByRole('button', { name: 'Will Esper Sentinel fit this deck?' })).toBeTruthy();
  });

  it('Fit? button is absent on cut rows', () => {
    const onPreviewFit = vi.fn();
    const props = makeProps({
      onPreviewFit,
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
    expect(screen.queryByRole('button', { name: 'Will Bad Card fit this deck?' })).toBeNull();
  });

  it('clicking Fit? calls onPreviewFit with the change', () => {
    const onPreviewFit = vi.fn();
    render(<CoachFeed {...makeProps({ onPreviewFit })} />);
    const btn = screen.getByRole('button', { name: 'Will Cultivate fit this deck?' });
    fireEvent.click(btn);
    expect(onPreviewFit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Cultivate', type: 'add' })
    );
  });

  it('Fit? button is absent when onPreviewFit prop is omitted', () => {
    render(<CoachFeed {...makeProps()} />);
    expect(screen.queryByRole('button', { name: /fit this deck/ })).toBeNull();
  });

  // ── PR-2: `f` key cycles filters ────────────────────────────────────────

  it('f key cycles to the next filter with rows', () => {
    render(<CoachFeed {...makeProps()} />);
    // Initially on 'All'; first cycle should move to the next non-zero chip.
    // Our fixture has fill-gaps (Cultivate), budget (Esper Sentinel), combos (Heliod).
    // The cycle order follows FILTER_LABELS key order: all, fill-gaps, upgrade,
    // budget, collection, bracket-fit, combos. First non-zero after 'all' is fill-gaps.
    fireEvent.keyDown(window, { key: 'f' });
    expect(screen.getByRole('button', { name: /Fix gaps/ }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('f key does nothing when typing in an input', () => {
    render(
      <>
        <CoachFeed {...makeProps()} />
        <input type="text" data-testid="text-input" />
      </>
    );
    // Initially on 'All'.
    const input = screen.getByTestId('text-input');
    input.focus();
    fireEvent.keyDown(input, { key: 'f' });
    // Should still be on 'All' (filter didn't cycle).
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
  });

  // ── PR-2: leaving-row animation (animate, THEN apply) ────────────────────

  it('marks a row with the leaving class when Apply is clicked', () => {
    const { container } = render(<CoachFeed {...makeProps()} />);
    // Click the Apply button for Cultivate (the gap add row).
    const applyBtn = screen.getByRole('button', { name: 'Add Cultivate' });
    fireEvent.click(applyBtn);
    // The <li> wrapping the row should now have the is-leaving class.
    const leavingLi = container.querySelector('.coach-feed-row-leaving');
    expect(leavingLi).toBeTruthy();
  });

  it('defers the apply to animationend, then hides the row while data catches up', () => {
    const onApplyMove = vi.fn();
    const { container } = render(<CoachFeed {...makeProps({ onApplyMove })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Cultivate' }));
    // Animate-then-apply: the click alone must NOT fire the apply.
    expect(onApplyMove).not.toHaveBeenCalled();
    const leavingLi = container.querySelector('.coach-feed-row-leaving');
    expect(leavingLi).toBeTruthy();
    fireEvent.animationEnd(leavingLi!, { animationName: 'coach-row-leave' });
    expect(onApplyMove).toHaveBeenCalledTimes(1);
    expect(onApplyMove).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cultivate' }));
    // The row stays hidden (departed) even though the analysis data still
    // contains it — the deck update is what drops it for real.
    expect(screen.queryByText('Cultivate')).toBeNull();
  });

  it('flushes a pending apply on unmount so a mid-animation tab switch keeps the click', () => {
    const onApplyMove = vi.fn();
    const { unmount } = render(<CoachFeed {...makeProps({ onApplyMove })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Cultivate' }));
    expect(onApplyMove).not.toHaveBeenCalled();
    unmount();
    expect(onApplyMove).toHaveBeenCalledTimes(1);
  });

  // ── PR-2: deck-contents ground-truth filtering ────────────────────────────

  it('hides an add row once its card is in the deck (and an undo brings it back)', () => {
    const { rerender } = render(<CoachFeed {...makeProps()} />);
    expect(screen.getByText('Cultivate')).toBeTruthy();
    rerender(
      <CoachFeed {...makeProps({ deckNames: new Set(['smothering tithe', 'cultivate']) })} />
    );
    expect(screen.queryByText('Cultivate')).toBeNull();
    rerender(<CoachFeed {...makeProps()} />);
    expect(screen.getByText('Cultivate')).toBeTruthy();
  });

  it('hides a swap row when its outgoing card is no longer in the deck', () => {
    render(<CoachFeed {...makeProps({ deckNames: new Set<string>() })} />);
    // The budget swap (Smothering Tithe → Esper Sentinel) has no live target slot.
    expect(screen.queryByText('Esper Sentinel')).toBeNull();
  });

  // ── "Owned only" count/body consistency ───────────────────────────────────

  it('counts honor "Owned only": the all-unowned lane stays visible but empties', () => {
    // Only Heliod (the combo) is owned; Cultivate (gap) and Esper Sentinel
    // (budget swap) are not — so the Fix gaps lane has no owned suggestion.
    render(<CoachFeed {...makeProps({ ownedOnly: true })} />);

    // The chip stays visible (so the gap isn't silently hidden) but carries no
    // count badge — the number always matches what the body would show.
    const fixGaps = screen.getByRole('button', { name: /Fix gaps/ });
    expect(fixGaps.textContent).toBe('Fix gaps');

    // Its body explains the empty state instead of dead-ending.
    fireEvent.click(fixGaps);
    expect(screen.queryByText('Cultivate')).toBeNull();
    expect(screen.getByText(/you don't own yet/)).toBeTruthy();
  });

  it('"Owned only" checkbox and "Show unowned too" both call onOwnedOnlyChange', () => {
    const onOwnedOnlyChange = vi.fn();
    const { rerender } = render(
      <CoachFeed {...makeProps({ ownedOnly: false, onOwnedOnlyChange })} />
    );
    fireEvent.click(screen.getByLabelText('Owned only'));
    expect(onOwnedOnlyChange).toHaveBeenLastCalledWith(true);

    // With the toggle on and a fresh callback, the empty-state relax button fires it.
    onOwnedOnlyChange.mockClear();
    rerender(<CoachFeed {...makeProps({ ownedOnly: true, onOwnedOnlyChange })} />);
    fireEvent.click(screen.getByRole('button', { name: /Fix gaps/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Show unowned too' }));
    expect(onOwnedOnlyChange).toHaveBeenLastCalledWith(false);
  });
});
