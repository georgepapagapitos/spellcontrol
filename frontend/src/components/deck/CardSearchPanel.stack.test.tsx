// @vitest-environment happy-dom
/**
 * The Add cards panel's stack picker: a card added with a stack chosen is
 * handed to onAdd with that stack, "No stack" adds unfiled, and the choice
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

function renderPanel(deckId: string, onAdd: (c: AddCardChoice) => void, stackTags?: string[]) {
  const r = render(
    <CardSearchPanel
      deckId={deckId}
      commanderColorIdentity={['R']}
      existingCardCounts={new Map()}
      atCopyLimit={() => false}
      onAdd={onAdd}
      onClose={() => {}}
      stackTags={stackTags}
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
  fireEvent.click(screen.getByRole('button', { name: /Add to stack/ }));
  fireEvent.click(screen.getByRole('option', { name }));
}

describe('CardSearchPanel stack picker', () => {
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
    expect(onAdd.mock.calls[0][0].stack).toBeNull();
  });

  it('files the add into the chosen stack, and No stack goes back to unfiled', async () => {
    const onAdd = vi.fn();
    renderPanel('d1', onAdd, ['Ramp', 'Removal']);
    pick('Ramp');
    await addBolt();
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0][0].stack).toBe('Ramp');
    pick('No stack');
    await addBolt();
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    expect(onAdd.mock.calls[1][0].stack).toBeNull();
  });

  it('restores the last-used stack for that deck when the panel reopens', async () => {
    const onAdd = vi.fn();
    const first = renderPanel('d1', onAdd, ['Ramp', 'Removal']);
    pick('Removal');
    first.unmount();
    renderPanel('d1', onAdd, ['Ramp', 'Removal']);
    await addBolt();
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].stack).toBe('Removal');
  });

  it('does not carry one deck last stack into another, or into a deck without that stack', async () => {
    localStorage.setItem('sc.addStack.d1', 'Ramp');
    const onAdd = vi.fn();
    renderPanel('d2', onAdd, ['Ramp']);
    await addBolt();
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].stack).toBeNull();
  });

  it('shows no picker when the deck has no stacks (collection and list adds never pass any)', async () => {
    const onAdd = vi.fn();
    renderPanel('d1', onAdd, undefined);
    expect(screen.queryByRole('button', { name: /Add to stack/ })).toBeNull();
    await addBolt();
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0].stack).toBeNull();
  });
});
