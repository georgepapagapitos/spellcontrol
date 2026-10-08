// @vitest-environment happy-dom
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchPage } from './SearchPage';
import { KEYWORD_GLOSSARY_URL } from '@/lib/cards/keyword-glossary';
import { RULES_GLOSSARY_URL } from '@/lib/cards/rules-glossary';

const h = vi.hoisted(() => ({
  moveActive: vi.fn(),
  addActive: vi.fn(),
  onActiveChange: undefined as ((card: unknown) => void) | undefined,
}));

// The results block drags in the whole card-search stack (stores, carousel,
// scryfall client) — the syntax helper under test doesn't need any of it. The
// keyboard-nav tests below need the ref handle and onActiveChange forwarded
// the same way the real component does, so the mock wires those through too.
vi.mock('@/components/search/InlineCardSearch', () => ({
  InlineCardSearch: forwardRef(function MockInlineCardSearch(
    props: { onActiveChange?: (card: unknown) => void },
    ref
  ) {
    useImperativeHandle(ref, () => ({ moveActive: h.moveActive, addActive: h.addActive }));
    useEffect(() => {
      h.onActiveChange = props.onActiveChange;
    }, [props.onActiveChange]);
    return <div data-testid="results" />;
  }),
}));

// The landing's rails have their own tests (components/browse); here they only
// have to be the landing, and step aside for results.
vi.mock('../components/browse/BrowseRails', () => ({
  BrowseRails: () => <div data-testid="browse-rails" />,
}));

function renderPage(initialEntry = '/search') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SearchPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SearchPage syntax helper', () => {
  it('starts collapsed and toggles the cheatsheet panel', () => {
    renderPage();
    const toggle = screen.getByRole('button', { name: /search syntax/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Card type')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Card type')).toBeTruthy();
    expect(screen.getByText('Negate any term')).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.queryByText('Card type')).toBeNull();
  });

  it('persists the open state to localStorage', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /search syntax/i }));
    expect(window.localStorage.getItem('mtg-search-syntax-collapsed')).toBe('0');
  });

  it('inserts a tapped example into the empty query and focuses the input', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /search syntax/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert t:dragon into the search' }));

    const input = screen.getByRole('textbox', { name: 'Search any card' });
    expect((input as HTMLInputElement).value).toBe('t:dragon');
    expect(document.activeElement).toBe(input);
  });

  it('appends a tapped example to an existing query with a space', () => {
    renderPage('/search?q=t%3Adragon');
    fireEvent.click(screen.getByRole('button', { name: /search syntax/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert r:mythic into the search' }));

    const input = screen.getByRole('textbox', { name: 'Search any card' });
    expect((input as HTMLInputElement).value).toBe('t:dragon r:mythic');
  });

  it('links to the full Scryfall syntax reference in a new tab', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /search syntax/i }));
    const link = screen.getByRole('link', { name: /full syntax reference/i });
    expect(link.getAttribute('href')).toBe('https://scryfall.com/docs/syntax');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('does not show "online" notes while searches are served live (no offline bundle)', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /search syntax/i }));
    expect(screen.queryByText('online')).toBeNull();
  });
});

describe('SearchPage landing', () => {
  it('shows the browse lists until there is a query, then the results in their place', () => {
    renderPage();
    expect(screen.getByTestId('browse-rails')).toBeTruthy();
    expect(screen.queryByTestId('results')).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search any card' }), {
      target: { value: 'sol ring' },
    });
    expect(screen.queryByTestId('browse-rails')).toBeNull();
    expect(screen.getByTestId('results')).toBeTruthy();
  });

  it('keeps the wide column for the rails whatever the saved result layout', () => {
    window.localStorage.setItem('mtg-search-view-mode', 'list');
    const { container } = renderPage();
    expect(container.querySelector('.search-page--wide')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search any card' }), {
      target: { value: 'sol ring' },
    });
    expect(container.querySelector('.search-page--wide')).toBeNull();
  });
});

describe('SearchPage query box', () => {
  // E339: the box renders its own state, not `params.get('q')` — a keystroke
  // round-tripping through the router lost characters typed faster than the
  // echo. The burst itself only misbehaves in a real browser, so its guard is
  // the journey's `/search?q=sol+ring` assert; what a DOM shim CAN hold is the
  // other half of that trade: the URL must still be able to drive the box.
  it('follows a Back/Forward move to another query', async () => {
    const router = createMemoryRouter([{ path: '/search', element: <SearchPage /> }], {
      initialEntries: ['/search?q=sol+ring', '/search?q=lightning+bolt'],
      initialIndex: 1,
    });
    render(<RouterProvider router={router} />);
    const input = screen.getByRole('textbox', { name: 'Search any card' }) as HTMLInputElement;
    expect(input.value).toBe('lightning bolt');

    await router.navigate(-1);
    await waitFor(() => expect(input.value).toBe('sol ring'));
  });
});

