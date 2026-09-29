// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { BinderStartChooser, type BinderStart } from './BinderStartChooser';
import type { BinderDef, EnrichedCard } from '../types';
import { useCollectionStore } from '../store/collection';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../lib/card-tags', async (importActual) => ({
  ...(await importActual<typeof import('../lib/card-tags')>()),
  useCardTagsReady: () => true,
  useCardTagsError: () => false,
  useCardsWithTags: (cards: EnrichedCard[]) => cards,
}));

let n = 0;
function card(over: Partial<EnrichedCard> & { name: string }): EnrichedCard {
  n += 1;
  return {
    copyId: `c${n}`,
    scryfallId: `sf${n}`,
    oracleId: `o-${over.name}`,
    typeLine: 'Creature',
    colorIdentity: [],
    colors: [],
    rarity: 'common',
    purchasePrice: 0,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: String(n),
    quantity: 1,
    ...over,
  } as unknown as EnrichedCard;
}

const layout = { allocatedCopyIds: new Set<string>(), setMap: undefined };

function renderChooser(cards: EnrichedCard[], binders: BinderDef[] = []) {
  const onPick = vi.fn<(start: BinderStart) => void>();
  render(<BinderStartChooser cards={cards} binders={binders} layout={layout} onPick={onPick} />);
  return onPick;
}

