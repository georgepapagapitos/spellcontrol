// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EnrichedCard } from '@/types/index';
import { makeDeckAllocationInfo } from '@/lib/collection/allocations-core';
import { breakdownCopies } from '@/lib/collection/copy-locations';
import type { CardLocation } from '@/lib/binder/card-locations';
import { CopyPlaces } from './CopyPlaces';
import { CardRow } from './CardRow';

function stubViewport(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /max-width:\s*599px/.test(query) ? phone : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const card = {
  copyId: 'c1',
  scryfallId: 'p1',
  oracleId: 'o1',
  name: 'Lightning Bolt',
  typeLine: 'Instant',
  colorIdentity: ['R'],
  rarity: 'common',
  setCode: 'm11',
  collectorNumber: '149',
  foil: false,
  purchasePrice: 1.23,
} as unknown as EnrichedCard;

const burn = makeDeckAllocationInfo('d1', 'Mono-Red Burn', '#b3392f', 'Lightning Bolt');
const red = { id: 'b1', name: 'Red Spells', color: '#a8452a' };
const modern = { id: 'b2', name: 'Modern Staples', color: '#2f6f8f' };

// The stack from the report: 1 in a deck (its pocket kept in Red Spells), 2
// more in Red Spells, 1 in Modern Staples, 1 in nothing.
const breakdown = breakdownCopies(
  ['c1', 'c2', 'c3', 'c4', 'c5'],
  new Map([['c1', burn]]),
  new Map([
    ['c1', red],
    ['c2', red],
    ['c3', red],
    ['c4', modern],
  ])
);

const at = (binderId: string, binderName: string, pageNum: number, slot: number): CardLocation => ({
  binderId,
  binderName,
  pageNum,
  slot,
});
const locations = new Map<string, CardLocation>([
  ['c1', at('b1', 'Red Spells', 4, 2)],
  ['c2', at('b1', 'Red Spells', 4, 3)],
  ['c3', at('b1', 'Red Spells', 4, 4)],
  ['c4', at('b2', 'Modern Staples', 2, 7)],
]);

const WHERE =
  'Where your copies are: 1 in Mono-Red Burn, 2 in Red Spells, 1 in Modern Staples, 1 not in a deck or binder';

function renderPlaces(placement: 'art' | 'row', extra: { interactive?: boolean } = {}) {
  return render(
    <MemoryRouter>
      <CopyPlaces
        card={card}
        breakdown={breakdown}
        locations={locations}
        placement={placement}
        {...extra}
      />
    </MemoryRouter>
  );
}

describe('CopyPlaces marks', () => {
  it('counts each mark that holds part of the stack, on art', () => {
    stubViewport(false);
    const { container } = renderPlaces('art');
    const counts = [...container.querySelectorAll('.copy-places-count')].map((n) => n.textContent);
    expect(counts).toEqual(['1', '3']);
    // The count sits on its own plate; the owner's color is only the disc.
    for (const plate of container.querySelectorAll('.copy-places-counted')) {
      expect(plate.querySelector('.identity-mark')).not.toBeNull();
    }
  });

  it('counts the row chips the same way', () => {
    stubViewport(false);
    const { container } = renderPlaces('row');
    const counts = [...container.querySelectorAll('.card-list-deck-badge-count')].map(
      (n) => n.textContent
    );
    expect(counts).toEqual(['1', '3']);
  });

  it('is one button named by the whole breakdown', () => {
    stubViewport(false);
    renderPlaces('art');
    const trigger = screen.getByRole('button', { name: WHERE });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('is a picture, not a button, in select mode', () => {
    stubViewport(false);
    renderPlaces('art', { interactive: false });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('img', { name: WHERE })).toBeTruthy();
  });

  it('renders nothing for a stack in no place', () => {
    stubViewport(false);
    const { container } = render(
      <MemoryRouter>
        <CopyPlaces
          card={card}
          breakdown={breakdownCopies(['c1', 'c2'], new Map(), new Map())}
          locations={new Map()}
          placement="art"
        />
      </MemoryRouter>
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('CopyPlaces list', () => {
  it('opens every place with its count and pocket, and the copies in none', () => {
    stubViewport(false);
    renderPlaces('art');
    fireEvent.click(screen.getByRole('button', { name: WHERE }));
    const panel = screen.getByRole('dialog', { name: WHERE });
    expect(within(panel).getByText('Lightning Bolt')).toBeTruthy();
    expect(within(panel).getByText('M11 · 5 copies')).toBeTruthy();
    const links = within(panel).getAllByRole('link');
    expect(links.map((l) => [l.getAttribute('href'), l.getAttribute('aria-label')])).toEqual([
      ['/decks/d1', 'Mono-Red Burn, Deck · its pocket is Red Spells · p. 4 · slot 2, 1 copy'],
      ['/collection/binders/b1?copy=c2', 'Red Spells, Binder · p. 4 · slots 3–4, 2 copies'],
      ['/collection/binders/b2?copy=c4', 'Modern Staples, Binder · p. 2 · slot 7, 1 copy'],
    ]);
    expect(within(panel).getByText('Not in a deck or binder')).toBeTruthy();
    expect(within(panel).getByText('1 copy')).toBeTruthy();
  });

  it("opens a binder at its earliest pocket, whatever the copies' order", () => {
    stubViewport(false);
    render(
      <MemoryRouter>
        <CopyPlaces
          card={card}
          breakdown={breakdownCopies(
            ['c7', 'c8', 'c9'],
            new Map(),
            new Map([
              ['c7', red],
              ['c8', red],
              ['c9', red],
            ])
          )}
          locations={
            new Map([
              ['c7', at('b1', 'Red Spells', 9, 1)],
              ['c8', at('b1', 'Red Spells', 3, 6)],
              ['c9', at('b1', 'Red Spells', 3, 2)],
            ])
          }
          placement="art"
        />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /Where your copies are/ }));
    expect(screen.getByRole('link', { name: /^Red Spells/ }).getAttribute('href')).toBe(
      '/collection/binders/b1?copy=c9'
    );
  });

  it('closes when a place is followed', () => {
    stubViewport(false);
    renderPlaces('art');
    fireEvent.click(screen.getByRole('button', { name: WHERE }));
    fireEvent.click(screen.getByRole('link', { name: /^Red Spells/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists a cube that only lists the card under its own heading', () => {
    stubViewport(false);
    render(
      <MemoryRouter>
        <CopyPlaces
          card={card}
          breakdown={breakdown}
          listedIn={[{ cubeId: 'q2', cubeName: 'Draft night' }]}
          locations={locations}
          placement="art"
        />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /listed in Draft night/ }));
    const list = screen.getByRole('list', { name: 'Listed, no copy held' });
    expect(within(list).getByRole('link', { name: 'Draft night, lists this card' })).toBeTruthy();
  });

  it('opens as a bottom sheet on a phone', () => {
    stubViewport(true);
    renderPlaces('art');
    fireEvent.click(screen.getByRole('button', { name: WHERE }));
    const sheet = screen.getByRole('dialog', { name: WHERE });
    expect(sheet.closest('.modal-backdrop--sheet')).not.toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('CopyPlaces inside a card row', () => {
  function renderRow() {
    const onActivate = vi.fn();
    render(
      <MemoryRouter>
        <CardRow
          card={card}
          qty={5}
          onActivate={onActivate}
          menu={null}
          copyPlaces={{ card, breakdown, locations }}
        />
      </MemoryRouter>
    );
    return onActivate;
  }

  it('opens the list without opening the card', () => {
    stubViewport(false);
    const onActivate = renderRow();
    fireEvent.click(screen.getByRole('button', { name: WHERE }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('keeps Enter on the trigger from opening the card', () => {
    stubViewport(false);
    const onActivate = renderRow();
    fireEvent.keyDown(screen.getByRole('button', { name: WHERE }), { key: 'Enter' });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('keeps a tap inside the open list from reaching the row', () => {
    // The panel is a portal; React still bubbles its events to the row.
    stubViewport(false);
    const onActivate = renderRow();
    fireEvent.click(screen.getByRole('button', { name: WHERE }));
    fireEvent.click(screen.getByText('Not in a deck or binder'));
    fireEvent.keyDown(screen.getByText('Not in a deck or binder'), { key: 'Enter' });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('still opens the card from the row itself', () => {
    stubViewport(false);
    const onActivate = renderRow();
    fireEvent.click(screen.getByText('Lightning Bolt'));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
