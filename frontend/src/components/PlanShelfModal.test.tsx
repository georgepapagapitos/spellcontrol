// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanShelfModal } from './PlanShelfModal';
import { useCollectionStore } from '../store/collection';
import { useToastsStore } from '../store/toasts';
import { useAuth } from '../store/auth';
import type { BinderDef, EnrichedCard } from '../types';

vi.mock('../lib/use-lock-body-scroll', () => ({ useLockBodyScroll: () => {} }));

let n = 0;
function card(
  name: string,
  typeLine: string,
  colorIdentity: string[],
  purchasePrice: number,
  extra: Partial<EnrichedCard> = {}
): EnrichedCard {
  n += 1;
  return {
    copyId: `c${n}`,
    scryfallId: `sf${n}`,
    oracleId: `o${n}`,
    name,
    typeLine,
    colorIdentity,
    colors: colorIdentity,
    rarity: 'common',
    purchasePrice,
    setCode: 'tst',
    setName: 'Test Set',
    collectorNumber: String(n),
    finish: 'nonfoil',
    foil: false,
    sourceCategory: 'manual',
    sourceFormat: 'manual',
    ...extra,
  } as EnrichedCard;
}

function bigPile(): EnrichedCard[] {
  const out: EnrichedCard[] = [];
  for (const [color, name] of [
    ['W', 'Pacifism'],
    ['U', 'Counterspell'],
    ['B', 'Doom Blade'],
    ['R', 'Lightning Bolt'],
    ['G', 'Giant Growth'],
  ] as const) {
    for (let i = 0; i < 8; i++) out.push(card(`${name} ${i}`, 'Instant', [color], 0.5 + i));
  }
  out.push(card('Mana Crypt', 'Artifact', [], 220));
  out.push(
    card('Krenko, Mob Boss', 'Legendary Creature — Goblin', ['R'], 4, {
      legalities: { commander: 'legal' },
    })
  );
  out.push(card('Command Tower', 'Land', [], 0.5));
  return out;
}

/** A pile with 500 mono-white cards, enough to overflow a 360-card / 9-pocket
 *  binder into more than one volume. */
function bigWhitePile(): EnrichedCard[] {
  const out: EnrichedCard[] = [];
  for (let i = 0; i < 500; i++) out.push(card(`White Card ${i}`, 'Instant', ['W'], 1));
  return out;
}

function renderModal() {
  const onClose = vi.fn();
  render(<PlanShelfModal onClose={onClose} />);
  return { onClose };
}

function undoToast() {
  return useToastsStore.getState().toasts.find((t) => t.actionLabel === 'Undo');
}

