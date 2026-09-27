// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCubeStore, type SavedCube, type CubePickSlot } from '../../store/cube';
import { useCollectionStore } from '../../store/collection';
import { useAuth } from '../../store/auth';
import type { GeneratedCube } from '../../lib/cube/generate';
import type { CubeCard } from '../../lib/cube/core';
import type { BinderDef, BinderFilter, EnrichedCard } from '../../types';

const syncMock = vi.hoisted(() => ({
  state: 'ready' as 'idle' | 'syncing' | 'ready',
  error: false,
}));
vi.mock('../../lib/sync', () => ({
  getSyncState: () => syncMock.state,
  hasSyncError: () => syncMock.error,
  onSyncedChange: () => () => {},
}));

// Lets one test force buildCubePullList to throw (a real materialize crash),
// then recover on retry — everything else uses the real implementation.
const pullListMock = vi.hoisted(() => ({ shouldThrow: false }));
vi.mock('../../lib/cube/pull-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/cube/pull-list')>();
  return {
    ...actual,
    buildCubePullList: (...args: Parameters<typeof actual.buildCubePullList>) => {
      if (pullListMock.shouldThrow) throw new Error('materialize blew up');
      return actual.buildCubePullList(...args);
    },
  };
});

import { CubePullList } from './CubePullList';

function makeCubeCard(overrides: Partial<CubeCard> & { name: string; oracleId: string }): CubeCard {
  return { colors: [], cmc: 1, typeLine: 'Artifact', role: null, ...overrides };
}

function makePick(
  overrides: Partial<CubePickSlot> & { slotId: string; card: CubeCard }
): CubePickSlot {
  return { allocatedCopyId: null, printingFinishKey: null, ...overrides };
}

function makeGeneratedCube(picks: GeneratedCube['picks'] = []): GeneratedCube {
  return {
    size: 180,
    format: 'limited',
    picks,
    byBucket: { W: 0, U: 0, B: 0, R: 0, G: 0, multicolor: 0, colorless: 0, land: 0 },
    targetByBucket: { W: 0, U: 0, B: 0, R: 0, G: 0, multicolor: 0, colorless: 0, land: 0 },
    gaps: [],
    shortfall: 0,
    poolSize: 0,
  };
}

function makeSavedCube(overrides: Partial<SavedCube> = {}): SavedCube {
  return {
    id: 'cube-1',
    name: 'Vintage 540',
    size: 180,
    cube: makeGeneratedCube(),
    picks: [],
    isPhysical: true,
    savedAt: Date.now(),
    ...overrides,
  };
}

function makeCopy(overrides: Partial<EnrichedCard> & { copyId: string }): EnrichedCard {
  return {
    name: 'Test Card',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'sf-test',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  } as EnrichedCard;
}

function makeBinder(
  overrides: Partial<Omit<BinderDef, 'filterGroups'>> & { filter?: BinderFilter } = {}
): BinderDef {
  const { filter, ...rest } = overrides;
  return {
    id: 'binder',
    name: 'Test Binder',
    position: 0,
    filterGroups: [{ filter: filter ?? {} }],
    sorts: [{ field: 'none', dir: 'asc' }],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#35568e',
    createdAt: 0,
    updatedAt: 0,
    ...rest,
  };
}

/** Scope queries to the interactive groups — a mirrored, hidden `.print-list`
 *  copy of the same text always sits alongside it (see CubePullList.tsx), so
 *  an unscoped `getByText` is ambiguous by design. */
function interactive(container: HTMLElement) {
  return within(container.querySelector('.cube-pull-groups') as HTMLElement);
}

function isChecked(el: HTMLElement): boolean {
  return (el as HTMLInputElement).checked;
}

beforeEach(() => {
  syncMock.state = 'ready';
  syncMock.error = false;
  pullListMock.shouldThrow = false;
  useAuth.setState({ status: 'guest' });
  useCubeStore.setState({ saved: [] });
  useCollectionStore.setState({ cards: [], binders: [], hydrating: false });
  localStorage.clear();
});

describe('CubePullList — loading', () => {
  it('shows a loading status while an authed device awaits its first pull', () => {
    useAuth.setState({ status: 'authed' });
    syncMock.state = 'syncing';
    const cube = makeSavedCube();
    render(<CubePullList cube={cube} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText(/located/)).toBeNull();
  });
});

