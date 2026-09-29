// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
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

// The rules sheet a keyword opens reads the rules bundle; a fixture, never the
// generated file.
vi.mock('../lib/comprehensive-rules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/comprehensive-rules')>()),
  loadRulesBundle: () =>
    Promise.resolve({
      meta: { effective: 'April 17, 2026', source: 'test' },
      sections: [],
      rules: [
        { number: '702.9', text: 'Flying' },
        { number: '702.9a', text: 'Flying is an evasion ability.' },
      ],
      glossary: [],
      keywords: [{ name: 'Flying', rule: '702.9', kind: 'ability' }],
    }),
}));

// "Played in" asks EDHREC; a stand-in shows where it lands and what it was given.
vi.mock('./PlayedInSection', () => ({
  PlayedInSection: ({ name }: { name: string }) => (
    <section data-testid="played-in">Played in {name}</section>
  ),
}));

const fetchMock = vi.fn();

import { CardPreview } from './CardPreview';
import { RulesReferenceSheet } from './RulesReferenceSheet';
import { useRulesReferenceStore } from '../store/rules-reference';
import { KEYWORD_GLOSSARY_URL } from '../lib/keyword-glossary';

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
    // The freshness stamp rides along in the copy section.
    expect(screen.getByText('Prices')).toBeTruthy();
  });

  it('renders NO money at all with hidePrice — not even the unknown-price dash', () => {
    // A friend's collection endpoint withholds price by contract, and
    // `formatMoney(undefined)` renders `—`, which is the placeholder that
    // ruling refuses. The whole monetary run has to go: amount, override
    // badge and the "Prices · Updated …" stamp.
    renderPreview(mk({ purchasePrice: 12.5, pricedAt: Date.now() }), { hidePrice: true });
    expect(document.body.textContent).not.toMatch(/\$|—|Prices/);
    // The rest of the meta line survives — this hides value, not identity.
    expect(screen.getByText('rare')).toBeTruthy();
  });
});

