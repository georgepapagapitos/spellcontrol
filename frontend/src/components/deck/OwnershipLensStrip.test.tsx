// @vitest-environment happy-dom
/**
 * Owning the whole deck is a non-event — the strip must stay silent rather
 * than spend the page's first row congratulating the viewer. It earns the row
 * only when something is missing (what, and what it costs).
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { OwnershipLensStrip } from './OwnershipLensStrip';
import type { OwnershipLens } from '../../lib/ownership-lens';

function lensWith(missing: string[]): OwnershipLens {
  return {
    ownedCount: 100 - missing.length,
    totalCount: 100,
    percentOwned: 100 - missing.length,
    missingCardNames: missing,
    perCard: new Map(),
  };
}

function renderStrip(lens: OwnershipLens) {
  return render(
    <MemoryRouter>
      <OwnershipLensStrip
        lens={lens}
        missingCost={12}
        missingCardPrices={new Map()}
        loading={false}
      />
    </MemoryRouter>
  );
}

describe('OwnershipLensStrip', () => {
  it('renders nothing when the viewer owns every card', () => {
    const { container } = renderStrip(lensWith([]));
    expect(container.firstChild).toBeNull();
  });

  it('still renders when cards are missing', () => {
    renderStrip(lensWith(['Sol Ring']));
    expect(screen.getByRole('button', { name: /owned in your collection/ })).toBeTruthy();
  });
});
