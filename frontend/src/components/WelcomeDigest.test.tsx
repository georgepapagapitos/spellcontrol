// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDigestBaseline,
  isDigestDismissedThisSession,
  logBinderMoves,
  markDigestDismissedThisSession,
  setDigestBaseline,
} from '../lib/welcome-digest';
import { WelcomeDigest } from './WelcomeDigest';

function mount(value: number, refreshing = false) {
  return render(
    <MemoryRouter>
      <WelcomeDigest value={value} refreshing={refreshing} />
    </MemoryRouter>
  );
}

/** happy-dom's default viewport (1024px) matches `(min-width: 1024px)`, which
 *  is the sheet's "desktop, no exit animation" branch — stub matchMedia to
 *  force the mobile branch so the symmetric-exit wiring is exercised. */
function stubNarrowViewport() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('WelcomeDigest', () => {
  it('renders nothing on first run and silently stamps a baseline', async () => {
    const { container } = mount(500);
    await waitFor(() => expect(getDigestBaseline()?.value).toBe(500));
    expect(container.querySelector('.welcome-digest-strip')).toBeNull();
  });

  it('does not stamp a baseline while pricing is still settling', () => {
    mount(0, true);
    expect(getDigestBaseline()).toBeNull();
  });

  it('shows the strip with the value delta since the baseline', () => {
    setDigestBaseline(100, Date.now() - 86400000);
    mount(118);
    expect(screen.getByRole('button', { name: /Since your last visit/ })).toBeTruthy();
    expect(screen.getByText(/\+\$18/)).toBeTruthy();
  });

  it('renders nothing when the delta is under a dollar and nothing moved', () => {
    setDigestBaseline(100, Date.now() - 86400000);
    const { container } = mount(100.3);
    expect(container.querySelector('.welcome-digest-strip')).toBeNull();
  });

  it('counts binder moves in the pill and lists them in the sheet', async () => {
    setDigestBaseline(100, Date.now() - 86400000);
    logBinderMoves([{ cardName: 'Sol Ring', fromBinder: 'Bulk', toBinder: 'High Value' }]);
    mount(100);
    expect(screen.getByText('1 moved')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Since your last visit/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Since your last visit' });
    expect(dialog.textContent).toContain('Sol Ring');
    expect(dialog.textContent).toContain('High Value');
    expect(dialog.textContent).toContain('1 card moved between binders');
  });

  it('"Got it" re-baselines, dismisses for the session, and removes the strip', async () => {
    setDigestBaseline(100, Date.now() - 86400000);
    const { container } = mount(150);
    fireEvent.click(screen.getByRole('button', { name: /Since your last visit/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Got it' }));

    expect(container.querySelector('.welcome-digest-strip')).toBeNull();
    expect(getDigestBaseline()?.value).toBe(150);
    expect(isDigestDismissedThisSession()).toBe(true);
  });

  it('stays hidden for the rest of the session once dismissed', () => {
    setDigestBaseline(100, Date.now() - 86400000);
    markDigestDismissedThisSession();
    const { container } = mount(150);
    expect(container.querySelector('.welcome-digest-strip')).toBeNull();
  });

  // Symmetric exit (STYLE_GUIDE "Motion"): on a mobile viewport the sheet
  // rises with `binder-sheet-slide`, so every dismiss — including "Got it",
  // which also re-baselines — must play the mirrored `binder-sheet-slide-out`
  // before the close-time side effects commit, not unmount instantly.
  it('plays the exit animation on a mobile viewport before "Got it" commits', async () => {
    stubNarrowViewport();
    setDigestBaseline(100, Date.now() - 86400000);
    const { container } = mount(150);
    fireEvent.click(screen.getByRole('button', { name: /Since your last visit/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Got it' }));

    const sheet = container.querySelector('.welcome-digest-sheet') as HTMLElement;
    expect(sheet.className).toContain('is-closing');
    expect(getDigestBaseline()?.value).toBe(100); // re-baseline not yet committed

    fireEvent.animationEnd(sheet, { animationName: 'binder-sheet-slide-out' });
    expect(getDigestBaseline()?.value).toBe(150);
    expect(container.querySelector('.welcome-digest-strip')).toBeNull();
  });

  it('plays the exit animation on a mobile viewport on backdrop dismiss', async () => {
    stubNarrowViewport();
    setDigestBaseline(100, Date.now() - 86400000);
    const { container } = mount(150);
    fireEvent.click(screen.getByRole('button', { name: /Since your last visit/ }));
    await screen.findByRole('dialog', { name: 'Since your last visit' });

    fireEvent.click(container.querySelector('.welcome-digest-sheet-root') as Element);
    const sheet = container.querySelector('.welcome-digest-sheet') as HTMLElement;
    expect(sheet.className).toContain('is-closing');
    expect(screen.queryByRole('dialog')).toBeTruthy(); // still mounted mid-animation

    fireEvent.animationEnd(sheet, { animationName: 'binder-sheet-slide-out' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
