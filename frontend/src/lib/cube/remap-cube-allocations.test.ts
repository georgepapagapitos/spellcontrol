import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  installCubeClaimHeal,
  remapAllAllocations,
  remapCubeAllocations,
} from './remap-cube-allocations';
import { useCubeStore, type SavedCube, type CubePickSlot } from '@/store/cube';
import { useDecksStore, type Deck } from '@/store/decks';
import { setApplyingServer } from '@/lib/sync/applying-server';
import type { EnrichedCard } from '@/types/index';

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
    considering: [],
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

// A deck and a physical cube share one pool of copies (E542). These failed
// before: the deck remap started from an empty claim set, so any collection
// edit or sync could hand a cube's copy to a deck, and nothing released a
// copy both held.
describe('decks and physical cubes share one claim set (E542)', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const solRingSlot = (allocatedCopyId: string | null) => ({
    slotId: 's1',
    card: { name: 'Sol Ring', id: 'sf-1' } as never,
    allocatedCopyId,
  });

  beforeEach(async () => {
    setApplyingServer(true);
    installCubeClaimHeal();
    useDecksStore.setState({ decks: [] });
    useCubeStore.setState({ saved: [] });
    await flush();
  });
  afterEach(() => {
    setApplyingServer(false);
    useCubeStore.setState({ saved: [] });
    useDecksStore.setState({ decks: [] });
  });

  it('a deck slot needing a copy never takes the one a physical cube holds', () => {
    setCubes([savedCube([slot('Sol Ring', 'cube-copy', 'sf-1:nonfoil')])]);
    useDecksStore.setState({ decks: [deck({ cards: [solRingSlot(null)] })] });

    remapAllAllocations([card({ copyId: 'cube-copy', scryfallId: 'sf-1' })]);

    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBeNull();
    expect(currentPicks()[0].allocatedCopyId).toBe('cube-copy');
  });

  it('a deck slot whose copy was deleted does not fall back onto the cube copy', () => {
    setCubes([savedCube([slot('Sol Ring', 'cube-copy', 'sf-1:nonfoil')])]);
    useDecksStore.setState({ decks: [deck({ cards: [solRingSlot('deleted-copy')] })] });

    remapAllAllocations([card({ copyId: 'cube-copy', scryfallId: 'sf-1' })]);

    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBeNull();
    expect(currentPicks()[0].allocatedCopyId).toBe('cube-copy');
  });

  it('a free copy still goes to the deck while the cube keeps its own', () => {
    setCubes([savedCube([slot('Sol Ring', 'cube-copy', 'sf-1:nonfoil')])]);
    useDecksStore.setState({ decks: [deck({ cards: [solRingSlot(null)] })] });

    remapAllAllocations([
      card({ copyId: 'cube-copy', scryfallId: 'sf-1' }),
      card({ copyId: 'free-copy', scryfallId: 'sf-1' }),
    ]);

    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBe('free-copy');
    expect(currentPicks()[0].allocatedCopyId).toBe('cube-copy');
  });

  it('a copy both already hold stays with the deck; the cube is left a gap', () => {
    setCubes([savedCube([slot('Sol Ring', 'shared', 'sf-1:nonfoil')])]);
    useDecksStore.setState({ decks: [deck({ cards: [solRingSlot('shared')] })] });

    remapAllAllocations([card({ copyId: 'shared', scryfallId: 'sf-1' })]);

    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBe('shared');
    expect(currentPicks()[0].allocatedCopyId).toBeNull();
  });

  it('a double claim arriving without a remap (a sync, an undo) heals: the cube releases', async () => {
    setCubes([savedCube([slot('Sol Ring', 'shared', 'sf-1:nonfoil')])]);
    useDecksStore.setState({ decks: [deck({ cards: [solRingSlot('shared')] })] });
    await flush();

    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBe('shared');
    const pick = currentPicks()[0];
    expect(pick.allocatedCopyId).toBeNull();
    // The shadow stays, so the next remap can bind another copy of the printing.
    expect(pick.printingFinishKey).toBe('sf-1:nonfoil');
  });

  it('two physical cubes claiming one copy heal to the first', async () => {
    setCubes([
      savedCube([slot('Sol Ring', 'shared', 'sf-1:nonfoil')], { id: 'a' }),
      savedCube([slot('Sol Ring', 'shared', 'sf-1:nonfoil')], { id: 'b' }),
    ]);
    await flush();

    const [a, b] = useCubeStore.getState().saved;
    expect(a.picks[0].allocatedCopyId).toBe('shared');
    expect(b.picks[0].allocatedCopyId).toBeNull();
  });

  it('a draft cube claims nothing, so a deck may take the copy it lists', async () => {
    setCubes([savedCube([slot('Sol Ring', 'shared', null)], { isPhysical: false })]);
    useDecksStore.setState({ decks: [deck({ cards: [solRingSlot(null)] })] });

    remapAllAllocations([card({ copyId: 'shared', scryfallId: 'sf-1' })]);
    await flush();

    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBe('shared');
  });

  it('leaves the cube list untouched when nothing is contested', async () => {
    setCubes([savedCube([slot('Sol Ring', 'cube-copy', 'sf-1:nonfoil')])]);
    const before = useCubeStore.getState().saved;
    useDecksStore.setState({ decks: [deck({ cards: [solRingSlot('other')] })] });
    await flush();

    expect(useCubeStore.getState().saved).toBe(before);
  });
});
