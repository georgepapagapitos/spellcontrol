// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { EnrichedCard } from '../types';

// Pending for the test's lifetime — the panel falls back to its text-only set
// line, and the test avoids an un-acted setState after teardown.
vi.mock('../lib/api', async () => {
  const { pending } = await import('@/test/pending');
  return { getSetMap: () => pending({}) };
});

// The image frame drags in the holographic tilt machinery; the detail panel
// under test doesn't need it.
vi.mock('./CardImageFrame', () => ({
  CardImageFrame: (p: {
    card: { name: string };
    turn?: number;
    mounted?: boolean;
    imgErrored: boolean;
    onImgError: () => void;
  }) => (
    <div
      data-testid="card-image-frame"
      data-name={p.card.name}
      data-turn={p.turn}
      data-mounted={String(p.mounted)}
      data-errored={String(p.imgErrored)}
    >
      <button type="button" onClick={p.onImgError}>
        break {p.card.name}
      </button>
    </div>
  ),
}));

const shareMock = vi.fn();
vi.mock('@capacitor/share', () => ({ Share: { share: (o: unknown) => shareMock(o) } }));
const writeFileMock = vi.fn(async (o: { path: string }) => ({ uri: `file:///cache/${o.path}` }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: { writeFile: (o: { path: string }) => writeFileMock(o) },
}));
// Rulings come from the backend; the playtest inspector opens them on mount,
// so the fetch is stubbed rather than left to hit the network.
const rulingsMock = vi.fn(async () => [
  {
    comment: 'Dash does not change when you may cast the spell.',
    published_at: '2015-02-25',
    source: 'wotc',
  },
]);
vi.mock('../lib/card-rulings', () => ({ fetchCardRulings: () => rulingsMock() }));

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

function renderPreview(
  card: EnrichedCard,
  props: { hidePrice?: boolean; source?: 'playtest'; renderPanelMeta?: () => ReactNode } = {}
) {
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
        {...props}
      />
    </MemoryRouter>
  );
}

describe('CardPreview hidePrice (friend-surface value contract)', () => {
  // The preview portals to document.body, so `container` is empty — asserting
  // against it would make the hidePrice case pass vacuously.
  it('shows the price by default', () => {
    renderPreview(mk({ purchasePrice: 12.5, pricedAt: Date.now() }));
    expect(document.body.textContent).toContain('$12.50');
  });

  it('renders NO money at all with hidePrice — not even the unknown-price dash', () => {
    // A friend's collection endpoint withholds price by contract, and
    // `formatMoney(undefined)` renders `—`, which is the placeholder that
    // ruling refuses. The whole monetary run has to go: amount, override
    // badge and the "Prices updated" stamp.
    renderPreview(mk({ purchasePrice: 12.5, pricedAt: Date.now() }), { hidePrice: true });
    expect(document.body.textContent).not.toMatch(/\$|—|Prices updated/);
    // The rest of the meta line survives — this hides value, not identity.
    expect(screen.getByText('rare')).toBeTruthy();
  });
});

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

  it('opens the share dialog instead of a silent download where the OS has no sheet', async () => {
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
    renderPreview(flipCard);
    fireEvent.click(screen.getByRole('button', { name: 'Share card image' }));

    // No art fetched yet, no system share — the user picks a destination first.
    expect(await screen.findByText('Share Delver of Secrets')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Save image/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copy image link/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Email/ })).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('https://img/'))
    ).toHaveLength(0);
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

describe('CardPreview slide mounting', () => {
  // Deck-analysis drill-downs (win conditions, curve, types) open name-only
  // placeholders with an empty scryfallId; enrichment swaps the real card in
  // later. The focused slide must mount on the first render regardless, or
  // the art stays blank until a swipe. Guard for the 2026-09-10 report.
  it('mounts the focused slide on open even when its card has no scryfallId yet', () => {
    renderPreview(mk({ scryfallId: '', name: 'Mischievous Mystic' }));
    expect(screen.getByTestId('card-image-frame').dataset.mounted).toBe('true');
  });

  // Image load/error state is keyed by scryfallId so the same printing in
  // two slides shares one load — but placeholders all carry '' and would
  // share one key too. They fall back to copyId: one placeholder's broken
  // image must not flag its neighbors "Image unavailable".
  it('keeps image-error state per slide for cards with no scryfallId', () => {
    const a = mk({ scryfallId: '', copyId: 'carousel:0:A', name: 'A', imageNormal: 'https://x/a' });
    const b = mk({ scryfallId: '', copyId: 'carousel:1:B', name: 'B', imageNormal: 'https://x/b' });
    render(
      <MemoryRouter>
        <CardPreview
          cards={[a, b]}
          index={0}
          binderName=""
          sectionLabels={['', '']}
          pageNumbers={[0, 0]}
          totalPages={1}
          onIndexChange={() => {}}
          onClose={() => {}}
        />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'break A' }));
    const frames = screen.getAllByTestId('card-image-frame');
    const byName = Object.fromEntries(frames.map((f) => [f.dataset.name, f.dataset.errored]));
    expect(byName).toEqual({ A: 'true', B: 'false' });
  });
});

describe('CardPreview playtest inspector (rules first, no shop talk)', () => {
  const UUID = '00000000-0000-4000-8000-000000000001';

  it('leads with rules text and opens rulings without a second tap', async () => {
    renderPreview(mk({ scryfallId: UUID, oracleText: 'Flying' }), { source: 'playtest' });
    expect(await screen.findByText(/Dash does not change/)).toBeTruthy();
    // The disclosure is genuinely open, not just loaded behind a chevron.
    expect(screen.getByRole('button', { name: /Rulings/ }).getAttribute('aria-expanded')).toBe(
      'true'
    );
    // Rules text sits ABOVE the printing facts — the reason the card was opened.
    const panel = document.getElementById('card-preview-panel-inner')!;
    const text = panel.textContent ?? '';
    expect(text.indexOf('Flying')).toBeLessThan(text.indexOf('Test Set'));
  });

  it('keeps rulings collapsed on every other surface', () => {
    renderPreview(mk({ scryfallId: UUID, oracleText: 'Flying' }));
    expect(screen.getByRole('button', { name: /Rulings/ }).getAttribute('aria-expanded')).toBe(
      'false'
    );
  });

  it('drops price, copy condition and the carousel counter at a game table', () => {
    renderPreview(
      mk({
        scryfallId: UUID,
        purchasePrice: 12.5,
        pricedAt: Date.now(),
        condition: 'lp',
        oracleText: 'Flying',
      }),
      { source: 'playtest' }
    );
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\$12\.50|Prices updated|TCGPlayer|Card 1 of 1/);
    expect(screen.queryByLabelText(/^Condition/)).toBeNull();
    // Printing identity survives as the footer: it answers "which printing".
    expect(screen.getByText('(TST)')).toBeTruthy();
    expect(screen.getByText('rare')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Scryfall/ })).toBeTruthy();
  });

  it('renders the live board state the caller supplies', () => {
    renderPreview(mk({ scryfallId: UUID }), {
      source: 'playtest',
      renderPanelMeta: () => <span>Tapped</span>,
    });
    expect(screen.getByText('Tapped')).toBeTruthy();
  });
});
