// @vitest-environment happy-dom
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchPage } from './SearchPage';

const h = vi.hoisted(() => ({
  moveActive: vi.fn(),
  addActive: vi.fn(),
  onActiveChange: undefined as ((card: unknown) => void) | undefined,
}));

// The results block drags in the whole card-search stack (stores, carousel,
// scryfall client) — the syntax helper under test doesn't need any of it. The
// keyboard-nav tests below need the ref handle and onActiveChange forwarded
// the same way the real component does, so the mock wires those through too.
vi.mock('../components/InlineCardSearch', () => ({
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