describe('CardPreview container line', () => {
  function renderIn(binderName: string, section: string) {
    return render(
      <MemoryRouter>
        <CardPreview
          cards={[mk({})]}
          index={0}
          binderName={binderName}
          sectionLabels={[section]}
          pageNumbers={[0]}
          totalPages={0}
          onIndexChange={() => {}}
          onClose={() => {}}
        />
      </MemoryRouter>
    );
  }

  it('joins a binder and its section', () => {
    renderIn('Rares', 'White');
    expect(document.body.textContent).toContain('Rares · White');
  });

  // The 2026-09-28 task walk: a list passes its own name as the section too,
  // and the footer read "My Wishlist · My Wishlist".
  it('never repeats a container named the same as its section', () => {
    renderIn('My Wishlist', 'My Wishlist');
    expect(document.body.textContent).toContain('My Wishlist');
    expect(document.body.textContent).not.toContain('My Wishlist · My Wishlist');
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

  it('opens rulings on every surface, fetched once the card settles', async () => {
    rulingsMock.mockClear();
    renderPreview(mk({ scryfallId: UUID, oracleText: 'Flying' }));
    expect(screen.getByRole('button', { name: /Rulings/ }).getAttribute('aria-expanded')).toBe(
      'true'
    );
    // Not on mount: swiping past a card must not fire its request.
    expect(rulingsMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/Dash does not change/)).toBeTruthy();
    expect(rulingsMock).toHaveBeenCalledTimes(1);
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
    expect(text).not.toMatch(/\$12\.50|Prices|TCGPlayer|1 of 1/);
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

describe('CardPreview action row (one line on a phone)', () => {
  // happy-dom has no layout, so the fit measurement can't run here; this pins
  // WHICH buttons the compact row may strip, which is the part a later edit
  // could quietly get wrong (STYLE_GUIDE: no icon-only on an ambiguous glyph).
  it('marks only the universal-glyph buttons compactable', () => {
    render(
      <MemoryRouter>
        <CardPreview
          cards={[mk({ imageNormal: 'front.jpg', imageNormalBack: 'back.jpg' })]}
          index={0}
          binderName=""
          sectionLabels={['']}
          pageNumbers={[0]}
          totalPages={0}
          onIndexChange={() => {}}
          onClose={() => {}}
          onEdit={() => {}}
          getActions={() => [
            {
              key: 'cover',
              icon: null,
              label: 'Set cover',
              shortLabel: 'Cover',
              onClick: () => {},
            },
            { key: 'cut', icon: null, label: 'Suggest cut', onClick: () => {} },
          ]}
        />
      </MemoryRouter>
    );
    const compactable = (name: string) =>
      screen.getByRole('button', { name }).hasAttribute('data-compactable');
    expect(compactable('Share card image')).toBe(true);
    expect(compactable('Edit printing')).toBe(true);
    expect(compactable('Set cover')).toBe(false);
    // Flip sits on the card's art (E421), always labelled, and never joins the
    // row it would crowd; the sheet handle isn't in the row either.
    const row = document.querySelector('.card-preview-actions')!;
    expect(row.contains(screen.getByRole('button', { name: 'Show back face' }))).toBe(false);
    expect(row.contains(screen.getByRole('button', { name: 'Show more details' }))).toBe(false);
    expect(compactable('Suggest cut')).toBe(false);

    // A short label is extra text for the compact row only; the full label
    // stays the accessible name.
    const cover = screen.getByRole('button', { name: 'Set cover' });
    expect(cover.hasAttribute('data-has-short')).toBe(true);
    expect(cover.querySelector('span[data-short]')?.textContent).toBe('Cover');
    expect(
      screen.getByRole('button', { name: 'Suggest cut' }).querySelector('span[data-short]')
    ).toBeNull();
  });
});

describe('CardPreview actions that hand the card on', () => {
  // A binder's "Move to binder" opens the move sheet; the preview it came from
  // closes as it runs, the way Edit does, rather than sitting under the sheet
  // showing a card that is about to leave the binder.
  it('closes the preview before running a closesPreview action', () => {
    const calls: string[] = [];
    render(
      <MemoryRouter>
        <CardPreview
          cards={[mk({})]}
          index={0}
          binderName=""
          sectionLabels={['']}
          pageNumbers={[0]}
          totalPages={0}
          onIndexChange={() => {}}
          onClose={() => calls.push('close')}
          getActions={() => [
            {
              key: 'move',
              label: 'Move to binder',
              icon: null,
              closesPreview: true,
              onClick: () => calls.push('move'),
            },
            { key: 'cover', label: 'Set cover', icon: null, onClick: () => calls.push('cover') },
          ]}
        />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set cover' }));
    expect(calls).toEqual(['cover']);
    fireEvent.click(screen.getByRole('button', { name: 'Move to binder' }));
    expect(calls).toEqual(['cover', 'close', 'move']);
  });
});

describe('CardPreview keyword links in the rules text', () => {
  // Layering: the popover and the rules sheet it opens sit above the preview
  // on the overlay stack. Escape answers the top layer only; before this, the
  // preview's capture-phase Escape closed the whole preview under them.
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url) === KEYWORD_GLOSSARY_URL
          ? new Response(
              JSON.stringify({
                meta: { effective: 'April 17, 2026' },
                keywords: [
                  {
                    name: 'Flying',
                    rule: '702.9',
                    kind: 'ability',
                    text: 'A creature with flying can’t be blocked except by creatures with flying and/or reach.',
                  },
                ],
              })
            )
          : new Response(null, { status: 404 })
      )
    );
    useRulesReferenceStore.setState({ isOpen: false, target: null });
  });

  const closing = () => document.querySelector('.card-preview-backdrop.is-closing');

  function renderWithSheet(card: EnrichedCard) {
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
        <RulesReferenceSheet />
      </MemoryRouter>
    );
  }

  it('Escape closes the keyword popover, not the preview under it', async () => {
    renderWithSheet(mk({ oracleText: 'Flying' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Flying' }));
    await screen.findByRole('dialog', { name: 'Flying' });
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Flying' })).toBeNull();
    expect(closing()).toBeNull();
    // With the popover gone, the preview answers Escape again.
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(closing()).not.toBeNull();
  });

  it('opens the rules sheet over the preview, and Escape there closes only the sheet', async () => {
    renderWithSheet(mk({ oracleText: 'Flying' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Flying' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Read the full rule' }));
    const sheet = await screen.findByRole('dialog', { name: 'Rules reference' });
    // Over the preview's overlay layer, not under it.
    expect(sheet.parentElement?.classList.contains('modal-backdrop--over-sheet')).toBe(true);
    // Searched to the keyword, with its row already open on the subrules.
    expect(await screen.findByText('Flying is an evasion ability.')).toBeTruthy();
    expect(screen.getByDisplayValue('Flying')).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Rules reference' })).toBeNull()
    );
    expect(closing()).toBeNull();
  });
});

// E481/T157: "Back closes the topmost overlay first." CardPreview gets this
// for free through `useSheetExit`'s registration with the shared overlay
// layer (overlay-layer.ts) — nothing CardPreview-specific is wired here. This
// exercises the REAL `window.history`/react-router integration, unlike the
// rest of this file's `MemoryRouter` renders, which never touch
// `window.history` at all and so can't see a stray route change.
describe('CardPreview — Back-button integration (E481)', () => {
  function ListPage({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(true);
    if (!open) return <div data-testid="preview-closed">closed</div>;
    return (
      <CardPreview
        cards={[mk({})]}
        index={0}
        binderName=""
        sectionLabels={['']}
        pageNumbers={[0]}
        totalPages={0}
        onIndexChange={() => {}}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
      />
    );
  }

  function renderOnRealHistory(onClose: () => void) {
    window.history.replaceState(null, '', '/lists/42');
    return render(
      <BrowserRouter>
        <Routes>
          <Route path="/lists/:id" element={<ListPage onClose={onClose} />} />
        </Routes>
      </BrowserRouter>
    );
  }

  /** Same as `renderOnRealHistory`, but with a real, distinct page underneath
   *  the list page — so "Back leaves" has somewhere real to leave TO. */
  function renderWithHomeBehind(onClose: () => void) {
    window.history.replaceState(null, '', '/');
    window.history.pushState(null, '', '/lists/42');
    return render(
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<div>home page</div>} />
          <Route path="/lists/:id" element={<ListPage onClose={onClose} />} />
        </Routes>
      </BrowserRouter>
    );
  }

  afterEach(() => {
    // See overlay-history.test.ts: `history.length` only ever grows, so
    // there's nothing to shrink between tests — just park the current entry
    // back on a clean, unflagged URL.
    window.history.replaceState(null, '', '/clean');
  });

  it('opened from a list page: one Back press closes it and the route is unchanged', async () => {
    const onClose = vi.fn();
    renderOnRealHistory(onClose);
    await screen.findByRole('dialog');
    const hrefBeforeBack = window.location.href;

    act(() => {
      window.history.back();
    });

    // The same close path Escape uses — `beginClose` — fired.
    expect(document.querySelector('.card-preview-backdrop.is-closing')).not.toBeNull();
    // React Router never re-rendered a different route: the URL is exactly
    // what it was (the marker entry shares the same href), and the page
    // component is still mounted (not replaced by a 404/route swap).
    expect(window.location.href).toBe(hrefBeforeBack);
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('coordinator sequence 1: Back closes, a second Back genuinely leaves to the real previous page — one press each, no extra one', async () => {
    const onClose = vi.fn();
    renderWithHomeBehind(onClose);
    await screen.findByRole('dialog');

    act(() => {
      window.history.back(); // closes
    });
    expect(document.querySelector('.card-preview-backdrop.is-closing')).not.toBeNull();
    expect(window.location.pathname).toBe('/lists/42'); // still here, not left

    act(() => {
      window.history.back(); // leaves — must reach home in this ONE press
    });
    await screen.findByText('home page');
    expect(window.location.pathname).toBe('/');
  });

  it('coordinator sequence 2: closing via ✕ then one Back press leaves to the real previous page', async () => {
    const onClose = vi.fn();
    renderWithHomeBehind(onClose);
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(document.querySelector('.card-preview-backdrop.is-closing')).not.toBeNull();
    expect(window.location.pathname).toBe('/lists/42'); // lazy — nothing moved
    // Let the close actually finish (the exit animation ending, same as a
    // real browser) before Back is pressed — the layer must have genuinely
    // unregistered, or the press below is ambiguous by construction (a Back
    // arriving mid-close-animation is a known, separate edge case, not what
    // this sequence is about).
    fireEvent.animationEnd(dialog, { animationName: 'sheet-fall' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    act(() => {
      window.history.back(); // must leave to home in ONE press, not two
    });
    await screen.findByText('home page');
    expect(window.location.pathname).toBe('/');
  });

  it('closing via the ✕ does not navigate — consumption is lazy, so nothing touches history at all', async () => {
    const onClose = vi.fn();
    renderOnRealHistory(onClose);
    await screen.findByRole('dialog');
    const hrefBeforeClose = window.location.href;

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(document.querySelector('.card-preview-backdrop.is-closing')).not.toBeNull();

    // Nothing was scheduled — the marked entry (if the close happens before
    // any navigation) is simply left in place; this is what avoids the race
    // where an eager `history.back()` could land after a same-tick or
    // later-microtask `navigate()` and undo it (see overlay-history.test.ts).
    expect(window.location.href).toBe(hrefBeforeClose);
  });

  it('closing via a context pill that also navigates (close + Link, same click) never triggers a stray back', async () => {
    const onClose = vi.fn();
    const backSpy = vi.spyOn(window.history, 'back');
    window.history.replaceState(null, '', '/lists/42');
    render(
      <BrowserRouter>
        <Routes>
          <Route
            path="/lists/:id"
            element={
              <CardPreview
                cards={[mk({})]}
                index={0}
                binderName=""
                sectionLabels={['']}
                pageNumbers={[0]}
                totalPages={0}
                onIndexChange={() => {}}
                onClose={onClose}
                getStackBinders={() => [{ id: 'b1', name: 'Rares', color: '#fff' }]}
              />
            }
          />
          <Route path="/collection/binders/:id" element={<div>binder page</div>} />
        </Routes>
      </BrowserRouter>
    );
    await screen.findByRole('dialog');

    // The pill's onClick calls the raw `onClose` prop directly (no exit
    // animation) in the same synchronous handler as the <Link>'s navigation.
    fireEvent.click(screen.getByRole('link', { name: 'Rares' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(backSpy).not.toHaveBeenCalled();
    await screen.findByText('binder page');
    backSpy.mockRestore();
  });
});

describe('CardPreview Played in section', () => {
  it('sits between the rules text and the printing', async () => {
    renderPreview(mk({ name: 'Sol Ring' }));
    const section = await screen.findByTestId('played-in');
    expect(section.textContent).toBe('Played in Sol Ring');
    const headings = [...document.body.querySelectorAll('h3, [data-testid="played-in"]')].map(
      (el) => (el.getAttribute('data-testid') === 'played-in' ? 'Played in' : el.textContent)
    );
    expect(headings.indexOf('Played in')).toBe(headings.indexOf('Rules text') + 1);
    expect(headings.indexOf('Printing')).toBe(headings.indexOf('Played in') + 1);
  });

  it('keys on the card name, so a name-only placeholder still gets one', async () => {
    renderPreview(mk({ name: 'Arcane Signet', scryfallId: '' }));
    expect((await screen.findByTestId('played-in')).textContent).toBe('Played in Arcane Signet');
  });

  it('is left out of the playtest inspector', async () => {
    renderPreview(mk({ name: 'Sol Ring' }), { source: 'playtest' });
    await screen.findByText('Rules text');
    // Give the lazy section every chance to appear.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('played-in')).toBeNull();
  });
});
