// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { PartnerCommanderSelector } from './PartnerCommanderSelector';

const searchValidPartners = vi.fn();
const fetchPartnerPopularity = vi.fn();
let collectionCards: { name: string }[] = [];

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchValidPartners: (...args: unknown[]) => searchValidPartners(...args),
}));
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchPartnerPopularity: (...args: unknown[]) => fetchPartnerPopularity(...args),
}));
vi.mock('../../store/collection', () => ({
  useCollectionStore: (sel: (s: { cards: unknown[] }) => unknown) =>
    sel({ cards: collectionCards }),
}));

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: overrides.name ?? 'card-id',
    name: 'Card',
    type_line: 'Legendary Creature',
    keywords: [],
    oracle_text: '',
    color_identity: [],
    ...overrides,
  } as ScryfallCard;
}

beforeEach(() => {
  searchValidPartners.mockReset();
  fetchPartnerPopularity.mockReset();
  searchValidPartners.mockResolvedValue([]);
  fetchPartnerPopularity.mockResolvedValue(new Map());
  collectionCards = [];
});

describe('PartnerCommanderSelector', () => {
  it('renders nothing for a commander with no partner mechanic', () => {
    const { container } = render(
      <PartnerCommanderSelector
        commander={card({ name: 'Plain Commander' })}
        partner={null}
        onSelect={vi.fn()}
        collectionMode={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the toggle when the commander has Partner', () => {
    render(
      <PartnerCommanderSelector
        commander={card({ name: 'Partner Cmdr', keywords: ['Partner'] })}
        partner={null}
        onSelect={vi.fn()}
        collectionMode={false}
      />
    );
    expect(screen.getByText('Add a partner commander')).toBeTruthy();
    // Picker stays hidden until the toggle is switched on.
    expect(searchValidPartners).not.toHaveBeenCalled();
  });

  it('opens the picker and selects a partner ranked by EDHREC popularity', async () => {
    fetchPartnerPopularity.mockResolvedValue(new Map([['Popular Partner', 5000]]));
    searchValidPartners.mockResolvedValue([
      card({ name: 'Rare Partner', keywords: ['Partner'] }),
      card({ name: 'Popular Partner', keywords: ['Partner'] }),
    ]);
    const onSelect = vi.fn();
    render(
      <PartnerCommanderSelector
        commander={card({ name: 'Partner Cmdr', keywords: ['Partner'] })}
        partner={null}
        onSelect={onSelect}
        collectionMode={false}
      />
    );

    fireEvent.click(screen.getByRole('checkbox'));

    const items = await screen.findAllByRole('option');
    // The popular partner ranks first despite coming second from Scryfall.
    expect(items[0].textContent).toContain('Popular Partner');
    expect(screen.getByText('5.0k decks')).toBeTruthy();

    fireEvent.click(items[0]);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'Popular Partner' }));
  });

  it('shows the selected partner with a Change action', () => {
    const onSelect = vi.fn();
    render(
      <PartnerCommanderSelector
        commander={card({ name: 'Partner Cmdr', keywords: ['Partner'] })}
        partner={card({ name: 'Chosen Partner', keywords: ['Partner'] })}
        onSelect={onSelect}
        collectionMode={false}
      />
    );
    expect(screen.getByText('Chosen Partner')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('warns when an already-selected partner is not in the collection', () => {
    // Collection mode is on but the chosen partner isn't owned — likely
    // picked before the user turned collection mode on.
    collectionCards = [{ name: 'Partner Cmdr' }];
    render(
      <PartnerCommanderSelector
        commander={card({ name: 'Partner Cmdr', keywords: ['Partner'] })}
        partner={card({ name: 'Unowned Partner', keywords: ['Partner'] })}
        onSelect={vi.fn()}
        collectionMode
      />
    );
    expect(screen.getByRole('status').textContent).toContain('Unowned Partner');
    expect(screen.getByRole('status').textContent).toContain('your collection');
  });

  it('does not warn when the selected partner is owned', () => {
    collectionCards = [{ name: 'Owned Partner' }];
    render(
      <PartnerCommanderSelector
        commander={card({ name: 'Partner Cmdr', keywords: ['Partner'] })}
        partner={card({ name: 'Owned Partner', keywords: ['Partner'] })}
        onSelect={vi.fn()}
        collectionMode
      />
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('warns when no legal partner is in the collection during a collection build', async () => {
    searchValidPartners.mockResolvedValue([
      card({ name: 'Unowned Partner', keywords: ['Partner'] }),
    ]);
    render(
      <PartnerCommanderSelector
        commander={card({ name: 'Partner Cmdr', keywords: ['Partner'] })}
        partner={null}
        onSelect={vi.fn()}
        collectionMode
      />
    );

    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('your collection');
    });
  });

  it('marks owned partners and keeps them visible in collection mode', async () => {
    collectionCards = [{ name: 'Owned Partner' }];
    searchValidPartners.mockResolvedValue([
      card({ name: 'Owned Partner', keywords: ['Partner'] }),
      card({ name: 'Unowned Partner', keywords: ['Partner'] }),
    ]);
    render(
      <PartnerCommanderSelector
        commander={card({ name: 'Partner Cmdr', keywords: ['Partner'] })}
        partner={null}
        onSelect={vi.fn()}
        collectionMode
      />
    );

    fireEvent.click(screen.getByRole('checkbox'));

    const items = await screen.findAllByRole('option');
    // Collection mode hides unowned partners and badges the owned one.
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('Owned Partner');
    expect(items[0].textContent).toContain('Owned');
  });
});
