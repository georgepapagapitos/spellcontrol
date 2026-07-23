// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

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

  it('"Try again" clears the error so the tree re-renders past a since-fixed cause', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('All good')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
