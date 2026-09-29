// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BinderDef, EnrichedCard } from '../types';

vi.mock('@/lib/overlays/use-lock-body-scroll', () => ({ useLockBodyScroll: () => {} }));

const binders: BinderDef[] = [
  {
    id: 'rare-binder',
    name: 'Rares',
    position: 0,
    mode: 'rules',
    filterGroups: [
      { filter: { rarities: { chips: [{ value: 'mythic', negate: false }], joiners: [] } } },
    ],
    sorts: [],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#000',
    createdAt: 1,
    updatedAt: 1,
  } as unknown as BinderDef,
  {
    id: 'manual-binder',
    name: 'Manual',
    position: 1,
    mode: 'manual',
    filterGroups: [
      { filter: { rarities: { chips: [{ value: 'mythic', negate: false }], joiners: [] } } },
    ],
    sorts: [],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#000',
    createdAt: 1,
    updatedAt: 1,
  } as unknown as BinderDef,
];

vi.mock('../store/collection', () => ({
  useCollectionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      binders,
      pinCardToBinder: () => {},
      removeCardFromBinder: () => {},
    }),
}));

import { BulkMoveToBinderSheet } from './BulkMoveToBinderSheet';

function card(copyId: string, rarity: string): EnrichedCard {
  return {
    copyId,
    name: `Card ${copyId}`,
    setCode: 'cmr',
    collectorNumber: '1',
    scryfallId: `s-${copyId}`,
    rarity,
    foil: false,
  } as unknown as EnrichedCard;
}

describe('BulkMoveToBinderSheet — B3-09 per-binder rule-match count', () => {
  it("shows an N of M mismatch line for a rules binder some selected cards won't match", () => {
    const cards = [card('c1', 'mythic'), card('c2', 'common'), card('c3', 'common')];
    render(
      <BulkMoveToBinderSheet
        copyIds={cards.map((c) => c.copyId)}
        cards={cards}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("1 of 3 match this binder's rules")).toBeTruthy();
  });

  it('shows no mismatch line for a manual binder (always accepts everything)', () => {
    const cards = [card('c1', 'mythic'), card('c2', 'common')];
    render(
      <BulkMoveToBinderSheet
        copyIds={cards.map((c) => c.copyId)}
        cards={cards}
        onClose={() => {}}
      />
    );
    // The manual binder's row never gets a mismatch line, even though the
    // same cards would mismatch a rules binder. "Manual" renders twice in
    // that row (the binder name + its mode hint) — scope via the row that
    // has the "Add" button labeled for the Manual binder.
    const manualRow = screen
      .getByRole('button', { name: /to Manual$/ })
      .closest('li') as HTMLElement;
    expect(manualRow.textContent).not.toMatch(/match this binder's rules/);
  });

  it('shows no mismatch line when every selected card already matches', () => {
    const cards = [card('c1', 'mythic'), card('c2', 'mythic')];
    render(
      <BulkMoveToBinderSheet
        copyIds={cards.map((c) => c.copyId)}
        cards={cards}
        onClose={() => {}}
      />
    );
    expect(screen.queryByText(/match this binder's rules/)).toBeNull();
  });
});
