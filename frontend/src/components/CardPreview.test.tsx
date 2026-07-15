// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EnrichedCard } from '../types';

// Never resolves — the panel falls back to its text-only set line, and the
// test avoids an un-acted setState after teardown.
vi.mock('../lib/api', () => ({
  getSetMap: () => new Promise(() => {}),
}));

// The image frame drags in the holographic tilt machinery; the detail panel
// under test doesn't need it.
vi.mock('./CardImageFrame', () => ({
  CardImageFrame: (p: { turn?: number }) => (
    <div data-testid="card-image-frame" data-turn={p.turn} />
  ),
}));

import { CardPreview } from './CardPreview';

beforeAll(() => {
  // happy-dom has no layout: stub the scroll/observe APIs the carousel uses.
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = '';
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
});

function mk(o: Partial<EnrichedCard>): EnrichedCard {
  return {
    copyId: 'copy-1',
    name: 'Test Card',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '123',
    rarity: 'rare',
    scryfallId: 'sf-1',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Instant',
    cmc: 0,
    ...o,
  } as EnrichedCard;
}

function renderPreview(card: EnrichedCard) {
  return render(
    <MemoryRouter>
      <CardPreview
        cards={[card]}
        index={0}
        binderName=""
        sectionLabels={['']}
        pageNumbers={[0]}
        totalPages={0}
        onIndexChange={() => {}}
        onClose={() => {}}
      />
    </MemoryRouter>
  );
}

describe('CardPreview printing identity (T36)', () => {
  it('appends the collector number to the set line', () => {
    renderPreview(mk({ setName: 'Test Set', setCode: 'TST', collectorNumber: '123' }));
    expect(screen.getByText('(TST)')).toBeTruthy();
    expect(screen.getByText('· #123')).toBeTruthy();
  });

  it('omits the collector-number token when the card has none', () => {
    renderPreview(mk({ collectorNumber: '' }));
    expect(screen.getByText('(TST)')).toBeTruthy();
    expect(screen.queryByText(/·\s*#/)).toBeNull();
  });

  it('shows the specific finish style for specialty foils — exactly one token', () => {
    renderPreview(mk({ foil: true, finish: 'foil', promoTypes: ['oilslick'] }));
    expect(screen.getByText('Oil slick')).toBeTruthy();
    expect(screen.queryByText('Foil')).toBeNull();
  });

  it('falls back to the generic Foil token for plain foils', () => {
    renderPreview(mk({ foil: true, finish: 'foil' }));
    expect(screen.getByText('Foil')).toBeTruthy();
  });

  it('renders no finish token for nonfoil cards', () => {
    renderPreview(mk({ foil: false }));
    expect(screen.queryByText('Foil')).toBeNull();
    expect(screen.queryByText('Oil slick')).toBeNull();
  });
});

describe('CardPreview turn (sideways layouts)', () => {
  it('toggles a split card right and back upright', () => {
    renderPreview(mk({ layout: 'split' }));
    const frame = screen.getByTestId('card-image-frame');
    expect(frame.getAttribute('data-turn')).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: 'Turn right to read' }));
    expect(frame.getAttribute('data-turn')).toBe('90');

    fireEvent.click(screen.getByRole('button', { name: 'Turn upright' }));
    expect(frame.getAttribute('data-turn')).toBe('0');
  });

  it('toggles an aftermath card left and back upright', () => {
    renderPreview(mk({ layout: 'aftermath' }));
    const frame = screen.getByTestId('card-image-frame');

    fireEvent.click(screen.getByRole('button', { name: 'Turn left to read' }));
    expect(frame.getAttribute('data-turn')).toBe('-90');

    fireEvent.click(screen.getByRole('button', { name: 'Turn upright' }));
    expect(frame.getAttribute('data-turn')).toBe('0');
  });

  it('toggles a Kamigawa flip card 180°', () => {
    renderPreview(mk({ layout: 'flip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn upside down' }));
    expect(screen.getByTestId('card-image-frame').getAttribute('data-turn')).toBe('180');
    expect(screen.getByRole('button', { name: 'Turn upright' })).toBeTruthy();
  });

  it('renders no Turn button for normal layout', () => {
    renderPreview(mk({ layout: 'normal' }));
    expect(screen.queryByRole('button', { name: /^Turn/ })).toBeNull();
  });
});
