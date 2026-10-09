// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWAP_OPEN_KEY, SwapThisCard } from './SwapThisCard';
import { SIMILAR_OPEN_KEY, SimilarCardsStrip } from './SimilarCardsStrip';
import { suggestionSummary } from './SuggestionSection';
import { toSwapAgainst, type Change } from '@/lib/coach/deck-change';
import { resetSuggestionLabelsForTests, setSuggestionContext } from '@/lib/util/suggestion-labels';
import type { ScryfallCard } from '@/deck-builder/types';

// Guard: in a deck card's preview, "Swap this card" and "Similar cards" ran
// 2,000 to 3,000px between the rules text and the card's printings, rulings and
// legality. Both now start closed as one row that says what's inside, remember
// being opened, record a "shown" label only while open, and Similar cards drops
// a card Swap this card already lists.

const sent = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@/lib/util/analytics', () => ({
  sendBeaconPayload: (p: Record<string, unknown>) => sent.push(p),
  normalizePath: (p: string) => p,
}));

vi.mock('./useSimilarCards', () => {
  const row = (name: string, ownership: string) => ({
    name,
    card: { name, cmc: 2, type_line: 'Sorcery' },
    ownership,
    inclusion: 30,
    sharedAxes: [],
    freeCount: 0,
  });
  return {
    useSimilarCards: () => ({
      owned: [row('Cultivate', 'owned')],
      discovery: [row('Farseek', 'unowned'), row('Nature’s Lore', 'unowned')],
      loading: false,
    }),
  };
});

const alt = (name: string, ownership: Change['ownership']): Change =>
  toSwapAgainst(
    { id: `fill-gaps:${name}`, type: 'add', lane: 'fill-gaps', name, ownership },
    'Rampant Growth'
  );

const swap = () => (
  <SwapThisCard
    currentName="Rampant Growth"
    alternatives={[alt('Cultivate', 'owned'), alt('Farseek', 'unowned')]}
    onSwap={vi.fn()}
  />
);

const similar = (excludeNames?: string[]) => (
  <SimilarCardsStrip
    target={{ name: 'Rampant Growth' } as ScryfallCard}
    deckCardNames={[]}
    excludeNames={excludeNames}
    collectionCards={[]}
    ownershipFor={() => 'unowned'}
    freeCountFor={() => 0}
    identity={['G']}
    inclusionMap={{}}
    onSwap={vi.fn()}
    enabled
  />
);

beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  resetSuggestionLabelsForTests();
  setSuggestionContext({
    id: 'deck-1',
    commander: { name: 'Tatyova, Benthic Druid', oracle_id: 'x' } as ScryfallCard,
    partnerCommander: null,
  });
});

describe('suggestion sections in the card preview', () => {
  it('start closed, say what they hold, and record nothing as shown', () => {
    render(
      <>
        {swap()}
        {similar()}
      </>
    );
    const swapToggle = screen.getByRole('button', { name: /Swap this card/ });
    expect(swapToggle.getAttribute('aria-expanded')).toBe('false');
    expect(swapToggle.textContent).toContain('2 options · 1 in your collection');
    const similarToggle = screen.getByRole('button', { name: /Similar cards/ });
    expect(similarToggle.textContent).toContain('3 cards · 1 in your collection');
    expect(screen.queryAllByText('Swap in')).toHaveLength(0);
    expect(sent).toEqual([]);
  });

  it('open on a tap, record the rows as shown, and stay open for the next card', () => {
    render(swap());
    fireEvent.click(screen.getByRole('button', { name: /Swap this card/ }));
    expect(screen.getAllByText('Swap in')).toHaveLength(2);
    expect(sent).toEqual([expect.objectContaining({ surface: 'swap', action: 'shown', n: 2 })]);
    expect(localStorage.getItem(SWAP_OPEN_KEY)).toBe('1');

    cleanup();
    render(swap());
    expect(
      screen.getByRole('button', { name: /Swap this card/ }).getAttribute('aria-expanded')
    ).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /Swap this card/ }));
    expect(localStorage.getItem(SWAP_OPEN_KEY)).toBeNull();
  });

  it('leave out of Similar cards what Swap this card already offers', () => {
    localStorage.setItem(SIMILAR_OPEN_KEY, '1');
    render(similar(['Farseek']));
    expect(screen.queryByText('Farseek')).toBeNull();
    expect(screen.getByText('Cultivate')).toBeTruthy();
    expect(screen.getByText('Nature’s Lore')).toBeTruthy();
  });

  it('word a single option and a list with nothing owned', () => {
    expect(suggestionSummary(1, ['option', 'options'], ['owned'])).toBe(
      '1 option · 1 in your collection'
    );
    expect(suggestionSummary(4, ['card', 'cards'], ['unowned', undefined])).toBe('4 cards');
    expect(suggestionSummary(2, ['card', 'cards'], ['in-other-deck', 'in-cube'])).toBe(
      '2 cards · 2 in your collection'
    );
  });
});
