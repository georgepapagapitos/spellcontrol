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

import { PICK_COUNT } from '@/lib/deck/owned-commander-picks';
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

    expect(screen.getByText('Collection summary')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the collection summary' }));
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

  // The card sits above the collection table, so any height change moves the
  // table (CLS 0.15 desktop, 0.43 phone, 2026-10-13). Every state fills the
  // same grid with the same number of rows as the loaded card.
  it('holds the loaded card footprint in the loading, empty and error states', async () => {
    const rows = (c: HTMLElement) => c.querySelectorAll('.post-import-picks > li').length;
    const cls = (c: HTMLElement) => c.querySelector('.post-import-picks')?.parentElement?.className;
    fetchCommanderData.mockResolvedValue({
      cardlists: { allNonLand: [{ name: 'Filler 0', inclusion: 90 }] },
    });
    const loaded = renderMoment([...filler, legend('A', 1), legend('B', 2), legend('C', 3)]);
    const loadingRows = rows(loaded.container);
    const loadingParent = cls(loaded.container);
    expect(loaded.container.querySelector('.post-import-skeleton')).toBeTruthy();
    await screen.findByText('A');
    expect(rows(loaded.container)).toBe(loadingRows);
    expect(rows(loaded.container)).toBe(PICK_COUNT);
    expect(cls(loaded.container)).toBe(loadingParent);
    loaded.unmount();

    const empty = renderMoment(filler);
    await screen.findByText(/No commanders in this collection yet/);
    expect(rows(empty.container)).toBe(PICK_COUNT);
    expect(empty.container.querySelector('.post-import-picks.is-idle')).toBeTruthy();
    empty.unmount();

    fetchCommanderData.mockRejectedValue(new Error('offline'));
    const failed = renderMoment([...filler, legend('A', 1)]);
    await screen.findByRole('alert');
    expect(rows(failed.container)).toBe(PICK_COUNT);
  });

  it('stays out of layout and uncounted while the import sheet is open', async () => {
    fetchCommanderData.mockResolvedValue({ cardlists: { allNonLand: [] } });
    const { container, rerender } = render(
      <MemoryRouter>
        <PostImportMoment cards={filler} hidden />
      </MemoryRouter>
    );
    expect(container.querySelector('.post-import-moment')?.hasAttribute('hidden')).toBe(true);
    expect(trackMock).not.toHaveBeenCalledWith('post_import_shown');
    rerender(
      <MemoryRouter>
        <PostImportMoment cards={filler} />
      </MemoryRouter>
    );
    expect(container.querySelector('.post-import-moment')?.hasAttribute('hidden')).toBe(false);
    await waitFor(() => expect(trackMock).toHaveBeenCalledWith('post_import_shown'));
  });
});
