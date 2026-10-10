// @vitest-environment happy-dom
/**
 * The Add cards panel's group picker: a card added with a group chosen is
 * handed to onAdd with that group, "No group" adds unfiled, and the choice
 * comes back as the default next time the same deck's panel opens.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardSearchPanel, type AddCardChoice } from './CardSearchPanel';
import { useCollectionStore } from '../../store/collection';
import type { EnrichedCard } from '../../types';

vi.mock('@/lib/cards/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cards/card-thumbs')>()),
  useCardThumb: () => undefined,
}));
vi.mock('@/lib/api', () => ({ useSetMap: () => ({}) }));
vi.mock('@/lib/discover/aggregates-client', () => ({
  getCommanderStats: () => Promise.resolve(null),
}));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCards: () => Promise.resolve({ data: [] }),
  getCardByNameResilient: (name: string) => Promise.resolve({ id: name, name }),
}));

function renderPanel(deckId: string, onAdd: (c: AddCardChoice) => void, groupNames?: string[]) {
  const r = render(
    <CardSearchPanel
      deckId={deckId}
      commanderColorIdentity={['R']}
      existingCardCounts={new Map()}
      atCopyLimit={() => false}
      onAdd={onAdd}
      onClose={() => {}}
      groupNames={groupNames}
    />
  );
  fireEvent.click(screen.getByRole('tab', { name: /Collection/ }));
  return r;
}

async function addBolt() {
  fireEvent.click(await screen.findByRole('button', { name: /^Add Lightning Bolt/ }));
  await vi.waitFor(() => expect(true).toBe(true));
}

function pick(name: string) {
  fireEvent.click(screen.getByRole('button', { name: /Add to group/ }));
  fireEvent.click(screen.getByRole('option', { name }));
}

describe('CardSearchPanel group picker', () => {
  beforeEach(() => {
    localStorage.clear();
    useCollectionStore.setState({
      cards: [
        {
          id: 'Lightning Bolt',
          name: 'Lightning Bolt',
          quantity: 1,
          colorIdentity: ['R'],
          legalities: { commander: 'legal' },
        } as unknown as EnrichedCard,
      ],
    });
  });
  afterEach(cleanup);

  it('adds unfiled by default', async () => {
    const onAdd = vi.fn();
    renderPanel('d1', onAdd, ['Ramp', 'Removal']);
    await addBolt();
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].group).toBeNull();
  });

  it('files the add into the chosen group, and No group goes back to unfiled', async () => {
    const onAdd = vi.fn();
    renderPanel('d1', onAdd, ['Ramp', 'Removal']);
    pick('Ramp');
    await addBolt();
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0][0].group).toBe('Ramp');
    pick('No group');
    await addBolt();
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    expect(onAdd.mock.calls[1][0].group).toBeNull();
  });

  it('restores the last-used group for that deck when the panel reopens', async () => {
    const onAdd = vi.fn();
    const first = renderPanel('d1', onAdd, ['Ramp', 'Removal']);
    pick('Removal');
    first.unmount();
    renderPanel('d1', onAdd, ['Ramp', 'Removal']);
    await addBolt();
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].group).toBe('Removal');
  });

  it('does not carry one deck last group into another, or into a deck without that group', async () => {
    localStorage.setItem('sc.addGroup.d1', 'Ramp');
    const onAdd = vi.fn();
    renderPanel('d2', onAdd, ['Ramp']);
    await addBolt();
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].group).toBeNull();
  });

  it('migrates the pre-rename storage key once, so the last pick is not lost', async () => {
    localStorage.setItem('sc.addStack.d1', 'Removal');
    const onAdd = vi.fn();
    renderPanel('d1', onAdd, ['Ramp', 'Removal']);
    await addBolt();
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].group).toBe('Removal');
    expect(localStorage.getItem('sc.addGroup.d1')).toBe('Removal');
    expect(localStorage.getItem('sc.addStack.d1')).toBeNull();
  });

  it('shows no picker when the deck has no groups (collection and list adds never pass any)', async () => {
    const onAdd = vi.fn();
    renderPanel('d1', onAdd, undefined);
    expect(screen.queryByRole('button', { name: /Add to group/ })).toBeNull();
    await addBolt();
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].group).toBeNull();
  });
});
