// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { isFirstRunExempt, useFirstRunGate } from './use-first-run-gate';
import { markEverVisited } from './first-run';
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
    ['/oauth/callback', true],
    ['/s/abc123', true],
    ['/collection', false],
    ['/decks', false],
    ['/', true],
    ['/settings', false],
  ])('%s -> %s', (path, expected) => {
    expect(isFirstRunExempt(path)).toBe(expected);
  });
});

describe('useFirstRunGate', () => {
  it('redirects a never-visited guest from /collection to the root landing', () => {
    const { getByTestId } = render(<Harness status="guest" initialPath="/collection" />);
    expect(getByTestId('path').textContent).toBe('/');
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

  it('keeps the OAuth callback reachable for a first-run guest', () => {
    const { getByTestId } = render(<Harness status="guest" initialPath="/oauth/callback" />);
    expect(getByTestId('path').textContent).toBe('/oauth/callback');
  });
});
