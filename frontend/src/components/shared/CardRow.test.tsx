// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { EnrichedCard } from '../../types';
import { CardRow } from './CardRow';

function card(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'copy-1',
    name: 'A Killer Among Us',
    setCode: 'MKM',
    setName: 'Murders at Karlov Manor',
    collectorNumber: '167',
    rarity: 'uncommon',
    scryfallId: 'sf-1',
    purchasePrice: 0.13,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Creature',
    manaCost: '{3}{G}',
    ...overrides,
  };
}

function renderRow(qty: number) {
  return render(
    <MemoryRouter>
      <CardRow
        card={card()}
        qty={qty}
        allocations={[]}
        menu={<button type="button">Card actions</button>}
        onActivate={() => {}}
      />
    </MemoryRouter>
  );
}

describe('CardRow', () => {
  it('keeps a quantity slot for single-copy rows so trailing actions align', () => {
    const single = renderRow(1);
    const singleQty = single.container.querySelector('.collection-list-qty');

    expect(singleQty).toBeTruthy();
    expect(singleQty?.textContent).toBe('');
    expect(singleQty?.getAttribute('aria-hidden')).toBe('true');
    single.unmount();

    const multiple = renderRow(4);
    const multipleQty = multiple.container.querySelector('.collection-list-qty');

    expect(multipleQty?.textContent).toBe('×4');
    expect(multipleQty?.getAttribute('aria-hidden')).toBe('false');
  });
});
