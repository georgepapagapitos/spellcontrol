// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { isFirstRunExempt, useFirstRunGate } from './use-first-run-gate';
import { hasEverVisited, markEverVisited } from './first-run';
import type { AuthStatus } from '../store/auth';

beforeEach(() => {
  localStorage.clear();
});

/**
 * Tiny harness that mounts the gate and reports back the current pathname
 * via a data attribute — lets us assert what the gate did to routing
 * without instantiating the real App tree (and its 20+ page imports).
 */
function Harness({ status, initialPath }: { status: AuthStatus; initialPath: string }) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<GatedProbe status={status} />} />
      </Routes>
    </MemoryRouter>
  );
}

function GatedProbe({ status }: { status: AuthStatus }) {
  useFirstRunGate(status);
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname}</div>;
}

describe('isFirstRunExempt', () => {
  it.each([
    ['/welcome', true],
    ['/auth', true],
    ['/auth/choose-username', true],
    ['/s/abc123', true],
    // Regression: a first-time guest following a public link — /u, /d,
    // /gn/*, or the welcome hero's own "Browse public decks" CTA into
    // /decks/discover — used to get bounced straight back to `/` before the
    // target page ever painted, because this list only ever named `/s/`.
    // Every pathname App.tsx renders outside the auth gate (plus
    // /decks/discover, the one always-reachable public route inside
    // <Layout>) must stay exempt here.
    ['/u/alice', true],
    ['/d/some-deck-slug', true],
    ['/gn/some-token', true],
    ['/gn/s/some-series-token', true],
    ['/decks/discover', true],
    ['/collection', false],
    ['/decks', false],
    ['/', true],
    ['/settings', false],
  ])('%s -> %s', (path, expected) => {
    expect(isFirstRunExempt(path)).toBe(expected);
  });
});

describe('useFirstRunGate', () => {
  // E344: a first-time guest following a link into the app (a search result
  // to /rules, a friend's /search?q=) used to be bounced to `/` with the
  // destination lost. They land where the link pointed, and that arrival is
  // their first visit, so `/` takes them into the app from then on.
  it.each(['/collection', '/rules', '/search', '/tags'])(
    'lands a never-visited guest on %s and counts it as the first visit',
    (path) => {
      const { getByTestId } = render(<Harness status="guest" initialPath={path} />);
      expect(getByTestId('path').textContent).toBe(path);
      expect(hasEverVisited()).toBe(true);
    }
  );

  it('a shared link does not count as entering the app, so `/` still greets them', () => {
    render(<Harness status="guest" initialPath="/d/some-deck-slug" />);
    expect(hasEverVisited()).toBe(false);
  });

  it('marks nothing before auth resolves', () => {
    render(<Harness status="loading" initialPath="/rules" />);
    expect(hasEverVisited()).toBe(false);
  });

  it('does not redirect when the ever-visited flag is set', () => {
    markEverVisited();
    const { getByTestId } = render(<Harness status="guest" initialPath="/collection" />);
    expect(getByTestId('path').textContent).toBe('/collection');
  });

  it('does not redirect during the loading / unknown bootstrap phase', () => {
    // First-run flag is absent, but status hasn't resolved yet — must not
    // bounce the user because they may end up authed.
    const loading = render(<Harness status="loading" initialPath="/collection" />);
    expect(loading.getByTestId('path').textContent).toBe('/collection');
    loading.unmount();
    const unknown = render(<Harness status="unknown" initialPath="/collection" />);
    expect(unknown.getByTestId('path').textContent).toBe('/collection');
  });

  it('does not redirect when the user is authed', () => {
    const { getByTestId } = render(<Harness status="authed" initialPath="/collection" />);
    expect(getByTestId('path').textContent).toBe('/collection');
  });

  it('does not loop when already on /welcome as a first-run guest', () => {
    const { getByTestId } = render(<Harness status="guest" initialPath="/welcome" />);
    expect(getByTestId('path').textContent).toBe('/welcome');
  });

  it('does not loop when already on /auth as a first-run guest', () => {
    const { getByTestId } = render(<Harness status="guest" initialPath="/auth" />);
    expect(getByTestId('path').textContent).toBe('/auth');
  });

  it('keeps shared-link routes reachable for a first-run guest', () => {
    const { getByTestId } = render(<Harness status="guest" initialPath="/s/token-xyz" />);
    expect(getByTestId('path').textContent).toBe('/s/token-xyz');
  });

  // Regression for the bug fixed alongside the isFirstRunExempt table above:
  // these routes are exactly what a first-time guest reaches by following a
  // shared/public link (or, for /decks/discover, the welcome hero's own
  // "Browse public decks" CTA — which deliberately marks no visited flag) —
  // none of them may bounce back to `/`.
  it.each([
    '/u/alice',
    '/d/some-deck-slug',
    '/gn/some-token',
    '/gn/s/some-series-token',
    '/decks/discover',
  ])('keeps %s reachable for a first-run guest', (path) => {
    const { getByTestId } = render(<Harness status="guest" initialPath={path} />);
    expect(getByTestId('path').textContent).toBe(path);
  });
});
