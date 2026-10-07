// @vitest-environment happy-dom
//
// The Cuts lane as swaps (E540 S6): each cut leads with its best replacement and
// one apply does both; a bare cut shows only to repair a rule; the lane has a
// face for loading, empty, error and "can't score this deck".
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachFeed, type CoachFeedProps } from './CoachFeed';
import type { Change } from '@/lib/coach/deck-change';
import type { CutOutcome, CutSwapState } from '@/lib/coach/coach-cut-swaps';

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('./useCardCarousel', () => ({
  useCardCarousel: () => ({ open: vi.fn(), preview: null }),
}));
vi.mock('./use-deck-hover-peek', () => ({
  useDeckHoverPeek: () => ({ listHandlers: {}, peek: null }),
}));

let pairing: CutSwapState = { status: 'idle' };
const retry = vi.fn();
vi.mock('@/lib/coach/use-cut-swaps', () => ({
  useCutSwaps: () => ({ state: pairing, retry }),
}));

const removal = (name: string, reason = 'Low inclusion') => ({
  name,
  reason,
  reasonCategory: 'low-inclusion',
  inclusion: 4,
});

const outcomes = (entries: [string, CutOutcome][]): CutSwapState => ({
  status: 'ready',
  outcomes: new Map(entries.map(([n, o]) => [`upgrade:cut:${n}`, o])),
});

const swapFor = (cutName: string, addName: string): CutOutcome => ({
  status: 'swap',
  change: {
    id: `upgrade:cut:${cutName}`,
    type: 'swap',
    lane: 'upgrade',
    name: addName,
    inName: cutName,
    pairedCut: true,
    reason: `${cutName} is in only 4% of this commander's decks. ${addName} is in 41% of this commander's decks.`,
    inclusion: 41,
  } satisfies Change,
});

function makeProps(over: Partial<CoachFeedProps> = {}): CoachFeedProps {
  return {
    gaps: [],
    optimize: {
      removals: [removal('Skull Prophet'), removal('Strionic Resonator'), removal('Dread Return')],
      additions: [],
    },
    synergy: [],
    substitutes: [],
    roleCounts: {},
    roleTargets: {},
    deckSize: 100,
    deckTarget: 100,
    bracketOverridePresent: false,
    resolveOwnership: () => undefined,
    ownedNames: new Set(),
    deckNames: new Set(['skull prophet', 'strionic resonator', 'dread return']),
    onApplyMove: vi.fn(),
    onApplyAllDropIns: vi.fn(),
    onConvergeBracket: vi.fn(),
    ownedOnly: false,
    onOwnedOnlyChange: vi.fn(),
    ...over,
  };
}

/** Render the feed and open the Cuts lane. */
function renderCuts(props: Partial<CoachFeedProps> = {}) {
  const view = render(<CoachFeed {...makeProps(props)} />);
  fireEvent.click(screen.getByRole('button', { name: /^Cuts/ }));
  return view;
}

const rowNames = (container: HTMLElement) =>
  [...container.querySelectorAll('.coach-feed-rows > li .deck-card-row-name')].map(
    (n) => n.textContent
  );

