import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { remapCubeAllocations } from './remap-cube-allocations';
import { useCubeStore, type SavedCube, type CubePickSlot } from '../store/cube';
import { useDecksStore, type Deck } from '../store/decks';
import { setApplyingServer } from './applying-server';
import type { EnrichedCard } from '../types';

function card(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'c',
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: 'sf-1',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  } as EnrichedCard;
}

function slot(
  name: string,
  allocatedCopyId: string | null,
  printingFinishKey: string | null
): CubePickSlot {
  return { slotId: name, card: { name } as never, allocatedCopyId, printingFinishKey };
}

function savedCube(picks: CubePickSlot[], overrides: Partial<SavedCube> = {}): SavedCube {
  return {
    id: 'cube-1',
    name: 'My Cube',
    size: 540,
    cube: { picks: [] } as never,
    picks,
    isPhysical: true,
    savedAt: 0,
    ...overrides,
  };
}

function setCubes(cubes: SavedCube[]) {
  useCubeStore.setState({ saved: cubes });
}
function currentPicks(): CubePickSlot[] {
  return useCubeStore.getState().saved[0].picks;
}

function deck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Test Deck',
    source: 'manual',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    generationContext: null,
    color: '#7a8a70',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('remapCubeAllocations', () => {
  // Suppress the sync subscriber's dynamic import while we mutate the store.
  beforeEach(() => {
    setApplyingServer(true);
    useDecksStore.setState({ decks: [] });
  });
  afterEach(() => {
    setApplyingServer(false);
    useCubeStore.setState({ saved: [] });
    useDecksStore.setState({ decks: [] });
  });

  it('preserves a still-valid binding', () => {
    setCubes([savedCube([slot('Sol Ring', 'keep', 'sf-1:nonfoil')])]);
    remapCubeAllocations([card({ copyId: 'keep', scryfallId: 'sf-1' })]);
    expect(currentPicks()[0].allocatedCopyId).toBe('keep');
  });

  it('rebinds via the printingFinishKey shadow after a reimport regenerates copyIds', () => {
    setCubes([savedCube([slot('Sol Ring', 'old', 'sf-1:nonfoil')])]);
    // Same printing+finish, brand-new copyId; 'old' is gone.
    remapCubeAllocations([card({ copyId: 'new', scryfallId: 'sf-1', finish: 'nonfoil' })]);
    expect(currentPicks()[0].allocatedCopyId).toBe('new');
    expect(currentPicks()[0].printingFinishKey).toBe('sf-1:nonfoil');
  });

  it('falls back to any free copy of the name when the shadow no longer matches', () => {
    setCubes([savedCube([slot('Sol Ring', 'gone', 'sf-OLD:nonfoil')])]);
    remapCubeAllocations([card({ copyId: 'fresh', scryfallId: 'sf-NEW' })]);
    expect(currentPicks()[0].allocatedCopyId).toBe('fresh');
    expect(currentPicks()[0].printingFinishKey).toBe('sf-NEW:nonfoil');
  });

  it('leaves a gap when no copy of the name is owned anymore', () => {
    setCubes([savedCube([slot('Sol Ring', 'gone', 'sf-1:nonfoil')])]);
    remapCubeAllocations([card({ copyId: 'x', name: 'Llanowar Elves', scryfallId: 'sf-2' })]);
    expect(currentPicks()[0].allocatedCopyId).toBeNull();
    expect(currentPicks()[0].printingFinishKey).toBeNull();
  });

  it('does not touch non-physical cubes', () => {
    setCubes([savedCube([slot('Sol Ring', 'old', 'sf-1:nonfoil')], { isPhysical: false })]);
    remapCubeAllocations([card({ copyId: 'new', scryfallId: 'sf-1' })]);
    expect(currentPicks()[0].allocatedCopyId).toBe('old'); // untouched
  });

  it('does not let two physical cubes claim the same copy during remap', () => {
    const cubeA = savedCube([slot('Sol Ring', 'keep', 'sf-1:nonfoil')], { id: 'A', name: 'A' });
    const cubeB = savedCube([slot('Sol Ring', 'lost', 'sf-1:nonfoil')], { id: 'B', name: 'B' });
    useCubeStore.setState({ saved: [cubeA, cubeB] });
    // Only ONE copy exists now. Cube A had it stably; cube B must not steal it.
    remapCubeAllocations([card({ copyId: 'keep', scryfallId: 'sf-1' })]);
    const saved = useCubeStore.getState().saved;
    const a = saved.find((c) => c.id === 'A')!;
    const b = saved.find((c) => c.id === 'B')!;
    expect(a.picks[0].allocatedCopyId).toBe('keep');
    expect(b.picks[0].allocatedCopyId).toBeNull();
  });

  it('does not let a cube claim a copyId a deck already holds (E133 deck↔cube collision)', () => {
    // A deck currently claims the collection's only Sol Ring — this is what
    // store/collection.ts's remapCollectionDependents guarantees has already
    // happened by the time remapCubeAllocations runs (decks remap first).
    useDecksStore.setState({
      decks: [
        deck({
          id: 'd1',
          name: 'Deck',
          cards: [
            {
              slotId: 's1',
              card: { name: 'Sol Ring', id: 'sf-1' } as never,
              allocatedCopyId: 'shared',
            },
          ],
        }),
      ],
    });
    // The cube's stored binding is stale (points at a copyId that no longer
    // exists) — without the deck-claim seed, phase B would happily hand it
    // the deck's copy since nothing else claims it from the cube's own view.
    setCubes([savedCube([slot('Sol Ring', 'gone', 'sf-1:nonfoil')])]);
    remapCubeAllocations([card({ copyId: 'shared', scryfallId: 'sf-1' })]);
    expect(currentPicks()[0].allocatedCopyId).toBeNull(); // cube could not steal the deck's copy
  });
});