describe('BinderStartChooser', () => {
  it('groups tiles under Pull out a pile / One slice / Deck-building pools', () => {
    renderChooser([]);
    const pull = screen.getByText('Pull out a pile').closest('.binder-start-group') as HTMLElement;
    expect(within(pull).getByRole('button', { name: /^Worth \$1 or more/ })).toBeTruthy();
    expect(within(pull).getByRole('button', { name: /^Trade binder/ })).toBeTruthy();
    expect(within(pull).getByRole('button', { name: /Commanders/ })).toBeTruthy();
    expect(within(pull).getByRole('button', { name: /Rares & mythics/ })).toBeTruthy();

    const slice = screen.getByText('One slice').closest('.binder-start-group') as HTMLElement;
    expect(within(slice).getByText('One color')).toBeTruthy();
    expect(within(slice).getByRole('button', { name: /A set/ })).toBeTruthy();
    expect(within(slice).getByRole('button', { name: /Lands/ })).toBeTruthy();

    const pool = screen
      .getByText('Deck-building pools')
      .closest('.binder-start-group') as HTMLElement;
    expect(within(pool).getByRole('button', { name: /^Ramp/ })).toBeTruthy();
    expect(within(pool).getByRole('button', { name: /Mana rocks only/ })).toBeTruthy();
    expect(within(pool).getByRole('button', { name: /Removal & counters/ })).toBeTruthy();

    // Dashed row, last, ungrouped.
    expect(screen.getByRole('button', { name: /^Blank/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Everything else/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /From a list/ })).toBeTruthy();
  });

  it("states each tile's named order", async () => {
    renderChooser([card({ name: 'A', rarity: 'rare' })]);
    const commanders = screen.getByRole('button', { name: /Commanders/ });
    expect(within(commanders).getByText('By color')).toBeTruthy();
    const rares = screen.getByRole('button', { name: /Rares & mythics/ });
    expect(within(rares).getByText('Set collection')).toBeTruthy();
  });

  it('a tile with nothing waiting above it shows matches and pages together', async () => {
    renderChooser([card({ name: 'A', rarity: 'rare' }), card({ name: 'B', rarity: 'mythic' })]);
    const rares = screen.getByRole('button', { name: /Rares & mythics/ });
    expect(await within(rares).findByText('2 cards · 1 page')).toBeTruthy();
  });

  it('names the binder claiming everything when a tile is fully outbid', async () => {
    const now = Date.now();
    const ramp: BinderDef = {
      id: 'ramp-binder',
      name: 'Ramp',
      position: 0,
      filterGroups: [
        {
          filter: {
            oracleTagChips: { chips: [{ value: 'mana-rock', negate: false }], joiners: [] },
          },
        },
      ],
      sorts: [],
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      color: '#000',
      createdAt: now,
      updatedAt: now,
    };
    const cards = [card({ name: 'Sol Ring', typeLine: 'Artifact', tags: ['mana-rock'] })];
    renderChooser(cards, [ramp]);
    const manaRocks = screen.getByRole('button', { name: /Mana rocks only/ });
    // Standing overlap note, always shown, independent of live binder state.
    expect(within(manaRocks).getByText('Part of Ramp')).toBeTruthy();
    // Live count: an actual Ramp binder already exists and claims all of it —
    // one sentence, no page count (there is nothing to page through).
    expect(await within(manaRocks).findByText('The only match is in Ramp now')).toBeTruthy();
  });

  it('states pages on the primary line and names the partial catch on a second, muted line', async () => {
    const now = Date.now();
    const commanders: BinderDef = {
      id: 'commanders-binder',
      name: 'Commanders',
      position: 0,
      filterGroups: [{ filter: { commanderEligible: true } }],
      sorts: [],
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      color: '#000',
      createdAt: now,
      updatedAt: now,
    };
    const cards = [
      card({ name: 'Rare One', rarity: 'rare' }),
      card({ name: 'Rare Two', rarity: 'rare' }),
      card({
        name: 'Legendary Rare',
        rarity: 'rare',
        typeLine: 'Legendary Creature — Human',
        legalities: { commander: 'legal' },
      }),
    ];
    renderChooser(cards, [commanders]);
    const rares = screen.getByRole('button', { name: /Rares & mythics/ });
    // Primary line is the would-land answer WITH its page count, even though
    // it's not the raw match — never a bare "N would land" with no pages.
    expect(await within(rares).findByText('2 cards · 1 page')).toBeTruthy();
    // Secondary, muted line explains the gap only because there is one.
    expect(within(rares).getByText('of 3 that match; 1 is in Commanders')).toBeTruthy();
  });

  it('the one-color pick is a real radiogroup, defaults to White, and seeds the pick on create', async () => {
    const cards = [
      card({ name: 'Blue card', colorIdentity: ['U'], colors: ['U'] }),
      card({ name: 'White card one', colorIdentity: ['W'], colors: ['W'] }),
      card({ name: 'White card two', colorIdentity: ['W'], colors: ['W'] }),
    ];
    const onPick = renderChooser(cards);
    const white = screen.getByRole('radio', { name: 'White' });
    const blue = screen.getByRole('radio', { name: 'Blue' });
    expect((white as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByText('2 white cards · 1 page')).toBeTruthy();

    // Keyboard-operable: a real <input type="radio"> group changes on click
    // (and, being native radios, on arrow keys in a real browser).
    fireEvent.click(blue);
    expect((blue as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByText('1 blue card · 1 page')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /One color/ }));
    expect(onPick).toHaveBeenCalledWith({
      kind: 'template',
      template: expect.objectContaining({ id: 'one-color' }),
      color: 'U',
    });
  });

  it('"Everything else" shows only what would land there, not the whole collection', async () => {
    const cards = [card({ name: 'A' }), card({ name: 'B' })];
    const onPick = renderChooser(cards);
    const tile = screen.getByRole('button', { name: /Everything else/ });
    expect(await within(tile).findByText('2 cards now · 1 page')).toBeTruthy();
    fireEvent.click(tile);
    expect(onPick).toHaveBeenCalledWith({ kind: 'catch-all' });
  });

  it('Trade binder counts spare copies, not the same pile as Worth $1 or more', async () => {
    // All four prices sit in the SAME $5–$20 price band ("Most valuable
    // first"'s own sections), so this test measures spare-copy counting, not
    // page-banding — a card priced $20+ or under $5 would split onto its own
    // page and make the page-count assertions about band boundaries instead.
    const cards = [
      card({ name: 'Sol Ring', purchasePrice: 9 }), // lowest copyId: the kept copy
      card({ name: 'Sol Ring', purchasePrice: 7 }), // spare
      card({ name: 'Sol Ring', purchasePrice: 6 }), // spare
      card({ name: 'Arcane Signet', purchasePrice: 8 }), // single copy: never spare
    ];
    renderChooser(cards);
    const worth = screen.getByRole('button', { name: /^Worth \$1 or more/ });
    // All 4 copies are worth $1+.
    expect(await within(worth).findByText('4 cards · 1 page')).toBeTruthy();
    const trade = screen.getByRole('button', { name: /^Trade binder/ });
    // Only the two spare Sol Rings: a different, smaller pile than Worth $1 or
    // more, with no overlap note left over.
    expect(await within(trade).findByText('2 cards · 1 page')).toBeTruthy();
    expect(within(trade).getByText('Your spare copies worth $1 or more')).toBeTruthy();
    expect(within(trade).queryByText(/Same cards as/)).toBeNull();
  });

  it('Trade binder leaves out copies a deck or cube holds', async () => {
    const cards = [
      card({ name: 'Sol Ring', purchasePrice: 9 }),
      card({ name: 'Sol Ring', purchasePrice: 7 }),
      card({ name: 'Sol Ring', purchasePrice: 6 }),
    ];
    const onPick = vi.fn<(start: BinderStart) => void>();
    render(
      <BinderStartChooser
        cards={cards}
        binders={[]}
        // One copy is in a deck: of the two loose copies one is kept, so one is spare.
        layout={{ allocatedCopyIds: new Set([cards[0].copyId]), setMap: undefined }}
        onPick={onPick}
      />
    );
    const trade = screen.getByRole('button', { name: /^Trade binder/ });
    expect(await within(trade).findByText('1 card · 1 page')).toBeTruthy();
  });

  it('a fully taken tile names the binder holding all of them', async () => {
    const now = Date.now();
    const everything: BinderDef = {
      id: 'all',
      name: 'Main binder',
      position: 0,
      filterGroups: [{ filter: {} }],
      sorts: [],
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      color: '#000',
      createdAt: now,
      updatedAt: now,
    };
    renderChooser(
      [card({ name: 'A', rarity: 'rare' }), card({ name: 'B', rarity: 'mythic' })],
      [everything]
    );
    const rares = screen.getByRole('button', { name: /Rares & mythics/ });
    expect(await within(rares).findByText('All 2 are in Main binder now')).toBeTruthy();
    // Nothing lands, so there is no page count and no second line.
    expect(within(rares).queryByText(/page|that match/)).toBeNull();
  });

  it('the one-color tile reads title, pips, then order and count, and its button is named for it', async () => {
    renderChooser([card({ name: 'W', colorIdentity: ['W'], colors: ['W'] })]);
    const tile = screen.getByText('One color').closest('.binder-start-tile') as HTMLElement;
    const parts = [...tile.children].map((el) => el.tagName.toLowerCase());
    expect(parts).toEqual(['span', 'fieldset', 'button']);
    // One button, named by the tile's title plus its own order and count.
    const button = within(tile).getByRole('button');
    expect(button.getAttribute('aria-labelledby')?.split(' ')).toHaveLength(2);
    expect(await within(tile).findByText('1 white card · 1 page')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^One color By card type 1 white card/ })).toBe(
      button
    );
  });

  it('Blank and From a list carry no order or count', () => {
    renderChooser([]);
    const blank = screen.getByRole('button', { name: /^Blank/ });
    expect(within(blank).queryByText(/page|match|Counting/)).toBeNull();
  });
});

