// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedCard } from '@/types/index';
import { usePostImportMoment } from '@/store/post-import-moment';
import { useCollectionStore } from '@/store/collection';

const fetchCommanderData = vi.fn();
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: (name: string) => fetchCommanderData(name),
}));
const trackMock = vi.fn();
vi.mock('@/lib/util/analytics', () => ({ track: (name: string) => trackMock(name) }));
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));

import { PostImportMoment } from './PostImportMoment';

function card(name: string, extra: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: `copy_${name}`,
    name,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: `sf_${name}`,
    purchasePrice: 2,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    colorIdentity: ['G'],
    ...extra,
  };
}
const legend = (name: string, rank: number) =>
  card(name, {
    typeLine: 'Legendary Creature — Elf',
    legalities: { commander: 'legal' },
    edhrecRank: rank,
    colorIdentity: ['G', 'B'],
  });
const filler = Array.from({ length: 30 }, (_, i) => card(`Filler ${i}`));

const renderMoment = (cards: EnrichedCard[]) =>
  render(
    <MemoryRouter>
      <PostImportMoment cards={cards} />
    </MemoryRouter>
  );

beforeEach(() => {
  fetchCommanderData.mockReset();
  trackMock.mockClear();
  navigateMock.mockClear();
  usePostImportMoment.setState({ importId: 'imp', open: true, shownCounted: false });
  useCollectionStore.setState({ pricesEverLoaded: true, isRefreshingPrices: false });
});

describe('PostImportMoment', () => {
  it('summarizes the collection and offers the best owned commanders', async () => {
    fetchCommanderData.mockImplementation(async (name: string) => ({
      cardlists: {
        allNonLand: [
          { name: 'Filler 0', inclusion: 90 },
          { name: name === 'Meren' ? 'Filler 1' : 'Nope', inclusion: 80 },
        ],
      },
    }));
    renderMoment([...filler, legend('Meren', 5), legend('Golgari Guy', 6)]);

    expect(screen.getByText('What we found in your collection')).toBeTruthy();
    expect(screen.getByText('32 cards')).toBeTruthy();
    expect(screen.getByText('$64')).toBeTruthy();
    // Loading comes first, and says so.
    expect(screen.getByRole('status').textContent).toMatch(/Checking your commanders/);

    expect(await screen.findByText('Meren')).toBeTruthy();
    expect(screen.getByText('Golgari Guy')).toBeTruthy();
  });

  it('sends the tapped commander to the generator owned-first and counts the tap', async () => {
    fetchCommanderData.mockResolvedValue({
      cardlists: { allNonLand: [{ name: 'Filler 0', inclusion: 90 }] },
    });
    renderMoment([...filler, legend('Meren', 5)]);
    fireEvent.click(await screen.findByRole('button', { name: /Meren/ }));
    expect(trackMock).toHaveBeenCalledWith('post_import_tapped');
    expect(navigateMock).toHaveBeenCalledWith('/decks/new/generate?commander=Meren', {
      state: { ownedFirst: true },
    });
  });

  it('counts the first showing once, not each remount or reopen', async () => {
    fetchCommanderData.mockResolvedValue({ cardlists: { allNonLand: [] } });
    const first = renderMoment([...filler, legend('Meren', 5)]);
    await waitFor(() => expect(trackMock).toHaveBeenCalledWith('post_import_shown'));
    first.unmount();
    renderMoment([...filler, legend('Meren', 5)]);
    expect(trackMock.mock.calls.filter(([n]) => n === 'post_import_shown')).toHaveLength(1);
  });

  it('says so when the collection has no commander', async () => {
    renderMoment(filler);
    expect(await screen.findByText(/No commanders in this collection yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Find a commander' }).getAttribute('href')).toBe(
      '/decks/new/generate'
    );
  });

  it('offers a retry when the commanders could not be rated', async () => {
    fetchCommanderData.mockRejectedValue(new Error('offline'));
    renderMoment([...filler, legend('Meren', 5)]);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't rate/);

    fetchCommanderData.mockResolvedValue({
      cardlists: { allNonLand: [{ name: 'Filler 0', inclusion: 90 }] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Meren')).toBeTruthy();
  });

  it('dismisses', async () => {
    fetchCommanderData.mockResolvedValue({ cardlists: { allNonLand: [] } });
    renderMoment(filler);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss what we found' }));
    expect(usePostImportMoment.getState().open).toBe(false);
  });
});

describe('PostImportMoment value', () => {
  it('leaves the value out while the collection is still being priced', () => {
    useCollectionStore.setState({ pricesEverLoaded: true, isRefreshingPrices: true });
    fetchCommanderData.mockResolvedValue({ cardlists: { allNonLand: [] } });
    renderMoment(filler);
    expect(screen.queryByText('$60')).toBeNull();
    expect(screen.getByText('30 cards')).toBeTruthy();
  });
});
