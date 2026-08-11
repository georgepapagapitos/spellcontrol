// @vitest-environment happy-dom
/**
 * No `@testing-library/jest-dom` in this repo — assertions use plain
 * vitest/chai matchers, not `.toBeInTheDocument()`/`.toHaveAccessibleName()`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OpponentRail, type OpponentSeat } from './OpponentRail';
import type { PublicBattlefieldCard, PublicBoard } from '@/lib/playtest/projection';

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

/** Force a density: 'presence' (portrait) is the component's own default; pass
 *  `true` to simulate landscape via the matchMedia gate it reads. */
function stubOrientation(landscape: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: landscape && /orientation:\s*landscape/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
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
    const label = screen.getByRole('listitem').getAttribute('aria-label') ?? '';
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
    const label = screen.getByRole('listitem').getAttribute('aria-label') ?? '';
    expect(label).toMatch(/holds Monarch, Initiative/);
  });

  it('marks the active seat with aria-current and announces whose turn it is', () => {
    const opponents = [seat(0), seat(1)];
    render(<OpponentRail opponents={opponents} activeSeat={1} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0].getAttribute('aria-current')).toBeNull();
    expect(items[1].getAttribute('aria-current')).toBe('true');
    expect(items[1].getAttribute('aria-label') ?? '').toMatch(/this player's turn/);
  });

  it('announces life as part of a sentence, not a bare number', () => {
    const opponents = [seat(0, { life: 34 })];
    render(<OpponentRail opponents={opponents} />);
    const label = screen.getByRole('listitem').getAttribute('aria-label') ?? '';
    expect(label).toMatch(/34 life/);
  });

  it('never conveys color identity by color alone — name text is always present too', () => {
    const opponents = [seat(0)];
    const { container } = render(<OpponentRail opponents={opponents} />);
    const dot = container.querySelector('.opponent-entry__dot');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Player 0')).toBeTruthy();
  });
});
