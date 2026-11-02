// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useCubeStore } from '../../store/cube';

const hoisted = vi.hoisted(() => ({ importDeckText: vi.fn() }));
vi.mock('@/lib/api', () => ({ importDeckText: hoisted.importDeckText }));
vi.mock('../../lib/cube/use-owned-pool', () => ({
  useOwnedCubePool: () => ({ load: vi.fn(), uniqueNames: [] }),
}));

import { ImportCube } from './ImportCube';

const bolt = {
  id: 'b',
  oracle_id: 'oid-bolt',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  colors: ['R'],
};

beforeEach(() => {
  hoisted.importDeckText.mockReset();
  useCubeStore.setState({ size: 540, result: null, loadedId: null, saved: [] });
  useCollectionStore.setState({ cards: [], lists: [] });
  useDecksStore.setState({ decks: [] });
});

function paste(text: string) {
  render(
    <MemoryRouter>
      <ImportCube />
    </MemoryRouter>
  );
  fireEvent.change(screen.getByLabelText(/paste a card list/i), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Import list' }));
}

describe('ImportCube paste', () => {
  it('disables the button until something is pasted', () => {
    render(
      <MemoryRouter>
        <ImportCube />
      </MemoryRouter>
    );
    expect(
      (screen.getByRole('button', { name: 'Import list' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('shows the ownership overlay for a pasted Draftmancer file and names unmatched cards', async () => {
    hoisted.importDeckText.mockResolvedValue({
      commander: null,
      companion: null,
      cards: [bolt],
      unresolvedNames: ['Lightnin Bolt'],
      fetchErrors: [],
      detectedFormat: 'plain',
      cardCount: 1,
    });
    paste('[Settings]\n{"name":"x"}\n[Cube(15)]\nLightning Bolt\nLightnin Bolt\n');
    expect(await screen.findByLabelText('Imported cube ownership')).toBeTruthy();
    expect(screen.getByText('Pasted list')).toBeTruthy();
    expect(screen.getByText('1 cards')).toBeTruthy();
    expect(screen.getByText(/Couldn't match 1 name: Lightnin Bolt/)).toBeTruthy();
    expect(hoisted.importDeckText.mock.calls[0][0]).not.toContain('[Settings]');
  });

  it('shows the error block when nothing matches', async () => {
    hoisted.importDeckText.mockResolvedValue({
      commander: null,
      companion: null,
      cards: [],
      unresolvedNames: ['zzz'],
      fetchErrors: [],
      detectedFormat: 'plain',
      cardCount: 0,
    });
    paste('zzz');
    await waitFor(() => expect(screen.getByText(/Couldn't match any cards/)).toBeTruthy());
  });

  it('saves the pasted list as a new cube through the cube store', async () => {
    hoisted.importDeckText.mockResolvedValue({
      commander: null,
      companion: null,
      cards: [bolt],
      unresolvedNames: [],
      fetchErrors: [],
      detectedFormat: 'plain',
      cardCount: 1,
    });
    paste('Lightning Bolt\n');
    fireEvent.click(await screen.findByRole('button', { name: 'Save as a new cube' }));
    const name = screen.getByLabelText('Cube name') as HTMLInputElement;
    expect(name.value).toBe('Pasted cube');
    fireEvent.change(name, { target: { value: 'My pile' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saved = useCubeStore.getState().saved;
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('My pile');
    expect(saved[0].isPhysical).toBe(false);
    expect(saved[0].cube.picks.map((p) => p.card.name)).toEqual(['Lightning Bolt']);
  });

  it('offers no save action before a list is imported', () => {
    render(
      <MemoryRouter>
        <ImportCube />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: 'Save as a new cube' })).toBeNull();
  });
});
