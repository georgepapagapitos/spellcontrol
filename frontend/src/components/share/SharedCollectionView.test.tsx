// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PublicCollection } from '@/lib/social/shared-types';

vi.mock('@/lib/api', async () => {
  const { pending } = await import('@/test/pending');
  return { getSetMap: () => pending({}) };
});

import { SharedCollectionView } from './SharedCollectionView';

function card(name: string, rarity: string) {
  return {
    name,
    scryfallId: name,
    setCode: 'cmr',
    collectorNumber: '1',
    rarity,
    finish: 'foil',
    foil: true,
    purchasePrice: 1.5,
    cmc: 1,
    typeLine: 'Artifact',
    condition: 'nm',
  };
}

const DATA = {
  ownerUsername: 'alice',
  ownerDisplayName: null,
  cards: [card('Sol Ring', 'uncommon'), card('Mana Crypt', 'mythic')],
} as unknown as PublicCollection;

function renderView(viewerIsOwner?: boolean) {
  return render(
    <MemoryRouter>
      <SharedCollectionView data={DATA} embedded viewerIsOwner={viewerIsOwner} />
    </MemoryRouter>
  );
}

describe('SharedCollectionView', () => {
  it('Reset search on a no-match search clears the search box', () => {
    renderView();
    const box = screen.getByLabelText('Search cards') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'zzzz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset search' }));
    expect(box.value).toBe('');
    expect(screen.getByText('Sol Ring')).toBeTruthy();
  });

  it('Reset search also clears a filter that emptied the list, with the search box empty', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/no cards match your search or filters/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reset search' }));
    expect(await screen.findByText('Sol Ring')).toBeTruthy();
  });

  it('calls someone else\'s card "Their copy", and the owner\'s own "Your copy"', () => {
    const { unmount } = renderView();
    fireEvent.click(screen.getAllByRole('button', { name: /Sol Ring/ })[0]);
    expect(document.body.textContent).toContain('Their copy');
    expect(document.body.textContent).not.toContain('Your copy');
    unmount();
    renderView(true);
    fireEvent.click(screen.getAllByRole('button', { name: /Sol Ring/ })[0]);
    expect(document.body.textContent).toContain('Your copy');
  });
});
