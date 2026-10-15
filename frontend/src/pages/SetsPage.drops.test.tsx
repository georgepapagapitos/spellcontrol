// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetsPage } from './SetsPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import { parseSldDrops } from '@/lib/cards/sld-drops';
import type { EnrichedCard } from '../types';

// Ten drops, so a broad query runs past the six-row preview.
const INDEX = parseSldDrops({
  drops: [
    { name: 'Stardew Valley Life in Pelican Town', releasedAt: '2026-03-01', numbers: ['2001'] },
    { name: 'The Oddlands Forests', releasedAt: '2026-02-01', numbers: ['1901', '1902'] },
    ...Array.from({ length: 8 }, (_, i) => ({
      name: `Rocks Vol ${i + 1}`,
      releasedAt: '2021-03-15',
      numbers: [String(100 + i)],
    })),
  ],
})!;

vi.mock('@/lib/cards/sld-drops', async (orig) => ({
  ...(await orig<typeof import('@/lib/cards/sld-drops')>()),
  useSldDrops: () => INDEX,
}));
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  useSetMap: () => undefined,
  getSetCards: () => Promise.resolve([]),
}));

function sld(n: string): EnrichedCard {
  return {
    copyId: `c${n}`,
    scryfallId: `s${n}`,
    oracleId: `o${n}`,
    name: `Card ${n}`,
    setCode: 'SLD',
    setName: 'Secret Lair Drop',
    collectorNumber: n,
    rarity: 'rare',
    purchasePrice: 1,
    finish: 'nonfoil',
  } as unknown as EnrichedCard;
}

beforeEach(() => {
  useAuth.setState({ status: 'guest' });
  // Owns one Oddlands card; owns nothing from Stardew or Rocks.
  useCollectionStore.setState({ hydrating: false, cards: [sld('1901')] });
});
afterEach(cleanup);

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/collection/sets" element={<SetsPage />} />
        <Route path="/collection/sets/:code" element={<SetsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const dropLinks = () =>
  within(screen.getByRole('region', { name: 'Secret Lair drops' })).getAllByRole('link');

describe('Secret Lair drop search', () => {
  it('the hub search finds a drop the collection owns nothing from', () => {
    renderAt('/collection/sets');
    fireEvent.change(screen.getByLabelText(/Filter sets by name or code/), {
      target: { value: 'stardew pelican' },
    });
    const [link] = dropLinks();
    expect(link.getAttribute('aria-label')).toBe(
      'Stardew Valley Life in Pelican Town, 0 of 1 cards, 0% complete'
    );
    expect(link.getAttribute('href')).toBe(
      '/collection/sets/sld?drop=Stardew%20Valley%20Life%20in%20Pelican%20Town'
    );
  });

  it('the hub search carries owned progress and waits for three characters', () => {
    renderAt('/collection/sets');
    const box = screen.getByLabelText(/Filter sets by name or code/);
    fireEvent.change(box, { target: { value: 'od' } });
    expect(screen.queryByRole('region', { name: 'Secret Lair drops' })).toBeNull();
    fireEvent.change(box, { target: { value: 'oddlands' } });
    expect(dropLinks()[0].getAttribute('aria-label')).toBe(
      'The Oddlands Forests, 1 of 2 cards, 50% complete'
    );
  });

  it('the SLD page searches every drop and reveals past the preview', () => {
    renderAt('/collection/sets/sld');
    // Before searching: only the drops the collection touches.
    expect(screen.getByRole('heading', { name: 'Your drops' })).toBeTruthy();
    expect(dropLinks()).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Search every Secret Lair drop by name'), {
      target: { value: 'rocks' },
    });
    expect(screen.getByRole('heading', { name: 'Drops' })).toBeTruthy();
    expect(dropLinks()).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 8 drops' }));
    expect(dropLinks()).toHaveLength(8);
    // Focus lands on the first revealed row, not the vanished button.
    expect(document.activeElement).toBe(dropLinks()[6]);
  });

  it('the SLD page says when no drop matches', () => {
    renderAt('/collection/sets/sld');
    fireEvent.change(screen.getByLabelText('Search every Secret Lair drop by name'), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('No drops match “zzz”.').getAttribute('role')).toBe('status');
  });
});
