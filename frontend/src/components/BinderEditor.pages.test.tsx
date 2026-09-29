// @vitest-environment happy-dom
/**
 * The Pages disclosure "as pictures" (E494/E473): pocket tiles, Sides, Holds
 * chips, the page-filling pictograms, "Leave room", and the editor's
 * over-capacity answer. Renders the real BinderEditor against the real
 * collection store — same harness as BinderEditor.flow.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { BinderDef, EnrichedCard } from '../types';
import { useCollectionStore } from '../store/collection';
import { BinderEditor } from './BinderEditor';

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
// Flipped by the "no standard size fits" test only — every other test uses
// the real `smallestFittingCapacity`. A real over-70-page fixture would work
// too, but this isolates the UI wiring from needing one.
let forceNoFit = false;
vi.mock('../lib/binder-volumes', async (importActual) => {
  const actual = await importActual<typeof import('../lib/binder-volumes')>();
  return {
    ...actual,
    smallestFittingCapacity: (...args: Parameters<typeof actual.smallestFittingCapacity>) =>
      forceNoFit ? null : actual.smallestFittingCapacity(...args),
  };
});

function makeBinderDef(overrides: Partial<BinderDef> = {}): BinderDef {
  const now = Date.now();
  return {
    id: 'b1',
    name: 'Trade box',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [{ field: 'color', dir: 'asc' }],
    pocketSize: 9,
    doubleSided: false,
    fixedCapacity: null,
    color: '#888',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function card(copyId: string, colorIdentity: string[] = ['W']): EnrichedCard {
  return {
    copyId,
    scryfallId: `s-${copyId}`,
    oracleId: `o-${copyId}`,
    name: `Card ${copyId}`,
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: copyId,
    rarity: 'common',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    typeLine: 'Creature',
    colorIdentity,
  } as EnrichedCard;
}

beforeEach(() => {
  useCollectionStore.setState({
    editingBinder: null,
    editingBinderSeed: null,
    binders: [],
    cards: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function open(id: string) {
  render(<BinderEditor />);
  act(() => {
    useCollectionStore.setState({ editingBinder: id });
  });
}

/** Opens the editor on `existing`, settles the debounced draft preview (E493)
 *  it shares with the over-capacity answer, and opens the Pages disclosure. */
function openToPages(existing: BinderDef, cards: EnrichedCard[] = []) {
  vi.useFakeTimers();
  useCollectionStore.setState({ binders: [existing], cards });
  open(existing.id);
  act(() => {
    vi.advanceTimersByTime(250);
  });
  fireEvent.click(screen.getByRole('button', { name: /Pages/ }));
}

describe('Pockets per page — tiles', () => {
  it('names each tile by count and what it is, and selecting one is a normal radio pick', () => {
    openToPages(makeBinderDef());
    const nine = screen.getByRole('radio', { name: '9-pocket, Most binders' });
    expect(nine).toHaveProperty('checked', true);
    // Native radio semantics (focus + keyboard activation) are the kit's own
    // guarantee, covered once in shared/form.test.tsx; here we only check
    // BinderEditor wires the tile correctly and it's reachable by keyboard.
    expect(nine.tabIndex).not.toBe(-1);

    const four = screen.getByRole('radio', { name: '4-pocket, Toploader pages' });
    fireEvent.click(four);
    expect(four).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: '12-pocket, Zip binders' })).toBeTruthy();
  });
});

describe('Sides — segmented, not a switch', () => {
  it('is a two-option segmented control naming both outcomes', () => {
    const onSave = vi.fn();
    useCollectionStore.setState({ updateBinder: onSave });
    openToPages(makeBinderDef({ doubleSided: false }));
    expect(screen.getByRole('radio', { name: 'One side' })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('radio', { name: 'Both sides' }));
    expect(screen.getByRole('radio', { name: 'Both sides' })).toHaveProperty('checked', true);
  });
});

