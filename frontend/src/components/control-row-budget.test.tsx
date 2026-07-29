// @vitest-environment happy-dom
/**
 * Control-row budget guard (STYLE_GUIDE.md § "Toolbars & action rows" rule 2).
 *
 * PR #1368 fixed a phone-width deck toolbar that had silently grown from six
 * controls to nine over fifteen PRs, wrapping onto three rows at 360px and
 * pushing the decklist below the fold — even though the rule that should have
 * prevented it (display preferences collapse into one "View" ToolbarPopover at
 * ≤640px) already existed. Nothing failed when the row grew, so it kept
 * growing.
 *
 * This test pins the number of *visible* top-level controls each primary
 * toolbar renders at a phone viewport to its current, already-collapsed count.
 * A future PR that adds a tenth pill instead of folding it into the existing
 * "View" popover / kebab must fail here instead of shipping a wrapped row.
 *
 * This is a budget, not a design spec — it deliberately does NOT assert which
 * controls are visible (DeckDisplay.toolbar-fold.test.tsx and
 * CardListTable.viewpopover.test.tsx already cover that). It only counts.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../types';

// Stub the thumbnail network leaf so nested card rows don't reach out (avoids
// the post-teardown fetch flake — same stub as the other DeckDisplay suites).
vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

// Render every virtual row in tests (same stub as CardListTable.viewpopover.test.tsx).
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        start: index * 40,
        size: 40,
      })),
    getTotalSize: () => count * 40,
    measureElement: () => {},
    measure: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}));

vi.mock('./CardPreview', () => ({
  CardPreview: () => <div data-testid="card-preview" />,
}));

import { DeckDisplay, type DeckDisplayCard } from './deck/DeckDisplay';
import { CardListTable } from './CardListTable';
import { ShortcutRegistryProvider } from '../lib/shortcut-registry';

const STYLE_GUIDE_POINTER =
  'Per STYLE_GUIDE.md § "Toolbars & action rows" rule 2, new display-preference ' +
  'controls belong inside the "View" ToolbarPopover (or the row\'s kebab), not a ' +
  'new inline pill — fold the new control in rather than raising this budget.';

function assertControlBudget(row: Element | null, budget: number, rowLabel: string) {
  if (!row) throw new Error(`${rowLabel}: expected control row was not found in the DOM`);
  const count = row.children.length;
  expect(
    count,
    `${rowLabel} rendered ${count} visible controls at the ≤640px phone breakpoint ` +
      `(budget: ${budget}). A row over budget wraps onto multiple lines at 360px and pushes ` +
      `content below the fold — this is exactly how the deck toolbar regressed across fifteen ` +
      `PRs before PR #1368 fixed it. ${STYLE_GUIDE_POINTER}`
  ).toBeLessThanOrEqual(budget);
}

/** Both surfaces read their ≤640px breakpoint via matchMedia at mount. */
function stubNarrowViewport(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /max-width:\s*640px/.test(query) ? narrow : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe('control-row budget — deck toolbar (DeckDisplay)', () => {
  beforeEach(() => {
    localStorage.clear();
    stubNarrowViewport(true);
  });

  function card(name: string): ScryfallCard {
    return {
      id: `id-${name}`,
      oracle_id: `oracle-${name}`,
      name,
      mana_cost: '{1}',
      cmc: 1,
      type_line: 'Artifact',
      color_identity: [],
      keywords: [],
      rarity: 'common',
      set: 'lea',
      collector_number: '1',
      set_name: 'Test Set',
      prices: { usd: '1.00' },
      legalities: {},
    } as unknown as ScryfallCard;
  }

  function slots(names: string[]): DeckDisplayCard[] {
    return names.map((name, i) => ({ slotId: `slot-${name}-${i}`, card: card(name) }));
  }

  it('the ≤640px toolbar-controls row stays within budget', () => {
    const { container } = render(
      <MemoryRouter>
        <DeckDisplay
          title="Test deck"
          commander={null}
          format="commander"
          cards={slots(['Mainboard Card'])}
          sideboard={[]}
          considering={[]}
        />
      </MemoryRouter>
    );
    assertControlBudget(
      container.querySelector('.deck-toolbar-controls'),
      4,
      'Deck toolbar (.deck-toolbar-controls)'
    );
  });
});

describe('control-row budget — collection toolbar (CardListTable)', () => {
  let idSeq = 0;

  beforeEach(() => {
    idSeq = 0;
    localStorage.clear();
    localStorage.setItem('mtg-collection-view-mode', 'grid');
    stubNarrowViewport(true);
  });

  function mk(o: Partial<EnrichedCard> = {}): EnrichedCard {
    idSeq += 1;
    return {
      copyId: `copy-${idSeq}`,
      name: `Card ${idSeq}`,
      setCode: 'TST',
      setName: 'Test Set',
      collectorNumber: `${idSeq}`,
      rarity: 'common',
      scryfallId: `sf-${idSeq}`,
      purchasePrice: 1,
      sourceCategory: '',
      sourceFormat: 'plain',
      finish: 'nonfoil',
      foil: false,
      typeLine: 'Instant',
      cmc: 1,
      ...o,
    } as EnrichedCard;
  }

  it('the ≤640px controls row stays within budget', () => {
    const { container } = render(
      <ShortcutRegistryProvider>
        <MemoryRouter>
          <CardListTable cards={[mk({ name: 'Alpha' })]} binders={[]} />
        </MemoryRouter>
      </ShortcutRegistryProvider>
    );
    assertControlBudget(
      container.querySelector('.card-list-summary-actions'),
      4,
      'Collection toolbar (.card-list-summary-actions)'
    );
  });

  it('grouping (which adds the collapse-all toggle) still stays within budget', () => {
    render(
      <ShortcutRegistryProvider>
        <MemoryRouter>
          <CardListTable cards={[mk({ name: 'Alpha' }), mk({ name: 'Beta' })]} binders={[]} />
        </MemoryRouter>
      </ShortcutRegistryProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Group by' }));
    fireEvent.click(screen.getByRole('option', { name: 'Type' }));
    assertControlBudget(
      document.querySelector('.card-list-summary-actions'),
      5,
      'Collection toolbar with grouping active (.card-list-summary-actions)'
    );
  });
});
