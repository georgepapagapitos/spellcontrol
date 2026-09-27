// @vitest-environment happy-dom
/**
 * T164 — the Breakdown drawer's `filterJump` prop: a one-shot external
 * filter request applied via `useEffect` (see CardListTable.tsx's doc on
 * `filterJump`), since the drawer and this table are mounted siblings and
 * can't use the `?binder=`-style mount-time URL deep link.
 *
 * Mirrors the render/virtualizer-mock setup of the other CardListTable
 * filter tests (e.g. CardListTable.language-filter.test.tsx).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EnrichedCard } from '../types';
import type { CollectionFilterJump } from '../lib/collection-insights';

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

import { CardListTable } from './CardListTable';
import { ShortcutRegistryProvider } from '../lib/shortcut-registry';
import { useCollectionStore } from '../store/collection';

let idSeq = 0;
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
    colorIdentity: [],
    ...o,
  } as EnrichedCard;
}

function renderTable(
  cards: EnrichedCard[],
  filterJump: CollectionFilterJump | null,
  onFilterJumpApplied: () => void
) {
  // The tradeable-surplus predicate reads the FULL collection store, not
  // this component's `cards` prop (a binder-scoped view can be narrower) —
  // see CardListTable.tsx's `allCards` / `surplusByName` comment.
  useCollectionStore.setState({ cards });
  return render(
    <ShortcutRegistryProvider>
      <MemoryRouter>
        <CardListTable
          cards={cards}
          binders={[]}
          filterJump={filterJump}
          onFilterJumpApplied={onFilterJumpApplied}
        />
      </MemoryRouter>
    </ShortcutRegistryProvider>
  );
}

describe('CardListTable — filterJump', () => {
  it('surplus jump narrows to rows with a tradeable-surplus name', () => {
    const cards = [
      mk({ name: 'Common Land', scryfallId: 'sf-a1' }),
      mk({ name: 'Common Land', scryfallId: 'sf-a1', copyId: 'copy-a2' }),
      mk({ name: 'Solo Card', scryfallId: 'sf-b' }),
    ];
    const applied = vi.fn();
    renderTable(cards, { kind: 'surplus' }, applied);

    expect(screen.getByRole('button', { name: /^common land/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /solo card/i })).toBeNull();
    expect(applied).toHaveBeenCalledTimes(1);
  });

  it('color jump is an EXACT match (mono only), not "contains this color"', () => {
    const cards = [
      mk({ name: 'Mono White', colorIdentity: ['W'] }),
      mk({ name: 'Azorius Card', colorIdentity: ['W', 'U'] }),
    ];
    const applied = vi.fn();
    renderTable(cards, { kind: 'color', key: 'W' }, applied);

    expect(screen.getByRole('button', { name: /^mono white/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /azorius card/i })).toBeNull();
  });

  it('type jump filters by the parsed primary type token', () => {
    const cards = [
      mk({ name: 'A Creature', typeLine: 'Creature — Bear' }),
      mk({ name: 'An Instant', typeLine: 'Instant' }),
    ];
    renderTable(cards, { kind: 'type', key: 'creature' }, vi.fn());

    expect(screen.getByRole('button', { name: /^a creature/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /an instant/i })).toBeNull();
  });

  it('rarity jump filters by rarity', () => {
    const cards = [
      mk({ name: 'A Mythic', rarity: 'mythic' }),
      mk({ name: 'A Common', rarity: 'common' }),
    ];
    renderTable(cards, { kind: 'rarity', key: 'mythic' }, vi.fn());

    expect(screen.getByRole('button', { name: /^a mythic/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /a common/i })).toBeNull();
  });

  it('set jump filters by set code', () => {
    const cards = [
      mk({ name: 'From LEA', setCode: 'lea' }),
      mk({ name: 'From M20', setCode: 'm20' }),
    ];
    renderTable(cards, { kind: 'set', code: 'lea' }, vi.fn());

    expect(screen.getByRole('button', { name: /^from lea/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /from m20/i })).toBeNull();
  });

  it('a null filterJump applies nothing and never calls the callback', () => {
    const cards = [mk({ name: 'Untouched' })];
    const applied = vi.fn();
    renderTable(cards, null, applied);
    expect(screen.getByRole('button', { name: /^untouched/i })).toBeDefined();
    expect(applied).not.toHaveBeenCalled();
  });
});
