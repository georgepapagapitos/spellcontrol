// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

const reportError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/util/analytics', () => ({ reportError }));

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('boom: some cryptic internal exception');
  return <div>All good</div>;
}

describe('ErrorBoundary', () => {
  // React logs the caught error to console in dev; expected noise, not a
  // real failure signal for these tests.
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  afterEach(() => consoleErrorSpy.mockClear());

  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('All good')).toBeTruthy();
  });

  it('shows a fixed, friendly fallback — never the raw exception message', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    // The real message still reaches logger.error (console.error) for
    // diagnostics — it just never becomes user-facing copy.
    expect(screen.queryByText(/cryptic internal exception/)).toBeNull();
    // ...and the first-party beacon, so a render crash in production is
    // counted rather than invisible.
    expect(reportError).toHaveBeenCalledWith(
      'render',
      expect.objectContaining({ message: 'boom: some cryptic internal exception' })
    );
  });

  it('offers both a retry and a reload action, each with real button semantics', () => {
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });

    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('"Retry" clears the error so the tree re-renders past a since-fixed cause', () => {
    let shouldThrow = true;
    function Toggle() {
      return <Bomb shouldThrow={shouldThrow} />;
    }

    render(
      <ErrorBoundary>
        <Toggle />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText('All good')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// A deploy replaced the page's hashed chunk while this tab was open: the lazy
// import 404s, and re-rendering can never clear it. The 2026-09-28 task walk
// hit it twice on production, and "Retry" re-threw every time.
describe('ErrorBoundary: a chunk a deploy replaced', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const originalLocation = window.location;
  let reloadSpy: ReturnType<typeof vi.fn>;
  function StaleChunk(): never {
    throw new TypeError(
      'Failed to fetch dynamically imported module: https://spellcontrol.com/assets/HomePage-JNI35S0t.js'
    );
  }
  beforeEach(() => {
    sessionStorage.clear();
    reportError.mockClear();
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });
  });
  afterEach(() => {
    consoleErrorSpy.mockClear();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('reloads once for the new build and does not count it as a crash', () => {
    render(
      <ErrorBoundary>
        <StaleChunk />
      </ErrorBoundary>
    );
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('a second failure within the minute offers Reload, never a Retry that cannot work', () => {
    sessionStorage.setItem('sc-chunk-reload-at', String(Date.now()));
    render(
      <ErrorBoundary>
        <StaleChunk />
      </ErrorBoundary>
    );
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(screen.getByText('A new version is ready')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