describe('PlanShelfModal', () => {
  beforeEach(() => {
    useAuth.setState({ status: 'guest' });
    useToastsStore.setState({ toasts: [] });
    useCollectionStore.setState({ cards: [], binders: [], activeTab: 'uncategorized' });
  });

  it('an empty collection gets an honest empty state, no picker', () => {
    renderModal();
    expect(
      screen.getByText('Import your collection first — a shelf is planned from the cards you own.')
    ).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /By color/ })).toBeFalsy();
    expect(screen.getByRole('button', { name: 'Create 0 binders' })).toHaveProperty('disabled', true);
  });

  it('defaults to By color and shows every row with a count and page total', async () => {
    useCollectionStore.setState({ cards: bigPile(), binders: [] });
    renderModal();
    expect(screen.getByRole('radio', { name: /By color/ })).toHaveProperty('checked', true);
    await waitFor(() => expect(screen.getByText('White')).toBeTruthy());
    expect(screen.getByText('Multicolor')).toBeTruthy();
    expect(screen.getByText('Everything else')).toBeTruthy();
  });

  it('switching strategy recounts to the new strategy\'s own buckets', async () => {
    useCollectionStore.setState({ cards: bigPile(), binders: [] });
    renderModal();
    await waitFor(() => expect(screen.getByText('White')).toBeTruthy());

    fireEvent.click(screen.getByRole('radio', { name: /By card type/ }));
    await waitFor(() => expect(screen.getByText('Instants')).toBeTruthy());
    expect(screen.queryByText('Multicolor')).toBeFalsy();
  });

  it('unchecking a row folds its cards into the total instead of dropping them', async () => {
    useCollectionStore.setState({ cards: bigPile(), binders: [] });
    renderModal();
    await waitFor(() => expect(screen.getByText('White')).toBeTruthy());

    const before = screen.getByText(/left over/).textContent;
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include White in the shelf' }));

    await waitFor(() => {
      expect(screen.getByText(/left over/).textContent).not.toBe(before);
    });
    // Still 0 left over — the unchecked row's cards moved to Everything else,
    // they didn't vanish.
    expect(screen.getByText(/left over/).textContent).toMatch(/0 left over/);
  });

  it('reordering a pull-out changes which one claims a shared card first', async () => {
    useCollectionStore.setState({ cards: bigPile(), binders: [] });
    renderModal();
    await waitFor(() => expect(screen.getByText('Commanders')).toBeTruthy());

    // Default order is Worth $5+, Commanders, Lands — Move Commanders up so
    // it now precedes the value pull-out.
    const commandersRow = screen.getByText('Commanders').closest('li')!;
    fireEvent.click(within(commandersRow).getByRole('button', { name: 'Move Commanders up' }));

    // The row order in the DOM reflects the new priority.
    await waitFor(() => {
      const names = screen
        .getAllByText(/Worth \$5 or more|Commanders|Lands/, { selector: '.plan-shelf-row-name' })
        .map((el) => el.textContent);
      expect(names[0]).toContain('Commanders');
    });
  });

  it('shows a volumes note once a checked row outgrows one binder', async () => {
    useCollectionStore.setState({ cards: bigWhitePile(), binders: [] });
    renderModal();
    await waitFor(() => expect(screen.getByText(/volumes of 360/)).toBeTruthy());
  });

  it('existing binders keep priority: the plan totals shrink and stay 0 left over', async () => {
    const existing: BinderDef = {
      id: 'existing',
      name: 'My reds',
      position: 0,
      filterGroups: [{ filter: { colorIdentity: { colors: ['R'], mode: 'all' } } }],
      sorts: [],
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      color: '#fff',
      createdAt: 0,
      updatedAt: 0,
    };
    useCollectionStore.setState({ cards: bigPile(), binders: [existing] });
    renderModal();
    await waitFor(() => expect(screen.getByText(/left over/).textContent).toMatch(/0 left over/));
    expect(screen.getByText('Your 1 existing binder stays in front of these')).toBeTruthy();
  });

  it('an all-filed collection says so and disables Create', async () => {
    const catchAll: BinderDef = {
      id: 'existing',
      name: 'Everything',
      position: 0,
      filterGroups: [{ filter: {} }],
      sorts: [],
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      color: '#fff',
      createdAt: 0,
      updatedAt: 0,
    };
    useCollectionStore.setState({ cards: bigPile(), binders: [catchAll] });
    renderModal();
    await waitFor(() =>
      expect(
        screen.getByText('Every card you own already has a binder. Nothing is left to plan a shelf from.')
      ).toBeTruthy()
    );
    expect(screen.getByRole('button', { name: /Create 0 binders/ })).toHaveProperty('disabled', true);
  });

  it('Create calls the store once with sequential positions after existing binders, then offers a working Undo', async () => {
    const existing: BinderDef = {
      id: 'existing',
      name: 'My stuff',
      position: 0,
      filterGroups: [{ filter: { priceMax: 0 } }], // matches nothing real
      sorts: [],
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      color: '#fff',
      createdAt: 0,
      updatedAt: 0,
    };
    useCollectionStore.setState({ cards: bigPile(), binders: [existing] });
    const { onClose } = renderModal();

    await waitFor(() => expect(screen.getByText('White')).toBeTruthy());

    const createBtn = await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Create \d+ binders?/ });
      expect(btn).toHaveProperty('disabled', false);
      return btn;
    });
    fireEvent.click(createBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
    const binders = useCollectionStore.getState().binders;
    // The existing binder is untouched, at position 0; every new binder comes
    // after it with sequential positions and none collide with it.
    expect(binders[0].id).toBe('existing');
    expect(binders[0].position).toBe(0);
    const newOnes = binders.slice(1);
    expect(newOnes.length).toBeGreaterThan(0);
    expect(newOnes.map((b) => b.position)).toEqual(newOnes.map((_, i) => i + 1));

    const t = undoToast();
    expect(t).toBeTruthy();
    expect(t?.message).toBe(`Created ${newOnes.length} binders`);
    t!.onAction!();

    // Undo removes exactly the created binders — the pre-existing one stays.
    const after = useCollectionStore.getState().binders;
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('existing');
  });

  it('Cancel closes without creating anything', async () => {
    useCollectionStore.setState({ cards: bigPile(), binders: [] });
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useCollectionStore.getState().binders).toHaveLength(0);
  });
});
