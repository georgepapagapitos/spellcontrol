// @vitest-environment happy-dom
/**
 * No `@testing-library/jest-dom` in this repo — assertions use plain
 * vitest/chai matchers, not `.toBeInTheDocument()`/`.toHaveAccessibleName()`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OpponentRail, type OpponentSeat } from './OpponentRail';
import type { PublicBattlefieldCard, PublicBoard } from '@/lib/playtest/projection';

// The full board inspector is exercised by its own OpponentBoardModal.test.tsx
// (art/Scryfall resolution, tabs, preview wiring). Stubbed here so this file
// stays focused on the rail's own rendering + the fact that a tap opens it.
vi.mock('./OpponentBoardModal', () => ({
  OpponentBoardModal: (props: { opp: OpponentSeat; onClose: () => void }) => (
    <div data-testid="opponent-board-modal" data-opp-name={props.opp.name}>
      <button type="button" onClick={props.onClose}>
        stub close
      </button>
    </div>
  ),
}));

function bfCard(id: string, overrides: Partial<PublicBattlefieldCard> = {}): PublicBattlefieldCard {
  return {
    card: { id, name: `Card ${id}` },
    tapped: false,
    counters: {},
    stickers: [],
    x: 0,
    y: 0,
    faceDown: false,
    ...overrides,
  };
}

function board(seat: number, overrides: Partial<PublicBoard> = {}): PublicBoard {
  return {
    seat,
    turn: 1,
    life: 40,
    commanderTax: {},
    monarch: false,
    initiative: false,
    citysBlessing: false,
    battlefield: [],
    graveyard: [],
    exile: [],
    command: [],
    handCount: 0,
    libraryCount: 99,
    ...overrides,
  };
}

function seat(n: number, overrides: Partial<PublicBoard> = {}): OpponentSeat {
  return { name: `Player ${n}`, board: board(n, overrides) };
}

/** Simulate a viewport by evaluating the component's real media query against
 *  an orientation AND a width, so the `min-width: 900px` half of the glance
 *  gate is actually exercised — a stub that only looks at `orientation` would
 *  report glance for a sideways phone and hide the very regression the floor
 *  exists to prevent. */
function stubViewport(landscape: boolean, width = 1280) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const wantsLandscape = /orientation:\s*landscape/.test(query);
    const minWidth = /min-width:\s*(\d+)px/.exec(query);
    const matches = (!wantsLandscape || landscape) && (!minWidth || width >= Number(minWidth[1]));
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  });
}

/** Back-compat alias for the existing cases: landscape at a desktop width. */
function stubOrientation(landscape: boolean) {
  stubViewport(landscape);
}

beforeEach(() => {
  stubOrientation(false);
});

