// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PublicCard } from '@/lib/social/shared-types';
import { groupCards, sortGrouped } from '@/lib/social/shared-grouping';

vi.mock('@/lib/api', async () => {
  const { pending } = await import('@/test/pending');
  return { getSetMap: () => pending({}) };
});
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));

import { CollectionBrowser, type CollectionBrowserProps } from './CollectionBrowser';

function pc(name: string, over: Partial<PublicCard> = {}): PublicCard {
  return {
    name,
    oracleId: `o-${name}`,
    scryfallId: `sf-${name}`,
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'rare',
    finish: 'nonfoil',
    foil: false,
    purchasePrice: 1,
    cmc: 1,
    typeLine: 'Artifact',
    ...over,
  };
}

const CARDS: PublicCard[] = [
  pc('Sol Ring', { edhrecRank: 1, spare: true, inDeck: false }),
  pc('Llanowar Elves', {
    typeLine: 'Creature — Elf Druid',
    edhrecRank: 40,
    spare: false,
    inDeck: true,
  }),
  pc('Wurmcoil Engine', { cmc: 6, spare: false, inDeck: false }),
];

function stubViewport(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /max-width:\s*599px/.test(query) ? phone : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function renderBrowser(over: Partial<CollectionBrowserProps> = {}) {
  return render(
    <MemoryRouter>
      <CollectionBrowser cards={CARDS} ownerName="Morgan" viewer="friend" embedded {...over} />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CollectionBrowser', () => {
  it('runs Scryfall syntax search over per-copy data', () => {
    stubViewport(false);
    renderBrowser();
    fireEvent.change(screen.getByLabelText('Search cards'), { target: { value: 't:creature' } });
    expect(screen.queryByText('Sol Ring')).toBeNull();
    expect(screen.getByText('Llanowar Elves')).toBeTruthy();
    expect(screen.getByText(/1 of 3 cards/)).toBeTruthy();
  });

  it('Clear all resets the search and the chips', () => {
    stubViewport(false);
    renderBrowser();
    fireEvent.change(screen.getByLabelText('Search cards'), { target: { value: 'sol' } });
    fireEvent.click(screen.getByRole('button', { name: /^Spare/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect((screen.getByLabelText('Search cards') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: /^Spare/ }).getAttribute('aria-pressed')).toBe(
      'false'
    );
    expect(screen.getByText('Wurmcoil Engine')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  it('Spare chip narrows the list and shows a count', () => {
    stubViewport(false);
    renderBrowser();
    const spare = screen.getByRole('button', { name: /^Spare/ });
    expect(spare.textContent).toContain('1');
    fireEvent.click(spare);
    expect(screen.queryByText('Wurmcoil Engine')).toBeNull();
    expect(screen.getByText('Sol Ring')).toBeTruthy();
  });

  it('offers neither chip for a stranger payload without those keys', () => {
    stubViewport(false);
    renderBrowser({
      viewer: 'public',
      cards: CARDS.map(({ spare: _s, inDeck: _d, ...rest }) => rest),
    });
    expect(screen.queryByRole('button', { name: /^Spare/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Not in a deck/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^On my wants/ })).toBeNull();
  });

  it('shows On my wants only when myWants is given', () => {
    stubViewport(false);
    renderBrowser({ myWants: new Set(['o-Sol Ring']) });
    fireEvent.click(screen.getByRole('button', { name: /^On my wants/ }));
    expect(screen.getByText('Sol Ring')).toBeTruthy();
    expect(screen.queryByText('Llanowar Elves')).toBeNull();
  });

  it('shows no count and no empty claim before the data arrives', () => {
    stubViewport(false);
    renderBrowser({ cards: null });
    expect(screen.getByRole('status', { name: 'Loading collection' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d+ cards?/);
    expect(document.body.textContent).not.toMatch(/empty|No cards/);
  });

  it('error state offers Retry and a way out', () => {
    stubViewport(false);
    const onRetry = vi.fn();
    renderBrowser({ cards: null, error: 'The request did not go through.', onRetry });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Go to SpellControl' })).toBeTruthy();
  });

  it('says a private collection is private', () => {
    stubViewport(false);
    renderBrowser({ cards: [], isPrivate: true });
    expect(screen.getByText('Morgan keeps their collection private.')).toBeTruthy();
  });

  it('folds layout and details behind View options on a phone', () => {
    stubViewport(true);
    renderBrowser();
    expect(screen.getByRole('button', { name: 'View options' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Grid view' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Details/ })).toBeNull();
  });

  it('keeps layout on the tool row above 600px', () => {
    stubViewport(false);
    renderBrowser();
    expect(screen.queryByRole('button', { name: 'View options' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Grid view' })).toBeTruthy();
  });
});

describe('popularity sort', () => {
  const groups = groupCards([
    pc('Unranked A'),
    pc('Ranked', { edhrecRank: 5 }),
    pc('Unranked B'),
    pc('Top', { edhrecRank: 1 }),
  ]);
  const names = (dir: 'asc' | 'desc') =>
    sortGrouped(groups, 'popularity', dir).map((g) => g.card.name);

  it('puts unranked cards last in both directions', () => {
    expect(names('asc')).toEqual(['Top', 'Ranked', 'Unranked A', 'Unranked B']);
    expect(names('desc').slice(0, 2)).toEqual(['Ranked', 'Top']);
    expect(names('desc').slice(2).sort()).toEqual(['Unranked A', 'Unranked B']);
  });

  it('is offered only when some card has a rank', () => {
    stubViewport(false);
    renderBrowser();
    fireEvent.click(screen.getByRole('button', { name: /Sort/ }));
    expect(screen.getAllByText('Popularity').length).toBeGreaterThan(0);
    cleanup();
    renderBrowser({ cards: CARDS.map(({ edhrecRank: _r, ...rest }) => rest) });
    fireEvent.click(screen.getByRole('button', { name: /Sort/ }));
    expect(screen.queryByText('Popularity')).toBeNull();
  });
});
