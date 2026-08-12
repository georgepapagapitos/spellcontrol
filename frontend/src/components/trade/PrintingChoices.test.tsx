// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PrintingChoices, describePrinting } from './PrintingChoices';
import { groupByPrinting, type OwnedTradeLine } from '../../lib/trade-picker';
import { useDecksStore } from '../../store/decks';
import type { EnrichedCard } from '../../types';

function copy(overrides: Partial<EnrichedCard> & { copyId: string }): EnrichedCard {
  return {
    name: 'Sol Ring',
    oracleId: 'sol',
    setCode: 'lea',
    setName: 'Limited Edition Alpha',
    collectorNumber: '233',
    rarity: 'uncommon',
    // Per PRINTING, not per copy — two copies of the same printing share it,
    // which is what makes them one row.
    scryfallId: 'sf-lea-233',
    purchasePrice: 12.4,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    typeLine: 'Artifact',
    imageSmall: 'https://cards.example/lea-233.jpg',
    ...overrides,
  } as EnrichedCard;
}

/** Two printings: one LEA copy and two CMR copies. */
const line: OwnedTradeLine = {
  oracleId: 'sol',
  name: 'Sol Ring',
  copies: [
    copy({ copyId: 'lea-1' }),
    copy({
      copyId: 'cmr-1',
      scryfallId: 'sf-cmr-41',
      setCode: 'cmr',
      collectorNumber: '41',
      purchasePrice: 2.1,
      imageSmall: 'https://cards.example/cmr-41.jpg',
    }),
    copy({
      copyId: 'cmr-2',
      scryfallId: 'sf-cmr-41',
      setCode: 'cmr',
      collectorNumber: '41',
      purchasePrice: 2.1,
      imageSmall: 'https://cards.example/cmr-41.jpg',
    }),
  ],
};

const groups = groupByPrinting(line);
const cmr = groups.find((g) => g.setCode === 'cmr')!;
const lea = groups.find((g) => g.setCode === 'lea')!;

function mount(props: Partial<Parameters<typeof PrintingChoices>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PrintingChoices
        cardName="Sol Ring"
        groups={groups}
        countOf={() => 0}
        label="Sol Ring — your printings"
        {...props}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useDecksStore.setState({ decks: [] });
});

describe('describePrinting', () => {
  it('names the printing, dropping the parts that are the norm', () => {
    expect(describePrinting(lea)).toBe('LEA · #233');
    expect(describePrinting({ ...lea, finish: 'foil', condition: 'lp' })).toBe(
      'LEA · #233 · foil · lp'
    );
  });
});

describe('PrintingChoices', () => {
  it('shows each printing with its own art, not a bare text line', () => {
    // The whole reason this replaced two text-only lists: you pick a printing
    // by looking at it.
    mount();
    const art = [...document.querySelectorAll('img.printing-choice-art')];
    // Cheapest printing first, each showing its OWN art — the whole point is
    // telling one printing from another.
    expect(art.map((el) => el.getAttribute('src'))).toEqual([
      'https://cards.example/cmr-41.jpg',
      'https://cards.example/lea-233.jpg',
    ]);
  });

  it('counts chosen against owned per printing', () => {
    mount({ countOf: (g) => (g.key === cmr.key ? 1 : 0) });
    expect(screen.getByText('/2')).toBeTruthy(); // two CMR copies owned
    expect(screen.getByText('/1')).toBeTruthy(); // one LEA copy owned
  });

  it('steps a printing up and down by its own key', () => {
    const onSet = vi.fn();
    mount({ onSet, countOf: (g) => (g.key === cmr.key ? 1 : 0) });
    fireEvent.click(screen.getByLabelText(`One more ${describePrinting(cmr)} Sol Ring`));
    expect(onSet).toHaveBeenCalledWith(cmr.key, 2);
    fireEvent.click(screen.getByLabelText(`One fewer ${describePrinting(cmr)} Sol Ring`));
    expect(onSet).toHaveBeenCalledWith(cmr.key, 0);
  });

  it('cannot step past what is owned, or below nothing', () => {
    mount({ onSet: vi.fn(), countOf: (g) => (g.key === cmr.key ? 2 : 0) });
    expect(
      screen.getByLabelText(`One more ${describePrinting(cmr)} Sol Ring`).hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen.getByLabelText(`One fewer ${describePrinting(lea)} Sol Ring`).hasAttribute('disabled')
    ).toBe(true);
  });

  it('drops the steppers entirely when there is nothing to set', () => {
    // The accept dialog's single-printing case — a receipt, not a control.
    mount();
    expect(screen.queryByLabelText(/One more/)).toBeNull();
    expect(screen.getByText('/2')).toBeTruthy(); // still says what leaves
  });

  it('flags a printing whose copies are checked out to a deck', () => {
    useDecksStore.setState({
      decks: [
        {
          id: 'd1',
          name: 'Atraxa',
          color: '#0f0',
          cards: [{ id: 's1', card: { name: 'Sol Ring' }, allocatedCopyId: 'lea-1' }],
        },
      ] as never,
    });
    mount();
    expect(screen.getByLabelText('In deck: Atraxa')).toBeTruthy();
  });

  it('flags a printing sitting in a binder, without a way to navigate out of the dialog', () => {
    mount({ binderByCopyId: new Map([['cmr-1', [{ id: 'b1', name: 'Staples', color: '#abc' }]]]) });
    const badge = screen.getByLabelText('In binder: Staples');
    // A link/button here would abandon the offer being composed.
    expect(badge.tagName).toBe('SPAN');
  });
});