describe('OpponentRail', () => {
  it('renders nothing for an empty roster', () => {
    const { container } = render(<OpponentRail opponents={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it.each([1, 2, 3])('renders %i opponents as list items', (n) => {
    const opponents = Array.from({ length: n }, (_, i) => seat(i));
    render(<OpponentRail opponents={opponents} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(n);
  });

  it('uses real list semantics', () => {
    render(<OpponentRail opponents={[seat(0)]} />);
    expect(screen.getByRole('list', { name: 'Opponents' })).toBeTruthy();
  });

  // The long-axis rule assumes the long axis has SLACK. A phone held sideways
  // is landscape but 844px wide — a side rail plus N mounted mini battlefields
  // there eats width the board can't spare, at a size nothing is legible in.
  it('stays on presence density in landscape when the viewport is too narrow', () => {
    stubViewport(true, 844); // phone in landscape
    const { container } = render(<OpponentRail opponents={[seat(0), seat(1), seat(2)]} />);
    expect(container.querySelector('.opponent-rail--presence')).toBeTruthy();
    expect(container.querySelector('.opponent-rail--glance')).toBeNull();
  });

  it('switches to glance density in landscape once there is room', () => {
    stubViewport(true, 1024); // tablet in landscape
    const { container } = render(<OpponentRail opponents={[seat(0), seat(1), seat(2)]} />);
    expect(container.querySelector('.opponent-rail--glance')).toBeTruthy();
    expect(container.querySelector('.opponent-rail--presence')).toBeNull();
  });

  it('renders a redacted face-down battlefield card as a card back, never a name', () => {
    stubOrientation(true); // glance density renders the mini battlefield
    const opponents = [
      seat(0, {
        battlefield: [
          bfCard('secret1', { faceDown: true, card: { id: 'secret1' } }),
          bfCard('visible1', { faceDown: false }),
        ],
      }),
    ];
    const { container } = render(<OpponentRail opponents={opponents} />);
    // Never leaks a face-down card's identity anywhere in the render.
    expect(container.innerHTML).not.toContain('secret1');
    // Renders as a card back, not blank/absent.
    expect(container.querySelector('.opponent-mini-card__back')).not.toBeNull();
    // The visible permanent is still titled normally.
    expect(container.querySelector('[title="Card visible1"]')).not.toBeNull();
  });

  it('renders hand/library counts from the projected counts, in glance density', () => {
    stubOrientation(true);
    const opponents = [seat(0, { handCount: 4, libraryCount: 32 })];
    render(<OpponentRail opponents={opponents} />);
    expect(screen.getByText('Hand 4 · Library 32')).toBeTruthy();
  });

  it('folds hand/library counts into the accessible label in presence density too', () => {
    stubOrientation(false);
    const opponents = [seat(0, { handCount: 4, libraryCount: 32 })];
    render(<OpponentRail opponents={opponents} />);
    const label = screen.getByRole('button').getAttribute('aria-label') ?? '';
    expect(label).toMatch(/4 cards in hand/);
    expect(label).toMatch(/32 in library/);
  });

  it('shows a designation only when held, never a bare badge for one not held', () => {
    const opponents = [seat(0, { monarch: true, initiative: false, citysBlessing: false })];
    render(<OpponentRail opponents={opponents} />);
    expect(screen.getByTitle('Monarch')).toBeTruthy();
    expect(screen.queryByTitle('Initiative')).toBeNull();
    expect(screen.queryByTitle("City's Blessing")).toBeNull();
  });

  it('renders no designation badges when none are held', () => {
    const opponents = [seat(0)];
    const { container } = render(<OpponentRail opponents={opponents} />);
    expect(container.querySelector('.opponent-entry__designations')).toBeNull();
  });

  it('names held designations in the accessible label', () => {
    const opponents = [seat(0, { monarch: true, initiative: true })];
    render(<OpponentRail opponents={opponents} />);
    const label = screen.getByRole('button').getAttribute('aria-label') ?? '';
    expect(label).toMatch(/holds Monarch, Initiative/);
  });

  it('marks the active seat with aria-current and announces whose turn it is', () => {
    const opponents = [seat(0), seat(1)];
    render(<OpponentRail opponents={opponents} activeSeat={1} />);
    const items = screen.getAllByRole('button');
    expect(items[0].getAttribute('aria-current')).toBeNull();
    expect(items[1].getAttribute('aria-current')).toBe('true');
    expect(items[1].getAttribute('aria-label') ?? '').toMatch(/this player's turn/);
  });

  it('announces life as part of a sentence, not a bare number', () => {
    const opponents = [seat(0, { life: 34 })];
    render(<OpponentRail opponents={opponents} />);
    const label = screen.getByRole('button').getAttribute('aria-label') ?? '';
    expect(label).toMatch(/34 life/);
  });

  it('never conveys color identity by color alone — name text is always present too', () => {
    const opponents = [seat(0)];
    const { container } = render(<OpponentRail opponents={opponents} />);
    const dot = container.querySelector('.opponent-entry__dot');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Player 0')).toBeTruthy();
  });

  // A seated player who hasn't published a board yet still gets a seat in
  // the rail (never omitted — see "no opponent may ever be hidden"), but its
  // placeholder board's zeroed handCount/libraryCount/battlefield are not
  // real information, so `pending` swaps them for a distinct line rather
  // than rendering a fabricated "0 permanents · empty hand".
  it('shows a "no board shared yet" line for a pending seat, in presence density', () => {
    stubOrientation(false);
    const opponents = [{ ...seat(0, { life: 40 }), pending: true }];
    render(<OpponentRail opponents={opponents} />);
    expect(screen.getByText('No board shared yet')).toBeTruthy();
    expect(screen.queryByText('0 permanents')).toBeNull();
  });

  it('shows the same pending line instead of the mini battlefield in glance density', () => {
    stubOrientation(true);
    const opponents = [{ ...seat(0, { life: 40 }), pending: true }];
    const { container } = render(<OpponentRail opponents={opponents} />);
    expect(screen.getByText('No board shared yet')).toBeTruthy();
    expect(container.querySelector('.opponent-entry__battlefield')).toBeNull();
    expect(screen.queryByText(/Hand \d+ · Library \d+/)).toBeNull();
  });

  it('still shows the pending seat’s real life total, and folds the pending state into the accessible label', () => {
    stubOrientation(false);
    const opponents = [{ ...seat(0, { life: 27 }), pending: true }];
    render(<OpponentRail opponents={opponents} />);
    expect(screen.getByText('27')).toBeTruthy();
    const label = screen.getByRole('button').getAttribute('aria-label') ?? '';
    expect(label).toMatch(/27 life/);
    expect(label).toMatch(/no board shared yet/);
    expect(label).not.toMatch(/in hand/);
    expect(label).not.toMatch(/in library/);
  });

  describe('the full-board inspector', () => {
    it('gives each entry real button semantics that announce a dialog trigger', () => {
      const opponents = [seat(0)];
      render(<OpponentRail opponents={opponents} />);
      const btn = screen.getByRole('button');
      expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    });

    it('does not render the inspector until an entry is opened', () => {
      const opponents = [seat(0), seat(1)];
      render(<OpponentRail opponents={opponents} />);
      expect(screen.queryByTestId('opponent-board-modal')).toBeNull();
    });

    it('opens the tapped opponent’s board inspector', () => {
      const opponents = [seat(0), seat(1, { life: 12 })];
      render(<OpponentRail opponents={opponents} />);
      fireEvent.click(screen.getAllByRole('button')[1]);
      const modal = screen.getByTestId('opponent-board-modal');
      expect(modal.getAttribute('data-opp-name')).toBe('Player 1');
    });

    it('closes the inspector and returns to the plain rail', () => {
      const opponents = [seat(0)];
      render(<OpponentRail opponents={opponents} />);
      fireEvent.click(screen.getByRole('button', { name: /Player 0/ }));
      expect(screen.getByTestId('opponent-board-modal')).toBeTruthy();
      fireEvent.click(screen.getByText('stub close'));
      expect(screen.queryByTestId('opponent-board-modal')).toBeNull();
    });
  });
});
