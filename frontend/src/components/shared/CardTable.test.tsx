// @vitest-environment happy-dom
/**
 * The card table's header and its cells used to be two hand-synced lists in
 * two files — `CardListTable`'s `TABLE_COLUMNS` and `CardRow`'s table branch
 * — held together by a comment asking the next person to keep them in the
 * same order. This guard is what replaced the comment: for every surface
 * preset, the header and a row must emit the same columns, in the same order,
 * with the same tier, and the grid template must have exactly one track per
 * column.
 *
 * A column added to `CARD_TABLE_COLUMNS` without a cell in `CardRow` fails to
 * compile (the cell record is exhaustive over the union). A column added to a
 * preset but rendered out of order, or a track that doesn't line up with the
 * cells, fails here.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EnrichedCard } from '../../types';
import { CardRow } from './CardRow';
import {
  BINDER_TABLE_COLUMNS,
  CARD_TABLE_COLUMNS,
  CardTableFrame,
  CardTableHead,
  COLLECTION_TABLE_COLUMNS,
  LIST_TABLE_COLUMNS,
  LIST_TABLE_COLUMNS_WITH_TARGET,
  SHARED_TABLE_COLUMNS,
  cardTableTemplate,
  orderColumns,
  type CardTableCol,
} from './CardTable';

const PRESETS: Array<[string, readonly CardTableCol[]]> = [
  ['collection', COLLECTION_TABLE_COLUMNS],
  ['binder', BINDER_TABLE_COLUMNS],
  ['list', LIST_TABLE_COLUMNS],
  ['list (want)', LIST_TABLE_COLUMNS_WITH_TARGET],
  ['shared', SHARED_TABLE_COLUMNS],
];

const card = {
  copyId: 'c1',
  scryfallId: 'sf-1',
  name: 'Test Card',
  setCode: 'TST',
  setName: 'Test Set',
  collectorNumber: '42',
  rarity: 'rare',
  condition: 'nm',
  language: 'en',
  manaCost: '{2}{G}',
  cmc: 3,
  typeLine: 'Creature — Test',
  purchasePrice: 1.5,
  notes: 'for trade',
  finish: 'nonfoil',
  foil: false,
} as unknown as EnrichedCard;

const colsOf = (root: Element, selector: string) =>
  [...root.querySelectorAll(`${selector} > [data-col]`)].map((el) => ({
    col: el.getAttribute('data-col'),
    tier: el.getAttribute('data-tier'),
  }));

describe.each(PRESETS)('the %s table preset', (_name, columns) => {
  it('renders the same columns, in the same order, in the header and the row', () => {
    const { container } = render(
      <MemoryRouter>
        <CardTableFrame columns={columns}>
          <CardTableHead columns={columns} />
          <div className="collection-list is-table">
            <CardRow
              card={card}
              qty={2}
              columns={columns}
              allocations={[]}
              menu={null}
              pageNum={3}
              targetPriceSlot={<span>target</span>}
              onActivate={() => {}}
            />
          </div>
        </CardTableFrame>
      </MemoryRouter>
    );
    const head = colsOf(container, '.collection-table-head');
    const row = colsOf(container, '.collection-table-row');
    expect(head.map((c) => c.col)).toEqual([...columns]);
    expect(row).toEqual(head);
  });

  it('has one grid track per column', () => {
    const tracks = cardTableTemplate(columns).split(' ');
    expect(tracks).toHaveLength(columns.length);
    expect(tracks).toEqual(columns.map((c) => `var(--ct-w-${c})`));
    // Select mode prepends the checkbox gutter and nothing else.
    expect(cardTableTemplate(columns, true).split(' ')).toHaveLength(columns.length + 1);
  });

  it('is in the canonical order', () => {
    expect(orderColumns(columns)).toEqual([...columns]);
  });
});

describe('the column vocabulary', () => {
  it('gives every column a tier, so the responsive rules can never miss one', () => {
    for (const [col, spec] of Object.entries(CARD_TABLE_COLUMNS)) {
      expect([1, 2, 3], `${col} has no valid tier`).toContain(spec.tier);
    }
  });

  it('keeps Name and the money columns at the tier that never drops', () => {
    // What a row is, and what it costs, survive every width; everything else
    // is negotiable. Demoting one of these would leave the narrowest table
    // unreadable rather than merely sparse.
    for (const col of ['name', 'price', 'total'] as const) {
      expect(CARD_TABLE_COLUMNS[col].tier).toBe(1);
    }
  });
});