describe('Holds — capacity chips', () => {
  it('lists the standard sizes for the current pocket size, with No limit and Other', () => {
    openToPages(makeBinderDef({ pocketSize: 9, fixedCapacity: null }));
    expect(screen.getByRole('radio', { name: 'No limit' })).toHaveProperty('checked', true);
    for (const size of ['360', '480', '640']) {
      expect(screen.getByRole('radio', { name: `${size} cards` })).toBeTruthy();
    }
    expect(screen.getByRole('radio', { name: 'Other…' })).toBeTruthy();
  });

  it('offers the sizes a 4-pocket binder is sold in, not the 9-pocket sizes', () => {
    openToPages(makeBinderDef({ pocketSize: 4, fixedCapacity: null }));
    expect(screen.getByRole('radio', { name: '160 cards' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: '360 cards' })).toBeNull();
  });

  it('picking a standard chip sets capacity directly and states the sheets it takes', () => {
    openToPages(makeBinderDef({ pocketSize: 9, fixedCapacity: null }));
    fireEvent.click(screen.getByRole('radio', { name: '480 cards' }));
    expect(screen.getByRole('radio', { name: '480 cards' })).toHaveProperty('checked', true);
    const count = document.querySelector('.binder-holds-count') as HTMLElement;
    expect(count.textContent).toMatch(/480\s*cards · \d+ sheets/);
  });

  it('Other… reveals a number input and a custom size stays on Other', () => {
    openToPages(makeBinderDef({ pocketSize: 9, fixedCapacity: null }));
    expect(screen.queryByLabelText('Capacity in cards')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Other…' }));
    const input = screen.getByLabelText('Capacity in cards') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.blur(input);
    expect(screen.getByRole('radio', { name: 'Other…' })).toHaveProperty('checked', true);
    expect((screen.getByLabelText('Capacity in cards') as HTMLInputElement).value).toBe('500');
  });

  it('a stored non-standard capacity already reads as Other, with its input visible', () => {
    openToPages(makeBinderDef({ pocketSize: 9, fixedCapacity: 500 }));
    expect(screen.getByRole('radio', { name: 'Other…' })).toHaveProperty('checked', true);
    expect((screen.getByLabelText('Capacity in cards') as HTMLInputElement).value).toBe('500');
  });
});

describe('When a section ends — filling pictograms', () => {
  it('draws a decorative two-page pictogram beside each option, out of the accessible name', () => {
    openToPages(makeBinderDef());
    for (const name of ['New page per section', 'Keep sections whole', 'Fill every pocket']) {
      const radio = screen.getByRole('radio', { name: new RegExp(`^${name}`) });
      const pic = radio.closest('label')?.querySelector('.binder-fill-pic');
      expect(pic).toBeTruthy();
      expect(pic?.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

describe('Section headers come from — names the actual field and rules', () => {
  it('names the first sort field, and keeps Each rule in view, disabled, with the reason', () => {
    openToPages(makeBinderDef({ filterGroups: [{ filter: {} }] }));
    fireEvent.click(screen.getByRole('button', { name: /Order/ }));
    expect(screen.getByRole('radio', { name: /The first field above \(Color\)/ })).toHaveProperty(
      'checked',
      true
    );
    expect(screen.getByRole('radio', { name: /^Each rule/ })).toHaveProperty('disabled', true);
    expect(screen.getByText(/Needs two or more rules\./)).toBeTruthy();
  });

  it('enables Each rule once there are two rules, naming the headers it will print', () => {
    openToPages(makeBinderDef({ filterGroups: [{ filter: {}, name: 'Rocks' }, { filter: {} }] }));
    fireEvent.click(screen.getByRole('button', { name: /Order/ }));
    expect(screen.getByRole('radio', { name: /^Each rule/ })).toHaveProperty('disabled', false);
    expect(screen.getByText('“Rocks”, then “Rule 2”.')).toBeTruthy();
  });
});

describe('page breaks — kept in view, disabled with the reason, when they cannot apply', () => {
  const twoSorts: BinderDef['sorts'] = [
    { field: 'color', dir: 'asc' },
    { field: 'name', dir: 'asc' },
  ];

  it('are disabled under rule sections, while page filling stays live (the engine packs rules too)', () => {
    openToPages(
      makeBinderDef({
        filterGroups: [{ filter: {} }, { filter: {} }],
        sectionMode: 'group',
        sorts: twoSorts,
      })
    );
    expect(screen.getByRole('button', { name: 'Page breaks' })).toHaveProperty('disabled', true);
    expect(
      screen.getByText('Sections come from your rules here, so pages break only between rules.')
    ).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Keep sections whole/ })).toHaveProperty(
      'disabled',
      false
    );
  });

  it('are disabled while sections share pages, and come back under New page per section', () => {
    openToPages(makeBinderDef({ sorts: twoSorts, packSections: true }));
    expect(screen.getByRole('button', { name: 'Page breaks' })).toHaveProperty('disabled', true);
    expect(
      screen.getByText('Sections share pages here. Pick New page per section to break deeper.')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /^New page per section/ }));
    expect(screen.getByRole('button', { name: 'Page breaks' })).toHaveProperty('disabled', false);
  });
});

describe('Leave room after each section', () => {
  it('offers None / Half a page / A full page under New page per section', () => {
    openToPages(makeBinderDef({ pocketSize: 4, packSections: false }));
    expect(screen.getByRole('radio', { name: 'None' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'Half a page' })).toHaveProperty('disabled', false);
    fireEvent.click(screen.getByRole('radio', { name: 'A full page' }));
    expect(screen.getByRole('radio', { name: 'A full page' })).toHaveProperty('checked', true);
    // A Disclosure shows its summary only while closed.
    fireEvent.click(screen.getByRole('button', { name: /Pages/ }));
    const pagesRow = screen.getByRole('button', { name: /Pages/ });
    expect(pagesRow.textContent).toMatch(/a free page after each section/);
  });

  it('is disabled, with the reason in view, while sections share pages', () => {
    openToPages(makeBinderDef({ packSections: 'continuous' }));
    expect(screen.getByRole('radio', { name: 'Half a page' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('radio', { name: 'None' })).toHaveProperty('checked', true);
    expect(
      screen.getByText(
        'Sections share pages here, so there is no page end to leave room at. Pick New page per section to use it.'
      )
    ).toBeTruthy();
  });
});

describe("the editor's over-capacity answer", () => {
  // 9 pockets, capacity 9 (one page): 20 one-color cards take 3 pages, so the
  // binder fills more than one physical book.
  const cards = () => Array.from({ length: 20 }, (_, i) => card(String(i)));

  it('states the volumes fact in the closed summary and lists them in the open body', () => {
    openToPages(makeBinderDef({ fixedCapacity: 9, sorts: [] }), cards());
    fireEvent.click(screen.getByRole('button', { name: /Pages/ })); // close it
    const pagesRow = screen.getByRole('button', { name: /Pages/ });
    expect(pagesRow.textContent).toMatch(/20 cards need \d+ binders of 9/);

    fireEvent.click(pagesRow); // reopen
    expect(screen.getByText(/^20 cards need \d+ binders of 9\.$/)).toBeTruthy();
    expect(document.querySelectorAll('.binder-editor-volumes-list li').length).toBeGreaterThan(1);
  });

  it('"Use a 360-card binder" sets the draft capacity as a normal draft edit (no toast)', () => {
    openToPages(makeBinderDef({ fixedCapacity: 9, sorts: [] }), cards());
    fireEvent.click(screen.getByRole('button', { name: 'Use a 360-card binder' }));
    expect(screen.getByRole('radio', { name: '360 cards' })).toHaveProperty('checked', true);
    // Once the debounced draft preview settles on the new capacity, this small
    // binder fits one book, so the over-capacity answer clears.
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(document.querySelector('.binder-editor-volumes-answer')).toBeNull();
  });

  it('says it stays in N volumes when no standard size fits', () => {
    forceNoFit = true;
    try {
      openToPages(makeBinderDef({ fixedCapacity: 9, sorts: [] }), cards());
      expect(screen.getByText(/No standard size holds it in one book/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Use a .*-card binder$/ })).toBeNull();
    } finally {
      forceNoFit = false;
    }
  });
});
