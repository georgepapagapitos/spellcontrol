// @vitest-environment happy-dom
/**
 * The customizer as the body of generator step 4 (E1113): bracket, where the cards come from,
 * lands and budget up front, everything else behind More settings, and no section chrome of
 * its own (the step has the title).
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCustomization } from '@/deck-builder/store';
import type { Customization } from '@/deck-builder/types';
import { DeckCustomizer } from './DeckCustomizer';

let collectionCards: { name: string }[] = [];
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  autocompleteCardName: vi.fn().mockResolvedValue([]),
  getBanList: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../store/collection', () => ({
  useCollectionStore: (sel: (s: { cards: unknown[] }) => unknown) =>
    sel({ cards: collectionCards }),
}));
vi.mock('@/deck-builder/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/deck-builder/store')>()),
  useDeckBuilderStore: (sel: (s: unknown) => unknown) =>
    sel({ edhrecLandSuggestion: null, setUserEditedLands: vi.fn() }),
}));

const render4 = (over: Partial<Customization> = {}) => {
  const update = vi.fn();
  render(
    <DeckCustomizer step customization={{ ...defaultCustomization, ...over }} update={update} />
  );
  return update;
};

beforeEach(() => {
  localStorage.clear();
  collectionCards = [{ name: 'Sol Ring' }];
});

describe('DeckCustomizer as a step', () => {
  it('has no title or section of its own, and leads with the four levers', () => {
    render4();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles.slice(0, 3)).toEqual(['Power bracket', 'Cards from', 'Lands']);
    // Budget is open, not folded away.
    expect(screen.getByRole('button', { name: /Budget/ }).getAttribute('aria-expanded')).toBe(
      'true'
    );
    // The long tail is behind More settings.
    expect(screen.queryByRole('button', { name: /Salt/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /More settings/ }));
    expect(screen.getByRole('button', { name: /Salt/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Collection strategy/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Staples ↔ Synergy' })).toBeTruthy();
  });

  it('the page-wide customizer is unchanged: collection switch up front, no Cards from', () => {
    render(<DeckCustomizer customization={defaultCustomization} update={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Customize' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Cards from' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Use my collection' })).toBeTruthy();
  });
});

describe('Cards from', () => {
  const group = () => screen.getByRole('group', { name: 'Cards from' });

  it('reads Any card with the collection off, and sets each of the three', () => {
    const update = render4({ collectionMode: false });
    expect(
      (within(group()).getByRole('radio', { name: /Any card/ }) as HTMLInputElement).checked
    ).toBe(true);
    // One compact control, with the picked option's hint as a single line under it.
    expect(screen.getByText('Ignore my collection')).toBeTruthy();
    expect(screen.queryByText('Free owned cards first')).toBeNull();
    fireEvent.click(within(group()).getByRole('radio', { name: /Mine first/ }));
    expect(update).toHaveBeenLastCalledWith({ collectionMode: true, collectionStrategy: 'prefer' });
    fireEvent.click(within(group()).getByRole('radio', { name: /Only mine/ }));
    // Free copies only: "Only mine" must never pull a copy another deck holds.
    expect(update).toHaveBeenLastCalledWith({
      collectionMode: true,
      collectionStrategy: 'available',
    });
  });

  it('reads Only mine for the free-copies strategy, the generator default', () => {
    render4({ collectionMode: true, collectionStrategy: 'available' });
    expect(
      (within(group()).getByRole('radio', { name: /Only mine/ }) as HTMLInputElement).checked
    ).toBe(true);
    expect(screen.getByText('Owned cards no other deck uses')).toBeTruthy();
  });

  it('turns the collection off for Any card', () => {
    const update = render4({ collectionMode: true, collectionStrategy: 'prefer' });
    expect(
      (within(group()).getByRole('radio', { name: /Mine first/ }) as HTMLInputElement).checked
    ).toBe(true);
    fireEvent.click(within(group()).getByRole('radio', { name: /Any card/ }));
    expect(update).toHaveBeenLastCalledWith({ collectionMode: false });
  });

  it('says Custom while a strategy only the full control sets is on, rather than misreading it', () => {
    // 'full' uses copies other decks hold, so it is never what "Only mine" means.
    render4({ collectionMode: true, collectionStrategy: 'full' });
    expect(
      (within(group()).getByRole('radio', { name: /Custom/ }) as HTMLInputElement).checked
    ).toBe(true);
    expect(screen.getByText('Set under More settings')).toBeTruthy();
  });

  it('with no collection offers only Any card and says how to get one', () => {
    collectionCards = [];
    render4();
    expect(within(group()).getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByText('Import cards on the Collection page to use them.')).toBeTruthy();
  });
});