// T159/E457: SearchPage owns its own input and drives InlineCardSearch's
// results through the shared useResultsKeys wiring — see use-results-keys.ts
// for the composing/no-active-row guard, proved once there.
describe('SearchPage keyboard nav', () => {
  afterEach(() => {
    h.moveActive.mockClear();
    h.addActive.mockClear();
    h.onActiveChange = undefined;
  });

  it('moves the active result on Arrow keys and adds it on Enter once a result has gone active', async () => {
    renderPage();
    const input = screen.getByRole('textbox', { name: 'Search any card' });
    fireEvent.change(input, { target: { value: 'sol ring' } });
    await screen.findByTestId('results');
    act(() => h.onActiveChange?.({ id: 'a', name: 'Sol Ring' }));

    // The first arrow selects the top hit in place; later ones move.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(h.moveActive).toHaveBeenLastCalledWith(0);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(h.moveActive).toHaveBeenLastCalledWith(1);

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(h.moveActive).toHaveBeenCalledWith(-1);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.addActive).toHaveBeenCalledTimes(1);
  });

  it('leaves the keys alone before any result has gone active', () => {
    renderPage();
    const input = screen.getByRole('textbox', { name: 'Search any card' });
    fireEvent.change(input, { target: { value: 'sol ring' } });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(h.moveActive).not.toHaveBeenCalled();
    expect(h.addActive).not.toHaveBeenCalled();
  });

  // /search is a lookup page, not an add flow: CardSearchResults starts
  // active on row 0, so an Enter pressed out of habit right after typing
  // must not silently add it (board T159/E457 follow-up).
  it('requires an explicit arrow press before Enter adds, since this is a lookup page', async () => {
    renderPage();
    const input = screen.getByRole('textbox', { name: 'Search any card' });
    fireEvent.change(input, { target: { value: 'sol ring' } });
    await screen.findByTestId('results');
    act(() => h.onActiveChange?.({ id: 'a', name: 'Sol Ring' }));

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.addActive).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.addActive).toHaveBeenCalledTimes(1);
  });
});

describe('SearchPage rules', () => {
  // Shaped like the generated keyword glossary; the rule sentence is the real
  // Comprehensive Rules text for 702.21a.
  const GLOSSARY = {
    meta: { effective: 'September 25, 2026' },
    keywords: [
      {
        name: 'Ward',
        rule: '702.21',
        kind: 'ability',
        text: 'Ward [cost] means “Whenever this permanent becomes the target of a spell or ability an opponent controls, counter that spell or ability unless that player pays [cost].”',
      },
      {
        name: 'Scry',
        rule: '701.22',
        kind: 'action',
        text: 'To “scry N” means to look at the top N cards of your library.',
      },
    ],
  };
  // The glossary terms Search falls back to, shaped like rules-glossary.json.
  const TERMS = {
    meta: { effective: 'September 25, 2026' },
    terms: [
      {
        term: 'Priority',
        rule: '117',
        text: 'Which player can take actions at any given time is determined by a system of “priority.”',
      },
      {
        term: 'Ward',
        rule: '702.21',
        text: 'A keyword ability that can counter spells or abilities that target the permanent with ward.',
      },
    ],
  };
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      new Response(JSON.stringify(url === RULES_GLOSSARY_URL ? TERMS : GLOSSARY), {
        status: 200,
      })
    )
  );

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has a door to /rules beside the syntax helper', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Rules' }).getAttribute('href')).toBe('/rules');
  });

  it('puts the rule of a searched keyword above the cards, linking to it on /rules', async () => {
    renderPage('/search?q=ward');
    const hit = await screen.findByRole('link', { name: /Ward Keyword ability · 702\.21/ });
    expect(hit.getAttribute('href')).toBe('/rules?tab=keywords&q=Ward');
    expect(hit.textContent).toContain('Ward [cost] means');
    // The rule leads, the cards follow.
    expect(
      hit.compareDocumentPosition(screen.getByTestId('results')) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('falls back to a glossary term, linking to it on the Glossary tab', async () => {
    renderPage('/search?q=priority');
    const hit = await screen.findByRole('link', { name: /Priority Glossary · 117/ });
    expect(hit.getAttribute('href')).toBe('/rules?tab=glossary&q=Priority');
    expect(hit.textContent).toContain('determined by a system of');
  });

  it('answers a keyword as a keyword, never fetching the glossary', async () => {
    // A fresh module graph, so neither file is cached from an earlier test:
    // the glossary must wait for the keyword answer, not race it.
    vi.resetModules();
    const { SearchPage: Fresh } = await import('./SearchPage');
    fetchMock.mockClear();
    render(
      <MemoryRouter initialEntries={['/search?q=ward']}>
        <Fresh />
      </MemoryRouter>
    );
    expect(await screen.findByRole('link', { name: /Keyword ability/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Glossary/ })).toBeNull();
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toContain(KEYWORD_GLOSSARY_URL);
    expect(urls).not.toContain(RULES_GLOSSARY_URL);
  });

  it('reads a printed form of a keyword action', async () => {
    renderPage('/search?q=scried');
    expect(await screen.findByRole('link', { name: /Scry Keyword action · 701\.22/ })).toBeTruthy();
  });

  it('shows no rule for a card name, and never fetches the glossary for syntax', async () => {
    fetchMock.mockClear();
    renderPage('/search?q=t:dragon');
    expect(screen.getByTestId('results')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    renderPage('/search?q=Sol Ring');
    await waitFor(() => expect(screen.getAllByTestId('results')).toHaveLength(2));
    expect(screen.queryByRole('link', { name: /Keyword/ })).toBeNull();
  });
});
