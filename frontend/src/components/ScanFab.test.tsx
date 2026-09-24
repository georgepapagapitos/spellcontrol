// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/use-can-scan', () => ({
  useCanScan: vi.fn(() => false),
}));

vi.mock('./CardScanner', () => ({
  CardScanner: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="card-scanner">
      <button type="button" onClick={onClose}>
        close-scanner
      </button>
    </div>
  ),
}));

import { useCanScan } from '../lib/use-can-scan';
import { ScanFab } from './ScanFab';

function setPhone(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: phone && query.includes('max-width: 600px'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function renderFab(path = '/collection', scrollEl?: HTMLElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ScanFab scrollEl={scrollEl} />
    </MemoryRouter>
  );
}

beforeEach(() => setPhone(true));
afterEach(() => vi.unstubAllGlobals());

describe('ScanFab', () => {
  it('renders nothing when the device cannot scan', () => {
    vi.mocked(useCanScan).mockReturnValue(false);
    const { container } = renderFab();
    expect(container.firstChild).toBeNull();
  });

  it('renders a single direct Scan action with no speed-dial/menu semantics', () => {
    vi.mocked(useCanScan).mockReturnValue(true);
    renderFab();
    expect(screen.getByRole('button', { name: 'Scan cards' })).toBeTruthy();
    // No NAV_ITEMS-shaped destinations or disclosure-widget semantics remain.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByLabelText('Open navigation')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('opens CardScanner directly on tap — no intermediate expand step', async () => {
    vi.mocked(useCanScan).mockReturnValue(true);
    renderFab();
    expect(screen.queryByTestId('card-scanner')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Scan cards' }));
    await waitFor(() => expect(screen.getByTestId('card-scanner')).toBeTruthy());
  });

  // T135: the collection pages on a phone, and nowhere else.
  it('shows on every collection page, and on no other route', () => {
    vi.mocked(useCanScan).mockReturnValue(true);
    for (const path of ['/collection', '/collection/binders/b1', '/collection/lists']) {
      const { unmount } = renderFab(path);
      expect(screen.queryByRole('button', { name: 'Scan cards' }), path).not.toBeNull();
      unmount();
    }
    for (const path of ['/home', '/decks', '/decks/deck_1', '/play', '/you']) {
      const { container, unmount } = renderFab(path);
      expect(container.firstChild, path).toBeNull();
      unmount();
    }
  });

  it('is phone-only: a tablet reaches the scanner through Add cards', () => {
    vi.mocked(useCanScan).mockReturnValue(true);
    setPhone(false);
    const { container } = renderFab('/collection');
    expect(container.firstChild).toBeNull();
  });

  it('tucks away while the page scrolls down and comes back on the way up', () => {
    vi.mocked(useCanScan).mockReturnValue(true);
    const scroller = document.createElement('div');
    renderFab('/collection', scroller);
    const button = screen.getByRole('button', { name: 'Scan cards' });
    const scrollTo = (y: number) => {
      scroller.scrollTop = y;
      fireEvent.scroll(scroller);
    };
    scrollTo(40); // still near the top
    expect(button.classList.contains('is-tucked')).toBe(false);
    scrollTo(400);
    expect(button.classList.contains('is-tucked')).toBe(true);
    scrollTo(404); // under the slop: no flicker
    expect(button.classList.contains('is-tucked')).toBe(true);
    scrollTo(300);
    expect(button.classList.contains('is-tucked')).toBe(false);
    scrollTo(600);
    scrollTo(20); // back near the top
    expect(button.classList.contains('is-tucked')).toBe(false);
  });

  it('never tucks while it holds keyboard focus', () => {
    vi.mocked(useCanScan).mockReturnValue(true);
    const scroller = document.createElement('div');
    renderFab('/collection', scroller);
    const button = screen.getByRole('button', { name: 'Scan cards' });
    button.focus();
    scroller.scrollTop = 500;
    fireEvent.scroll(scroller);
    expect(button.classList.contains('is-tucked')).toBe(false);
  });
});