describe('BinderStartChooser — the "Plan a shelf" lead tile (E496)', () => {
  it('leads the chooser when the collection has cards, and hides for an empty one', () => {
    renderChooser([card({ name: 'A' }), card({ name: 'B' })]);
    const lead = screen.getByRole('button', { name: /Organize my whole collection/ });
    // It comes before every job group.
    const firstGroup = screen.getByText('Pull out a pile');
    expect(
      lead.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(within(lead).getByText('Plan a shelf')).toBeTruthy();
  });

  it('is absent for an empty collection', () => {
    renderChooser([]);
    expect(screen.queryByText('Organize my whole collection')).toBeNull();
  });

  it('closes the editor and hands off to the binders index planner', () => {
    const setEditingBinder = vi.fn();
    useCollectionStore.setState({ setEditingBinder });
    renderChooser([card({ name: 'A' })]);
    fireEvent.click(screen.getByRole('button', { name: /Organize my whole collection/ }));
    expect(setEditingBinder).toHaveBeenCalledWith(null);
    expect(navigateMock).toHaveBeenCalledWith('/collection/binders?planShelf=1');
  });

  it('draws its shelf of spines as decoration only', () => {
    renderChooser([card({ name: 'A' })]);
    const shelf = document.querySelector('.binder-start-shelf');
    expect(shelf?.getAttribute('aria-hidden')).toBe('true');
    expect(shelf?.querySelectorAll('i').length).toBe(6);
  });
});
