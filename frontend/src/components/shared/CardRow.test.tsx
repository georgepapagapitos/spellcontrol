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

function renderRow(qty: number, overrides: Partial<EnrichedCard> = {}) {
  return render(
    <MemoryRouter>
      <CardRow
        card={card(overrides)}
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

  it('renders a condition chip with the short abbreviation and full-word title/aria-label', () => {
    const { container } = renderRow(1, { condition: 'lp' });
    const chip = container.querySelector('.card-list-condition');
    expect(chip?.textContent).toBe('LP');
    expect(chip?.getAttribute('title')).toBe('Lightly Played');
    expect(chip?.getAttribute('aria-label')).toBe('Lightly Played');
  });

  it("abbreviates 'damaged' condition to DMG", () => {
    const { container } = renderRow(1, { condition: 'damaged' });
    expect(container.querySelector('.card-list-condition')?.textContent).toBe('DMG');
  });

  it('renders no condition chip when the copy has no condition set', () => {
    const { container } = renderRow(1);
    expect(container.querySelector('.card-list-condition')).toBeNull();
  });

  it('renders no condition chip for Near Mint — deviations only, NM is the unmarked norm', () => {
    const { container } = renderRow(1, { condition: 'nm' });
    expect(container.querySelector('.card-list-condition')).toBeNull();
  });

  it('renders no language chip for English or an unset language', () => {
    const noLang = renderRow(1);
    expect(noLang.container.querySelector('.card-list-language')).toBeNull();
    noLang.unmount();

    const english = renderRow(1, { language: 'en' });
    expect(english.container.querySelector('.card-list-language')).toBeNull();
  });

  it('renders the full language name for a non-English printing', () => {
    const { container } = renderRow(1, { language: 'ja' });
    expect(container.querySelector('.card-list-language')?.textContent).toBe('Japanese');
  });
});
