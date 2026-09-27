// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ImportRoutingSummary } from './ImportRoutingSummary';
import type { ImportRoutingSummary as Summary } from '../lib/import-routing';

function renderSummary(summary: Summary) {
  return render(
    <MemoryRouter>
      <ImportRoutingSummary summary={summary} />
    </MemoryRouter>
  );
}

describe('ImportRoutingSummary', () => {
  it('renders nothing when there is no routing story at all', () => {
    const { container } = renderSummary({ entries: [], totalRouted: 0, unroutedCount: 0 });
    expect(container.firstChild).toBeNull();
  });

  it('names the page(s) a routed entry landed on, compactly', () => {
    renderSummary({
      entries: [
        {
          binderId: 'b1',
          binderName: 'Commanders',
          binderColor: '#4ade80',
          count: 3,
          pages: [3, 4, 5],
        },
      ],
      totalRouted: 3,
      unroutedCount: 0,
    });
    expect(screen.getByText('Commanders')).toBeTruthy();
    expect(screen.getByText('pp. 3-5', { exact: false })).toBeTruthy();
  });

  it('omits the page detail entirely when an entry has none', () => {
    renderSummary({
      entries: [{ binderId: 'b1', binderName: 'Commanders', count: 1, pages: [] }],
      totalRouted: 1,
      unroutedCount: 0,
    });
    expect(screen.queryByText(/^p\.|^pp\./)).toBeNull();
  });

  it('the unrouted row keeps its own "Matched no binder" wording and carries no page detail', () => {
    renderSummary({ entries: [], totalRouted: 0, unroutedCount: 2 });
    expect(screen.getByText('Matched no binder')).toBeTruthy();
    expect(screen.queryByText(/^p\.|^pp\./)).toBeNull();
  });
});