beforeEach(() => {
  pairing = { status: 'idle' };
  retry.mockClear();
  // Reduced motion: an apply fires on the click, not on the leave animation.
  window.matchMedia = ((q: string) => ({
    matches: q.includes('reduce'),
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

describe('the Cuts lane while the pairing runs', () => {
  it('shows the existing skeleton, no rows and no count on the chip', () => {
    pairing = { status: 'loading' };
    const { container } = renderCuts();
    expect(screen.getByRole('status', { name: /Analyzing your deck/ })).toBeTruthy();
    expect(container.querySelector('.coach-feed-rows')).toBeNull();
    const chip = screen.getByRole('button', { name: /^Cuts/ });
    expect(chip.querySelector('.coach-feed-chip-count')).toBeNull();
  });
});

describe('the Cuts lane once paired', () => {
  it('leads each row with the cut and its replacement, and applies both with one action', () => {
    pairing = outcomes([
      ['Skull Prophet', swapFor('Skull Prophet', 'Gilded Lotus')],
      ['Strionic Resonator', swapFor('Strionic Resonator', 'Cultivate')],
      ['Dread Return', { status: 'none', reason: 'gains 0.10 < 0.30' }],
    ]);
    const onApplyMove = vi.fn();
    const { container } = renderCuts({ onApplyMove });
    // The bare cut with no replacement is not shown; the others are, in legacy order.
    expect(rowNames(container)).toEqual(['Gilded Lotus', 'Cultivate']);
    expect(screen.getByText('Cut Skull Prophet, add')).toBeTruthy();
    expect(screen.queryByText('Dread Return')).toBeNull();
    // The chip counts the lane, not the legacy cuts.
    expect(
      screen.getByRole('button', { name: /^Cuts/ }).querySelector('.coach-feed-chip-count')
        ?.textContent
    ).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Cut Skull Prophet and add Gilded Lotus' }));
    expect(onApplyMove).toHaveBeenCalledTimes(1);
    expect(onApplyMove).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'swap', name: 'Gilded Lotus', inName: 'Skull Prophet' })
    );
  });

  it('keeps a bare cut that repairs a rule, saying which', () => {
    pairing = outcomes([
      [
        'Skull Prophet',
        {
          status: 'repair',
          change: {
            id: 'upgrade:cut:Skull Prophet',
            type: 'cut',
            lane: 'upgrade',
            name: 'Skull Prophet',
            reason: 'The deck is over its card count, so a card has to go.',
          },
        },
      ],
      ['Strionic Resonator', { status: 'none', reason: 'no replacement' }],
      ['Dread Return', { status: 'none', reason: 'no replacement' }],
    ]);
    const { container } = renderCuts();
    expect(rowNames(container)).toEqual(['Skull Prophet']);
    expect(screen.getByText(/over its card count/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cut Skull Prophet' })).toBeTruthy();
  });

  it('says so when no cut has a replacement and none fixes a rule', () => {
    // The user is on the lane while it loads; it settles with nothing to show.
    pairing = { status: 'loading' };
    const { container, rerender } = renderCuts();
    pairing = outcomes([
      ['Skull Prophet', { status: 'none', reason: 'x' }],
      ['Strionic Resonator', { status: 'none', reason: 'x' }],
      ['Dread Return', { status: 'none', reason: 'x' }],
    ]);
    rerender(<CoachFeed {...makeProps()} />);
    expect(container.querySelector('.coach-feed-rows')).toBeNull();
    expect(screen.getByText(/Nothing to cut\. No weak card here has a better one/)).toBeTruthy();
    // The chip stays while it is the open lane, so the user is not stranded.
    expect(screen.getByRole('button', { name: /^Cuts/ })).toBeTruthy();
  });

  it('shows no Cuts chip when no cut survives and the user is elsewhere', () => {
    pairing = outcomes([
      ['Skull Prophet', { status: 'none', reason: 'x' }],
      ['Strionic Resonator', { status: 'none', reason: 'x' }],
      ['Dread Return', { status: 'none', reason: 'x' }],
    ]);
    render(<CoachFeed {...makeProps()} />);
    expect(screen.queryByRole('button', { name: /^Cuts/ })).toBeNull();
  });

  it('puts rows the budget left unscored below the scored ones, in their own order', () => {
    pairing = outcomes([
      ['Skull Prophet', { status: 'unscored', reason: 'over-budget' }],
      ['Dread Return', swapFor('Dread Return', 'Cultivate')],
    ]);
    const { container } = renderCuts();
    // Cuts read weakest first by the legacy order; the scored row leads, the rest follow.
    expect(rowNames(container)).toEqual(['Cultivate', 'Skull Prophet', 'Strionic Resonator']);
  });
});

describe('a deck the pairing cannot serve', () => {
  it("falls back to today's cut rows with a note, never a blank lane", () => {
    pairing = { status: 'fallback', reason: 'no-page' };
    const { container } = renderCuts();
    expect(rowNames(container).sort()).toEqual(
      ['Dread Return', 'Skull Prophet', 'Strionic Resonator'].sort()
    );
    expect(screen.getByText(/can't judge swaps for this deck right now/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it("on an error shows today's rows and a retry", () => {
    pairing = { status: 'error' };
    const { container } = renderCuts();
    expect(rowNames(container)).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