describe('CubePullList — a sync error elsewhere does not touch this tab', () => {
  it('still renders the list when hasSyncError() is true (e.g. a deck push failed)', () => {
    const copy = makeCopy({ copyId: 'c1', name: 'Sol Ring', scryfallId: 'sf-sol' });
    const binder = makeBinder({ id: 'b1', name: 'Rares', position: 0 });
    useCollectionStore.setState({ cards: [copy], binders: [binder], hydrating: false });
    const cube = makeSavedCube({
      picks: [
        makePick({
          slotId: 'p1',
          card: makeCubeCard({ name: 'Sol Ring', oracleId: 'o1' }),
          allocatedCopyId: 'c1',
        }),
      ],
    });
    // This tab reads only local state, so a sync failure anywhere else in the
    // app (a deck push, an unrelated pull) must not replace its list with an
    // error — the pull list has nothing to do with whatever sync is doing.
    syncMock.error = true;
    const { container } = render(<CubePullList cube={cube} />);
    expect(screen.queryByRole('alert')).toBeNull();
    const scope = interactive(container);
    expect(scope.getByText('Rares')).toBeTruthy();
    expect(scope.getByText('Sol Ring')).toBeTruthy();
    expect(screen.getByText('1 of 1 located')).toBeTruthy();
  });
});

