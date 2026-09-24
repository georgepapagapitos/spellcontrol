// @vitest-environment happy-dom
/**
 * The binder editor's flow (board T139): a new binder starts from a starting
 * point, the rules are the body, the footer states how many cards land, and
 * every setting still persists through the save handler's field whitelist.
 *
 * These render the real BinderEditor against the real collection store, with
 * single actions swapped for spies — a field that toggles fine in local state
 * but never reaches `updateBinder` can only be caught through the save path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { BinderDef, EnrichedCard } from '../types';
import { useCollectionStore } from '../store/collection';
import { BinderEditor } from './BinderEditor';

// Offline: the Scryfall catalogs and the oracle-tag snapshot are network
// loads the editor starts on open. Neither is what these tests are about.
vi.mock('../lib/scryfall-catalog', () => ({
  fetchTypeSuggestions: async () => [],
  fetchOracleSuggestions: async () => [],
}));
vi.mock('../lib/card-tags', async (importActual) => ({
  ...(await importActual<typeof import('../lib/card-tags')>()),
  useCardTagsReady: () => true,
  useCardTagsError: () => false,
  useCardsWithTags: (cards: EnrichedCard[]) => cards,
}));

/** The footer's answer line, read whole (the number is its own element). */
const landLine = () => screen.getByText(/lands? here/).closest('strong')?.textContent ?? '';

