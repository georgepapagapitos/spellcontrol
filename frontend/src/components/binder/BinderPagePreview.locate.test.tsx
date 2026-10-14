// @vitest-environment happy-dom
/**
 * The page viewer marks the pocket a "where is my copy" link opened it for:
 * a ring on screen, `aria-current` on the pocket, and the pocket said in the
 * live region while its page shows.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BinderPage, EnrichedCard } from '@/types/index';

vi.mock('@/lib/collection/allocations', () => ({ useAllocations: () => new Map() }));
vi.mock('@/components/card/CardPreview', () => ({ CardPreview: () => null }));

import { BinderPagePreview } from './BinderPagePreview';

afterEach(cleanup);

const card = (i: number) =>
  ({ copyId: `c${i}`, name: `Card ${i}`, scryfallId: `s${i}`, foil: false }) as EnrichedCard;

const pages: BinderPage[] = [
  { pageNum: 1, slots: [card(1), card(2), null, null] },
  { pageNum: 2, slots: [card(3), card(4), card(5), null] },
];

function renderViewer(locatedCopyId?: string, startPageIndex = 1) {
  return render(
    <MemoryRouter>
      <BinderPagePreview
        pages={pages}
        pageLabels={['All cards', 'All cards']}
        startPageIndex={startPageIndex}
        pocketSize={4}
        binderName="Red Spells"
        resolveCard={() => null}
        onClose={() => {}}
        locatedCopyId={locatedCopyId}
      />
    </MemoryRouter>
  );
}

describe('page viewer: the located pocket', () => {
  it('marks the pocket and says where it is', () => {
    renderViewer('c4');
    const pocket = screen.getByRole('button', { name: 'Open Card 4' });
    expect(pocket.getAttribute('aria-current')).toBe('true');
    expect(pocket.parentElement?.classList.contains('is-located')).toBe(true);
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1);
    expect(screen.getByText('Page 2 of 2, All cards, Card 4 in pocket 2')).toBeTruthy();
    // Said on screen too, under the binder's name.
    expect(screen.getByText('All cards · Card 4 in pocket 2')).toBeTruthy();
  });

  it('says nothing extra on a page without the pocket', () => {
    renderViewer('c4', 0);
    expect(screen.getByText('Page 1 of 2, All cards')).toBeTruthy();
  });

  it('marks nothing on a plain open', () => {
    renderViewer();
    expect(document.querySelector('[aria-current], .is-located')).toBeNull();
    expect(screen.getByText('Page 2 of 2, All cards')).toBeTruthy();
  });
});
