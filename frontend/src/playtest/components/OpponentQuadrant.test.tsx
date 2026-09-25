// @vitest-environment happy-dom
/**
 * No `@testing-library/jest-dom` in this repo — assertions use plain
 * vitest/chai matchers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PublicBattlefieldCard, PublicBoard } from '@/lib/playtest/projection';
import { OpenSeatQuadrant, OpponentQuadrant, opponentPreviewId } from './OpponentQuadrant';
import type { OpponentSeat } from './OpponentRail';

// Art resolution is `useCardThumb`'s own contract (and its own tests); here it
// only needs to return SOMETHING so `PlaytestCardFace` has a `src` and
// publishes its `data-preview-id`.
vi.mock('@/lib/card-thumbs', () => ({
  useCardThumb: (name?: string) => (name ? `https://cards.example/${name}.jpg` : undefined),
}));

function bfCard(id: string, overrides: Partial<PublicBattlefieldCard> = {}): PublicBattlefieldCard {
  return {
    card: { id, name: `Card ${id}` },
    tapped: false,
    counters: {},
    stickers: [],
    x: 0.5,
    y: 0.5,
    faceDown: false,
    ...overrides,
  };
}

function board(seat: number, overrides: Partial<PublicBoard> = {}): PublicBoard {
  return {
    seat,
    turn: 3,
    life: 34,
    commanderTax: {},
    monarch: false,
    initiative: false,
    citysBlessing: false,
    battlefield: [bfCard('a'), bfCard('b', { tapped: true }), bfCard('c', { faceDown: true })],
    graveyard: [{ id: 'gy', name: 'Lightning Bolt' }],
    exile: [],
    command: [{ id: 'cmd', name: 'Atraxa, Praetors Voice' }],
    handCount: 5,
    libraryCount: 87,
    ...overrides,
  };
}

function seat(n: number, overrides: Partial<PublicBoard> = {}): OpponentSeat {
  return { name: `Player ${n}`, board: board(n, overrides) };
}

const props = {
  active: false,
  sweeping: false,
  pointed: false,
  watching: false,
  onOpen: () => {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OpponentQuadrant', () => {
  it('renders the seat as a labelled section carrying every fact the rail entry carries', () => {
    render(<OpponentQuadrant {...props} opp={seat(1, { monarch: true })} active />);

    const section = screen.getByRole('region');
    const label = section.getAttribute('aria-label') ?? '';
    expect(label).toContain('Player 1');
    expect(label).toContain('34 life');
    expect(label).toContain("this player's turn");
    expect(label).toContain('3 permanents');
    expect(label).toContain('5 cards in hand');
    expect(label).toContain('87 in library');
    expect(label).toContain('holds Monarch');
  });

  it('renders the battlefield, a hand of face-down backs, and the four zone piles', () => {
    const { container } = render(<OpponentQuadrant {...props} opp={seat(1)} />);

    expect(container.querySelectorAll('.opponent-quadrant__card')).toHaveLength(3);
    // One back per card in hand — the count, drawn.
    expect(container.querySelectorAll('.opponent-quadrant__hand-back')).toHaveLength(5);
    for (const label of ['Library, 87', 'Graveyard, 1', 'Exile, 0', 'Command, 1']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}\\.`) }), label).toBeTruthy();
    }
  });

  it('rotates a tapped permanent and leaves an untapped one alone', () => {
    const { container } = render(<OpponentQuadrant {...props} opp={seat(1)} />);
    const cards = [...container.querySelectorAll<HTMLElement>('.opponent-quadrant__card')];
    expect(cards[0].style.transform).toBe('');
    expect(cards[1].style.transform).toContain('rotate(90deg)');
  });

  it('gives every face-up card a seat-scoped preview id and a face-down card none', () => {
    const { container } = render(<OpponentQuadrant {...props} opp={seat(1)} />);
    const ids = [...container.querySelectorAll('[data-preview-id]')].map((el) =>
      el.getAttribute('data-preview-id')
    );
    expect(ids).toEqual([opponentPreviewId(1, 'a'), opponentPreviewId(1, 'b')]);
    // The prefix is what keeps it from colliding with the viewer's own ids.
    expect(ids.every((id) => id?.startsWith('opp1:'))).toBe(true);
  });

  it('wears the turn ring only while the seat holds the turn', () => {
    const { container, rerender } = render(<OpponentQuadrant {...props} opp={seat(1)} />);
    expect(container.querySelector('.opponent-quadrant.is-active-turn')).toBeNull();

    rerender(<OpponentQuadrant {...props} opp={seat(1)} active />);
    expect(container.querySelector('.opponent-quadrant.is-active-turn')).toBeTruthy();
    expect(screen.getByText('Turn')).toBeTruthy();
  });

  it('opens the inspector from the name pill and from a zone pile', () => {
    const onOpen = vi.fn();
    render(<OpponentQuadrant {...props} opp={seat(1)} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: "Open Player 1's board" }));
    fireEvent.click(screen.getByRole('button', { name: /^Graveyard, 1\./ }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('says a pending seat has shared nothing instead of drawing fabricated zeros', () => {
    const { container } = render(
      <OpponentQuadrant {...props} opp={{ ...seat(2), pending: true }} />
    );
    expect(screen.getByText('No board shared yet.')).toBeTruthy();
    expect(container.querySelector('.opponent-quadrant__felt')).toBeNull();
    expect(container.querySelector('.opponent-quadrant__piles')).toBeNull();
    // Life is real even before a board arrives.
    expect(screen.getByRole('region').getAttribute('aria-label')).toContain('34 life');
  });

  it('insets its battlefield only when it holds the cell the turn stack floats over', () => {
    const { container, rerender } = render(<OpponentQuadrant {...props} opp={seat(1)} />);
    expect(container.querySelector('.opponent-quadrant--under-stack')).toBeNull();

    rerender(<OpponentQuadrant {...props} opp={seat(1)} underTurnStack />);
    expect(container.querySelector('.opponent-quadrant--under-stack')).toBeTruthy();
  });

  it('draws the empty seat as a placeholder, not a seat', () => {
    render(<OpenSeatQuadrant />);
    expect(screen.queryByRole('region')).toBeNull();
    expect(document.querySelector('.opponent-quadrant--open')?.textContent).toBe('Open seat');
  });

  it('shows a live P/T plate on a permanent, counters and the pt modifier folded in', () => {
    const { container } = render(
      <OpponentQuadrant
        {...props}
        opp={seat(1, {
          battlefield: [
            bfCard('bear', {
              card: { id: 'bear', name: 'Grizzly Bears', power: '2', toughness: '2' },
              counters: { '+1/+1': 1 },
              pt: { power: 0, toughness: 1 },
            }),
          ],
        })}
      />
    );
    const plate = container.querySelector('.playtest-card__pt');
    expect(plate).toBeTruthy();
    // printed 2/2 + one +1/+1 counter (+1/+1 to both) + a pt modifier of 0/+1.
    expect(plate!.getAttribute('aria-label')).toBe('3 by 4');
  });

  it('never draws a plate for a permanent with no printed body', () => {
    const { container } = render(<OpponentQuadrant {...props} opp={seat(1)} />);
    expect(container.querySelector('.playtest-card__pt')).toBeNull();
  });

  it('never draws a plate for a face-down permanent, even one carrying a body', () => {
    const { container } = render(
      <OpponentQuadrant
        {...props}
        opp={seat(1, {
          battlefield: [
            bfCard('morph', {
              card: { id: 'morph', power: '2', toughness: '2' },
              faceDown: true,
            }),
          ],
        })}
      />
    );
    expect(container.querySelector('.playtest-card__pt')).toBeNull();
  });
});