describe('CubePullList — a build error, with retry', () => {
  it('shows an error when materializing throws, and retry recomputes and recovers', () => {
    const copy = makeCopy({ copyId: 'c1', name: 'Sol Ring', scryfallId: 'sf-sol' });
    useCollectionStore.setState({ cards: [copy], binders: [], hydrating: false });
    const cube = makeSavedCube({
      picks: [
        makePick({
          slotId: 'p1',
          card: makeCubeCard({ name: 'Sol Ring', oracleId: 'o1' }),
          allocatedCopyId: 'c1',
        }),
      ],
    });
    pullListMock.shouldThrow = true;
    const { container } = render(<CubePullList cube={cube} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Couldn't build the pull list/)).toBeTruthy();

    // The underlying condition clears (a real crash would more likely be
    // fixed by the data changing, but the point here is that "Retry"
    // genuinely forces a recompute rather than being permanently stuck).
    pullListMock.shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(interactive(container).getByText('Sol Ring')).toBeTruthy();
  });
});

describe('CubePullList — loaded', () => {
  it('groups a located copy under its binder with a page heading and a slot number', () => {
    const copy = makeCopy({ copyId: 'c1', name: 'Sol Ring', scryfallId: 'sf-sol' });
    const binder = makeBinder({ id: 'b1', name: 'Rares', position: 0, color: '#b8862a' });
    useCollectionStore.setState({ cards: [copy], binders: [binder], hydrating: false });
    const cube = makeSavedCube({
      picks: [
        makePick({
          slotId: 'p1',
          card: makeCubeCard({ name: 'Sol Ring', oracleId: 'o1' }),
          allocatedCopyId: 'c1',
        }),
      ],
    });
    const { container } = render(<CubePullList cube={cube} />);
    const scope = interactive(container);
    expect(scope.getByText('Rares')).toBeTruthy();
    expect(scope.getByText('Page 1')).toBeTruthy();
    expect(scope.getByText('Sol Ring')).toBeTruthy();
    expect(scope.getByText('Slot 1')).toBeTruthy();
    expect(screen.getByText('1 of 1 located')).toBeTruthy();
    expect(scope.getByRole('checkbox')).toBeTruthy();
  });
});

describe('CubePullList — print checklist', () => {
  it('gives every pullable row a tick box, and no box to an unreserved row', () => {
    const copy = makeCopy({ copyId: 'c1', name: 'Sol Ring', scryfallId: 'sf-sol' });
    const binder = makeBinder({ id: 'b1', name: 'Rares', position: 0 });
    useCollectionStore.setState({ cards: [copy], binders: [binder], hydrating: false });
    const cube = makeSavedCube({
      picks: [
        makePick({
          slotId: 'p1',
          card: makeCubeCard({ name: 'Sol Ring', oracleId: 'o1' }),
          allocatedCopyId: 'c1',
        }),
        makePick({
          slotId: 'p2',
          card: makeCubeCard({ name: 'Ghost', oracleId: 'o2' }),
          allocatedCopyId: null,
        }),
      ],
    });
    const { container } = render(<CubePullList cube={cube} />);
    const printList = container.querySelector('.print-list') as HTMLElement;
    expect(printList).toBeTruthy();
    // One box for the located "Rares" row...
    const rowsWithBox = printList.querySelectorAll('.print-list-box');
    expect(rowsWithBox).toHaveLength(1);
    // ...and the box sits in the pullable row, not the "Not reserved" one.
    const raresSection = [...printList.querySelectorAll('.print-list-section')].find((s) =>
      s.textContent?.includes('Rares')
    );
    const notReservedSection = [...printList.querySelectorAll('.print-list-section')].find((s) =>
      s.textContent?.includes('Not reserved')
    );
    expect(raresSection?.querySelectorAll('.print-list-box')).toHaveLength(1);
    expect(notReservedSection?.querySelectorAll('.print-list-box')).toHaveLength(0);
  });
});

describe('CubePullList — all uncategorized (no binders)', () => {
  it('files every located pick under Uncategorized when the user has no binders', () => {
    const copy = makeCopy({ copyId: 'c1', name: 'Loner', scryfallId: 'sf-loner' });
    useCollectionStore.setState({ cards: [copy], binders: [], hydrating: false });
    const cube = makeSavedCube({
      picks: [
        makePick({
          slotId: 'p1',
          card: makeCubeCard({ name: 'Loner', oracleId: 'o1' }),
          allocatedCopyId: 'c1',
        }),
      ],
    });
    const { container } = render(<CubePullList cube={cube} />);
    const scope = interactive(container);
    expect(scope.getByText('Uncategorized')).toBeTruthy();
    expect(scope.getByText('Loner')).toBeTruthy();
    expect(scope.queryByText(/Page \d/)).toBeNull();
  });
});

describe('CubePullList — not reserved', () => {
  it('groups a never-owned pick and a pick whose copy left the collection under one label, with per-row reasons', () => {
    useCollectionStore.setState({ cards: [], binders: [], hydrating: false });
    const cube = makeSavedCube({
      picks: [
        makePick({
          slotId: 'p1',
          card: makeCubeCard({ name: 'Ghost', oracleId: 'o1' }),
          allocatedCopyId: null,
        }),
        makePick({
          slotId: 'p2',
          card: makeCubeCard({ name: 'Gone', oracleId: 'o2' }),
          allocatedCopyId: 'stale-copy',
        }),
      ],
    });
    const { container } = render(<CubePullList cube={cube} />);
    const scope = interactive(container);
    expect(scope.getByText('Not reserved')).toBeTruthy();
    expect(scope.getByText('Not owned')).toBeTruthy();
    expect(scope.getByText('The reserved copy is no longer in your collection')).toBeTruthy();
    // Nothing to check off for either row.
    expect(scope.queryByRole('checkbox')).toBeNull();
  });
});

describe('CubePullList — already out of your binders', () => {
  it('surfaces a copy a hideDeckAllocated binder swallows from its own view, naming that binder', () => {
    const copy = makeCopy({ copyId: 'c1', name: 'Force of Will', scryfallId: 'sf-fow' });
    const binder = makeBinder({ id: 'b1', name: 'Consignment', hideDeckAllocated: false });
    useCollectionStore.setState({ cards: [copy], binders: [binder], hydrating: false });
    const cube = makeSavedCube({
      picks: [
        makePick({
          slotId: 'p1',
          card: makeCubeCard({ name: 'Force of Will', oracleId: 'o1' }),
          allocatedCopyId: 'c1',
        }),
      ],
    });
    // The cube must be in useCubeStore.saved (and physical) for useAllocations()
    // to count its own reservation — the same full allocation set the real
    // Binders page feeds in.
    useCubeStore.setState({ saved: [cube] });
    const { container } = render(<CubePullList cube={cube} />);
    const scope = interactive(container);
    expect(scope.getByText('Already out of your binders')).toBeTruthy();
    expect(
      scope.getByText(
        'Consignment leaves out cards held by a deck or cube, so these are likely already pulled.'
      )
    ).toBeTruthy();
    expect(scope.getByText('Force of Will')).toBeTruthy();
    expect(scope.queryByRole('checkbox')).toBeNull();
  });

  it('names every swallowing binder, pluralized, when more than one hides cards', () => {
    const copyA = makeCopy({ copyId: 'a', name: 'Alpha', scryfallId: 'sf-a', rarity: 'common' });
    const copyB = makeCopy({ copyId: 'b', name: 'Beta', scryfallId: 'sf-b', rarity: 'rare' });
    const consignment = makeBinder({
      id: 'consignment',
      name: 'Consignment',
      position: 0,
      hideDeckAllocated: false,
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
    });
    const trades = makeBinder({
      id: 'trades',
      name: 'Trades',
      position: 1,
      hideDeckAllocated: false,
      filter: { rarities: { chips: [{ value: 'common', negate: false }], joiners: [] } },
    });
    useCollectionStore.setState({
      cards: [copyA, copyB],
      binders: [consignment, trades],
      hydrating: false,
    });
    const cube = makeSavedCube({
      picks: [
        makePick({
          slotId: 'p1',
          card: makeCubeCard({ name: 'Alpha', oracleId: 'o1' }),
          allocatedCopyId: 'a',
        }),
        makePick({
          slotId: 'p2',
          card: makeCubeCard({ name: 'Beta', oracleId: 'o2' }),
          allocatedCopyId: 'b',
        }),
      ],
    });
    useCubeStore.setState({ saved: [cube] });
    const { container } = render(<CubePullList cube={cube} />);
    const scope = interactive(container);
    expect(
      scope.getByText(
        'Consignment and Trades leave out cards held by a deck or cube, so these are likely already pulled.'
      )
    ).toBeTruthy();
  });
});

describe('CubePullList — ticks', () => {
  function makeCubeWithOnePullableRow() {
    const copy = makeCopy({ copyId: 'c1', name: 'Sol Ring', scryfallId: 'sf-sol' });
    useCollectionStore.setState({ cards: [copy], binders: [], hydrating: false });
    return makeSavedCube({
      picks: [
        makePick({
          slotId: 'p1',
          card: makeCubeCard({ name: 'Sol Ring', oracleId: 'o1' }),
          allocatedCopyId: 'c1',
        }),
      ],
    });
  }

  it('remembers a tick across a remount, keyed by cube id, and Clear ticks resets it', () => {
    const cube = makeCubeWithOnePullableRow();
    const { unmount } = render(<CubePullList cube={cube} />);
    expect(screen.queryByRole('button', { name: 'Clear ticks' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(isChecked(screen.getByRole('checkbox'))).toBe(true);
    unmount();

    render(<CubePullList cube={cube} />);
    expect(isChecked(screen.getByRole('checkbox'))).toBe(true);
    const clear = screen.getByRole('button', { name: 'Clear ticks' });
    fireEvent.click(clear);
    expect(isChecked(screen.getByRole('checkbox'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'Clear ticks' })).toBeNull();
  });

  it('does not leak ticks across two different cubes sharing one mounted instance', () => {
    const cubeA = makeSavedCube({ id: 'cube-a' });
    const copy = makeCopy({ copyId: 'c1', name: 'Sol Ring', scryfallId: 'sf-sol' });
    useCollectionStore.setState({ cards: [copy], binders: [], hydrating: false });
    const cubeB = makeSavedCube({
      id: 'cube-b',
      picks: [
        makePick({
          slotId: 'p1',
          card: makeCubeCard({ name: 'Sol Ring', oracleId: 'o1' }),
          allocatedCopyId: 'c1',
        }),
      ],
    });
    const { rerender } = render(<CubePullList cube={cubeB} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(isChecked(screen.getByRole('checkbox'))).toBe(true);
    rerender(<CubePullList cube={cubeA} />);
    rerender(<CubePullList cube={cubeB} />);
    expect(isChecked(screen.getByRole('checkbox'))).toBe(true);
  });

  it('degrades to in-memory-only ticks when storage throws on every read and write', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    try {
      const cube = makeCubeWithOnePullableRow();
      render(<CubePullList cube={cube} />);
      const checkbox = screen.getByRole('checkbox');
      expect(() => fireEvent.click(checkbox)).not.toThrow();
      expect(isChecked(checkbox)).toBe(true);
    } finally {
      getSpy.mockRestore();
      setSpy.mockRestore();
    }
  });
});