function makeBinderDef(overrides: Partial<BinderDef> = {}): BinderDef {
  const now = Date.now();
  return {
    id: 'b1',
    name: 'Trade box',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [],
    pocketSize: 9,
    doubleSided: false,
    fixedCapacity: null,
    color: '#888',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function card(copyId: string, rarity: string): EnrichedCard {
  return {
    copyId,
    scryfallId: `s-${copyId}`,
    oracleId: `o-${copyId}`,
    name: `Card ${copyId}`,
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: copyId,
    rarity,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    typeLine: 'Creature',
  } as EnrichedCard;
}

const RARES = {
  rarities: {
    chips: [
      { value: 'rare', negate: false },
      { value: 'mythic', negate: false },
    ],
    joiners: ['OR' as const],
  },
};

beforeEach(() => {
  useCollectionStore.setState({
    editingBinder: null,
    editingBinderSeed: null,
    binders: [],
    cards: [],
  });
});

/**
 * Mounts CLOSED, then opens via a separate store update — the real lifecycle.
 * The editor hydrates from `existing` on the false→true `isOpen` transition,
 * so seeding `editingBinder` before the first render would skip hydration.
 */
function open(id: string) {
  render(<BinderEditor />);
  act(() => {
    useCollectionStore.setState({ editingBinder: id });
  });
}

describe('a new binder starts from a starting point', () => {
  it('opens on the chooser, and a template names the binder and fills its rule', () => {
    useCollectionStore.setState({
      cards: [card('1', 'rare'), card('2', 'mythic'), card('3', 'common')],
    });
    open('new');

    expect(screen.getByText('What goes in it?')).toBeTruthy();
    const rares = screen.getByRole('button', { name: /Rares & mythics/ });
    // The tile says how many of the user's own cards it would take.
    expect(within(rares).getByText('2 of your cards')).toBeTruthy();

    fireEvent.click(rares);
    expect((screen.getByLabelText('Binder name') as HTMLInputElement).value).toBe(
      'Rares & mythics'
    );
    // The footer states the answer: both rares land in this new binder.
    expect(landLine()).toBe('2 cards land here');
  });

  it('Blank goes to an empty rule, and Back returns to the chooser', () => {
    open('new');
    fireEvent.click(screen.getByRole('button', { name: /Blank/ }));
    expect(screen.getByRole('button', { name: 'Add condition' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to ways to start' }));
    expect(screen.getByText('What goes in it?')).toBeTruthy();
  });

  it('From a list shows only what an import uses', () => {
    open('new');
    fireEvent.click(screen.getByRole('button', { name: /From a list/ }));
    expect(screen.getByLabelText('Card list')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Mark all as proxies' })).toBeTruthy();
    // Membership switches do nothing on a binder of pinned cards.
    expect(screen.queryByRole('switch', { name: /Keep every printing together/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create and import' })).toBeTruthy();
  });

  it('skips the chooser for a seeded "save as a binder"', () => {
    render(<BinderEditor />);
    act(() => {
      useCollectionStore.setState({
        editingBinder: 'new',
        editingBinderSeed: { name: 'From filters', groups: [{ filter: RARES }] },
      });
    });
    expect(screen.queryByText('What goes in it?')).toBeNull();
    expect((screen.getByLabelText('Binder name') as HTMLInputElement).value).toBe('From filters');
  });
});

describe('Offer for trade persists through the save whitelist', () => {
  it('turning it on calls updateBinder with tradeable: true', () => {
    const existing = makeBinderDef({ tradeable: false });
    const updateBinder = vi.fn();
    useCollectionStore.setState({ binders: [existing], updateBinder });
    open(existing.id);

    const toggle = screen.getByRole('switch', { name: 'Offer for trade' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateBinder).toHaveBeenCalledWith(
      existing.id,
      expect.objectContaining({ tradeable: true })
    );
  });

  it('saving an unrelated change keeps an existing tradeable: true', () => {
    const existing = makeBinderDef({ tradeable: true });
    const updateBinder = vi.fn();
    useCollectionStore.setState({ binders: [existing], updateBinder });
    open(existing.id);

    fireEvent.change(screen.getByLabelText('Binder name'), {
      target: { value: 'Renamed binder' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateBinder).toHaveBeenCalledWith(
      existing.id,
      expect.objectContaining({ tradeable: true, name: 'Renamed binder' })
    );
  });
});

describe('Order and Pages are collapsed rows that state their value', () => {
  it('shows the summary closed, and the settings once opened', () => {
    const existing = makeBinderDef({ pocketSize: 12, doubleSided: true, fixedCapacity: 480 });
    useCollectionStore.setState({ binders: [existing] });
    open(existing.id);

    const pages = screen.getByRole('button', { name: /Pages/ });
    expect(pages.getAttribute('aria-expanded')).toBe('false');
    expect(pages.textContent).toMatch(/12-pocket · both sides · New page per section · 480 cards/);

    fireEvent.click(pages);
    expect(screen.getByRole('radio', { name: '12-pocket' })).toHaveProperty('checked', true);
    expect(screen.getByRole('switch', { name: 'Double-sided sheets' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Fit whole sections/ })).toBeTruthy();
  });

  it('a pocket change in Pages persists on save', () => {
    const existing = makeBinderDef();
    const updateBinder = vi.fn();
    useCollectionStore.setState({ binders: [existing], updateBinder });
    open(existing.id);

    fireEvent.click(screen.getByRole('button', { name: /Pages/ }));
    fireEvent.click(screen.getByRole('radio', { name: '4-pocket' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(updateBinder).toHaveBeenCalledWith(
      existing.id,
      expect.objectContaining({ pocketSize: 4 })
    );
  });
});

describe('the zero-landing warning offers the fix', () => {
  it('"Move above" previews the new position and applies it on save', () => {
    const catcher = makeBinderDef({ id: 'lair', name: 'Secret Lair', position: 0 });
    const editing = makeBinderDef({
      id: 'rares',
      name: 'Rares',
      position: 1,
      filterGroups: [{ filter: RARES }],
    });
    const moveBinderAbove = vi.fn();
    useCollectionStore.setState({
      binders: [catcher, editing],
      cards: [card('1', 'rare'), card('2', 'mythic')],
      moveBinderAbove,
      updateBinder: vi.fn(),
    });
    open('rares');

    // The catch-all above takes both rares, so this binder would be empty.
    expect(landLine()).toBe('0 cards land here');
    fireEvent.click(screen.getByRole('button', { name: 'Move above Secret Lair' }));

    // Previewed immediately, applied only on save.
    expect(landLine()).toBe('2 cards land here');
    expect(screen.getByText(/when you save/)).toBeTruthy();
    expect(moveBinderAbove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(moveBinderAbove).toHaveBeenCalledWith('rares', 'lair');
  });
});

// ── "No conditions" warning waits for interaction on a NEW binder ─────────
// The amber banner used to fire the instant "New binder" opened — before the
// user had typed anything. It now waits until they have authored something:
// a name, a rule edit, or a save attempt. Existing binders with no conditions
// still warn straight away.
describe('empty-rule warning gating', () => {
  const WARNING = /This binder has no conditions/;

  function openBlank() {
    open('new');
    fireEvent.click(screen.getByRole('button', { name: /Blank/ }));
  }

  it('is silent on a fresh blank binder, then fires once the binder is named', () => {
    openBlank();
    expect(screen.queryByText(WARNING)).toBeNull();

    fireEvent.change(screen.getByLabelText('Binder name'), {
      target: { value: 'Bulk rares' },
    });
    expect(screen.getByText(WARNING)).toBeTruthy();
  });

  it('fires on a save attempt even with nothing typed', () => {
    openBlank();
    fireEvent.click(screen.getByRole('button', { name: 'Create binder' }));
    expect(screen.getByText('Name is required')).toBeTruthy();
    expect(screen.getByText(WARNING)).toBeTruthy();
  });

  it('fires after a rule edit (adding a rule counts as authoring)', () => {
    openBlank();
    fireEvent.click(screen.getByRole('button', { name: '+ Or match other cards too' }));
    expect(screen.getByText(WARNING)).toBeTruthy();
  });

  it('still warns immediately on an EXISTING binder with no conditions', () => {
    useCollectionStore.setState({ binders: [makeBinderDef({ id: 'b-empty' })] });
    open('b-empty');
    expect(screen.getByText(WARNING)).toBeTruthy();
  });
});
