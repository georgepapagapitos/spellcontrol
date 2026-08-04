// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const shareMock = vi.fn();
vi.mock('@capacitor/share', () => ({ Share: { share: (o: unknown) => shareMock(o) } }));
const writeFileMock = vi.fn(async (o: { path: string }) => ({ uri: `file:///cache/${o.path}` }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: { writeFile: (o: { path: string }) => writeFileMock(o) },
}));
const fetchMock = vi.fn();
const nativeMock = vi.fn(() => false);
vi.mock('../lib/platform', () => ({
  isNativePlatform: () => nativeMock(),
  openExternal: vi.fn(),
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

  it('shows the condition when set', () => {
    renderPreview(mk({ condition: 'lp' }));
    const chip = screen.getByLabelText('Condition lp');
    expect(chip.textContent).toContain('LP');
  });

  it('omits the condition token when unset', () => {
    renderPreview(mk({}));
    expect(screen.queryByLabelText(/^Condition/)).toBeNull();
  });

  it('shows the full language name for a non-English printing', () => {
    renderPreview(mk({ language: 'ja' }));
    const chip = screen.getByLabelText('Language Japanese');
    expect(chip.textContent).toContain('Japanese');
  });

  it('omits the language token for English or an unset language', () => {
    const unset = renderPreview(mk({}));
    expect(screen.queryByLabelText(/^Language/)).toBeNull();
    unset.unmount();

    renderPreview(mk({ language: 'en' }));
    expect(screen.queryByLabelText(/^Language/)).toBeNull();
  });
});

describe('CardPreview share', () => {
  const flipCard = mk({
    name: 'Delver of Secrets',
    imageNormal: 'https://img/front-normal.jpg',
    imageLarge: 'https://img/front-large.jpg',
    imageNormalBack: 'https://img/back-normal.jpg',
  });

  beforeEach(() => {
    shareMock.mockClear();
    writeFileMock.mockClear();
    nativeMock.mockReturnValue(false);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ blob: async () => new Blob(['art'], { type: 'image/jpeg' }) });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('shares the image bytes for the face on screen, and follows a flip', async () => {
    const shared: File[] = [];
    vi.stubGlobal('navigator', navigator);
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      value: async (d: { files: File[] }) => shared.push(...d.files),
      configurable: true,
    });

    // The card-detail lookup shares the global fetch; only art URLs are ours.
    const artFetches = () =>
      fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('https://img/'));

    renderPreview(flipCard);
    fireEvent.click(screen.getByRole('button', { name: 'Share card image' }));
    await waitFor(() => expect(shared).toHaveLength(1));
    expect(artFetches()).toEqual(['https://img/front-large.jpg']);
    expect(shared[0].name).toBe('delver-of-secrets.jpg');

    fireEvent.click(screen.getByRole('button', { name: 'Show back face' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share card image' }));
    await waitFor(() => expect(shared).toHaveLength(2));
    // No back-large printing → falls back to the back's normal art.
    expect(artFetches()[1]).toBe('https://img/back-normal.jpg');
  });

  it('stages the file in the app cache dir and shares the URI on native', async () => {
    nativeMock.mockReturnValue(true);
    renderPreview(flipCard);
    fireEvent.click(screen.getByRole('button', { name: 'Share card image' }));

    await waitFor(() => expect(shareMock).toHaveBeenCalled());
    expect(writeFileMock.mock.calls[0][0]).toMatchObject({
      path: 'delver-of-secrets.jpg',
      directory: 'CACHE',
    });
    expect(shareMock.mock.calls[0][0]).toMatchObject({
      title: 'Delver of Secrets',
      files: ['file:///cache/delver-of-secrets.jpg'],
    });
  });

  it('renders no Share button for a card with no art', () => {
    renderPreview(mk({}));
    expect(screen.queryByRole('button', { name: 'Share card image' })).toBeNull();
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

  it('turns only the current slide — not other copies of the same printing', () => {
    // Two copies share a scryfallId; per-slide state must not bleed across.
    render(
      <MemoryRouter>
        <CardPreview
          cards={[
            mk({ layout: 'split', copyId: 'copy-1' }),
            mk({ layout: 'split', copyId: 'copy-2' }),
          ]}
          index={0}
          binderName=""
          sectionLabels={['', '']}
          pageNumbers={[0, 0]}
          totalPages={0}
          onIndexChange={() => {}}
          onClose={() => {}}
        />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Turn right to read' }));
    const turns = screen.getAllByTestId('card-image-frame').map((f) => f.getAttribute('data-turn'));
    expect(turns).toEqual(['90', '0']);
  });
});
