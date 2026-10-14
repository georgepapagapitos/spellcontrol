// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { makeDeckAllocationInfo } from '@/lib/collection/allocations-core';
import { breakdownCopies } from '@/lib/collection/copy-locations';
import { PreviewContextLine } from './CardPreviewContext';

afterEach(cleanup);

const burn = makeDeckAllocationInfo('d1', 'Mono-Red Burn', '#b3392f', 'Lightning Bolt');
const red = { id: 'b1', name: 'Red Spells', color: '#a8452a' };
const modern = { id: 'b2', name: 'Modern Staples', color: '#2f6f8f' };

// 1 copy in the deck (its pocket kept in Red Spells), 2 more in Red Spells,
// 1 in Modern Staples, 1 in nothing.
const places = breakdownCopies(
  ['c1', 'c2', 'c3', 'c4', 'c5'],
  new Map([['c1', burn]]),
  new Map([
    ['c1', red],
    ['c2', red],
    ['c3', red],
    ['c4', modern],
  ])
);

function renderLine(props: Partial<Parameters<typeof PreviewContextLine>[0]>) {
  render(
    <MemoryRouter>
      <PreviewContextLine
        words="Collection"
        binders={[red, modern]}
        allocations={[burn]}
        listings={[]}
        places={undefined}
        qty={5}
        onClose={vi.fn()}
        {...props}
      />
    </MemoryRouter>
  );
}

describe('PreviewContextLine', () => {
  it('counts every pill from the same breakdown as the tile', () => {
    renderLine({ places });
    expect(screen.getByRole('link', { name: 'Red Spells, 2 copies' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Modern Staples, 1 copy' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'In deck: Mono-Red Burn, 1 copy' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '5 copies' })).toBeTruthy();
  });

  it('drops a binder whose only copy is out in a deck', () => {
    const pulled = breakdownCopies(
      ['c1', 'c2'],
      new Map([['c1', burn]]),
      new Map([
        ['c1', red],
        ['c2', modern],
      ])
    );
    renderLine({ places: pulled, qty: 2 });
    expect(screen.queryByRole('link', { name: /Red Spells/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Modern Staples, 1 copy' })).toBeTruthy();
  });

  it('leaves a single copy uncounted', () => {
    const one = breakdownCopies(['c1'], new Map(), new Map([['c1', red]]));
    renderLine({ places: one, qty: 1, allocations: [] });
    const pill = screen.getByRole('link', { name: 'Red Spells' });
    expect(pill.textContent).toBe('Red Spells');
  });

  it('counts the copies in no place, so the pills add up to the stack', () => {
    renderLine({ places });
    const loose = screen.getByRole('link', { name: 'Uncategorized, 1 copy' });
    expect(loose.getAttribute('href')).toBe('/collection?binder=__uncategorized');
  });

  it('splits one printing across two decks and a loose copy', () => {
    const pauper = makeDeckAllocationInfo('d2', 'Pauper Burn', '#c0392b', 'Lightning Bolt');
    const split = breakdownCopies(
      ['c1', 'c2', 'c3', 'c4'],
      new Map([
        ['c1', pauper],
        ['c2', pauper],
        ['c3', burn],
      ]),
      new Map()
    );
    renderLine({ places: split, qty: 4, binders: [], allocations: [pauper, pauper, burn] });
    expect(screen.getByRole('link', { name: 'In deck: Pauper Burn, 2 copies' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'In deck: Mono-Red Burn, 1 copy' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Uncategorized, 1 copy' })).toBeTruthy();
  });

  it('shows no Uncategorized pill when every copy has a place', () => {
    const filed = breakdownCopies(
      ['c1', 'c2', 'c3'],
      new Map([['c1', burn]]),
      new Map([
        ['c2', red],
        ['c3', red],
      ])
    );
    renderLine({ places: filed, qty: 3, binders: [red] });
    expect(screen.getByRole('link', { name: 'Red Spells, 2 copies' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Uncategorized/ })).toBeNull();
  });

  it('names a single loose copy without a count', () => {
    const one = breakdownCopies(['c1'], new Map(), new Map());
    renderLine({ places: one, qty: 1, binders: [], allocations: [] });
    expect(screen.getByRole('link', { name: 'Uncategorized' }).textContent).toBe('Uncategorized');
  });

  it('keeps the uncounted pills where no breakdown is given', () => {
    renderLine({});
    expect(screen.getByRole('link', { name: 'Red Spells' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'In deck: Mono-Red Burn' })).toBeTruthy();
  });
});
