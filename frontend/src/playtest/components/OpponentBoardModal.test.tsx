// @vitest-environment happy-dom
/**
 * No `@testing-library/jest-dom` in this repo — assertions use plain
 * vitest/chai matchers, not `.toBeInTheDocument()`/`.toHaveAccessibleName()`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { OpponentBoardModal } from './OpponentBoardModal';
import type { OpponentSeat } from './OpponentRail';
import type { PublicBattlefieldCard, PublicBoard } from '@/lib/playtest/projection';
import { getCardsByIds, getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';
import { createGameState, makePlayer } from '@/lib/game-state';

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByIds: vi.fn(),
  getCardsByNames: vi.fn(),
}));

// Art resolution isn't the point of this component's tests — a resolved thumb
// keeps every tile on its image branch (never the name-text placeholder),
// so a card's name appears exactly once (its own label), not twice.
vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => 'https://img.example/test.jpg' }));

// CardPreview itself has its own test file and a large dependency tree
// (Scryfall rulings, capacitor share, react-router Link…). Stub it here so
// these tests exercise OpponentBoardModal's own inspect-wiring — which card
// it hands off, at which index — without dragging all of that in.
vi.mock('@/components/CardPreview', () => ({
  CardPreview: (props: { cards: Array<{ name: string }>; index: number }) => (
    <div data-testid="card-preview">{props.cards[props.index]?.name}</div>
  ),
}));

/** Stub matchMedia so the reduced-motion branch is deterministic — every
 *  dismiss path (Escape, close button, backdrop) resolves `onClose`
 *  synchronously instead of waiting on a CSS animationend. */
function mockReducedMotion(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion') ? matches : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

function scryCard(id: string, name: string): ScryfallCard {
  return {
    id,
    name,
    set: 'tst',
    set_name: 'Test Set',
    collector_number: '1',
    rarity: 'common',
    type_line: 'Creature — Test',
    cmc: 1,
  } as unknown as ScryfallCard;
}

function bfCard(
  id: string,
  name: string,
  overrides: Partial<PublicBattlefieldCard> = {}
): PublicBattlefieldCard {
  return {
    card: { id, name, scryfallId: id },
    tapped: false,
    counters: {},
    stickers: [],
    x: 0,
    y: 0,
    faceDown: false,
    ...overrides,
  };
}

function board(overrides: Partial<PublicBoard> = {}): PublicBoard {
  return {
    seat: 0,
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
    handCount: 7,
    libraryCount: 90,
    ...overrides,
  };
}

function opp(
  overrides: Partial<OpponentSeat> = {},
  boardOverrides: Partial<PublicBoard> = {}
): OpponentSeat {
  return { name: 'Priya', board: board(boardOverrides), ...overrides };
}

function resolveAll(cards: ScryfallCard[]) {
  const map = new Map(cards.map((c) => [c.id, c]));
  vi.mocked(getCardsByIds).mockImplementation(async (ids: string[]) => {
    const out = new Map<string, ScryfallCard>();
    for (const id of ids) {
      const c = map.get(id);
      if (c) out.set(id, c);
    }
    return out;
  });
  vi.mocked(getCardsByNames).mockResolvedValue(new Map());
}

describe('OpponentBoardModal', () => {
  it('shows every battlefield permanent — no 12-card cap', async () => {
    const bf = Array.from({ length: 15 }, (_, i) => bfCard(`bf${i}`, `Creature ${i}`));
    resolveAll(bf.map((b) => scryCard(b.card.id, b.card.name!)));
    render(
      <OpponentBoardModal opp={opp({}, { battlefield: bf })} active={false} onClose={() => {}} />
    );
    // Portaled to document.body (see the component's doc comment) — query
    // the whole document, not the render()-returned container.
    expect(document.body.querySelectorAll('.opponent-board-card').length).toBe(15);
  });

  it('animates only a genuinely new permanent — never the first-ever board, never a republish of unchanged cards', async () => {
    resolveAll([scryCard('bf0', 'Card 0'), scryCard('bf1', 'Card 1')]);
    const { rerender } = render(
      <OpponentBoardModal
        opp={opp({}, { battlefield: [bfCard('bf0', 'Card 0')] })}
        active={false}
        onClose={() => {}}
      />
    );
    // First-ever board: every tile is a fresh mount, but none of them animate.
    expect(document.body.querySelector('.opponent-board-card.is-entering')).toBeNull();

    // A whole-snapshot republish of the SAME permanent (fresh array/object
    // identity, same card id) — still no animation.
    rerender(
      <OpponentBoardModal
        opp={opp({}, { battlefield: [bfCard('bf0', 'Card 0')] })}
        active={false}
        onClose={() => {}}
      />
    );
    expect(document.body.querySelector('.opponent-board-card.is-entering')).toBeNull();

    // A genuinely new permanent joins — only its tile animates.
    rerender(
      <OpponentBoardModal
        opp={opp({}, { battlefield: [bfCard('bf0', 'Card 0'), bfCard('bf1', 'Card 1')] })}
        active={false}
        onClose={() => {}}
      />
    );
    const entering = document.body.querySelectorAll('.opponent-board-card.is-entering');
    expect(entering.length).toBe(1);
    expect(entering[0].getAttribute('aria-label')).toBe('Card 1');
  });

  it('renders graveyard, exile, and command zone cards, browsable via tabs', async () => {
    resolveAll([
      scryCard('g1', 'Grave One'),
      scryCard('g2', 'Grave Two'),
      scryCard('e1', 'Exile One'),
      scryCard('c1', 'Command One'),
    ]);
    render(
      <OpponentBoardModal
        opp={opp(
          {},
          {
            graveyard: [
              { id: 'g1', name: 'Grave One', scryfallId: 'g1' },
              { id: 'g2', name: 'Grave Two', scryfallId: 'g2' },
            ],
            exile: [{ id: 'e1', name: 'Exile One', scryfallId: 'e1' }],
            command: [{ id: 'c1', name: 'Command One', scryfallId: 'c1' }],
          }
        )}
        active={false}
        onClose={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: /Graveyard/ }));
    expect(screen.getByText('Grave One')).toBeTruthy();
    expect(screen.getByText('Grave Two')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Exile/ }));
    expect(screen.getByText('Exile One')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Command/ }));
    expect(screen.getByText('Command One')).toBeTruthy();
  });

  it('shows a commander-tax badge on a taxed command-zone card', () => {
    resolveAll([scryCard('cmd1', 'My Commander')]);
    render(
      <OpponentBoardModal
        opp={opp(
          {},
          {
            command: [{ id: 'cmd1', name: 'My Commander', scryfallId: 'cmd1' }],
            commanderTax: { cmd1: 2 },
          }
        )}
        active={false}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: /Command/ }));
    expect(screen.getByText('Tax +4')).toBeTruthy();
  });

  it('renders a face-down battlefield card as a back, its identity nowhere in the output, and never inspectable', async () => {
    resolveAll([scryCard('visible1', 'Visible Card')]);
    render(
      <OpponentBoardModal
        opp={opp(
          {},
          {
            battlefield: [
              bfCard('super-secret-permanent', 'Should Never Appear', {
                faceDown: true,
                card: { id: 'super-secret-permanent' },
              }),
              bfCard('visible1', 'Visible Card'),
            ],
          }
        )}
        active={false}
        onClose={() => {}}
      />
    );

    // Never leaks the face-down card's name anywhere in the render. Portaled
    // to document.body (see the component's doc comment), so check the whole
    // document rather than render()'s own (empty) container.
    expect(document.body.innerHTML).not.toContain('Should Never Appear');
    // Renders as a card back.
    const back = document.body.querySelector('.playtest-card__back');
    expect(back).not.toBeNull();

    // Not reachable as a button — no keyboard/click path into an identity.
    const faceDownTile = back!.closest('.playtest-card')!;
    expect(faceDownTile.getAttribute('role')).toBeNull();
    expect(faceDownTile.getAttribute('tabindex')).toBeNull();

    fireEvent.click(faceDownTile);
    expect(screen.queryByTestId('card-preview')).toBeNull();

    // The visible sibling permanent, by contrast, opens the shared preview —
    // once Scryfall resolution (async) has landed. Retries the click since
    // the very first render happens before that batch resolves.
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Visible Card' }));
      expect(screen.getByTestId('card-preview').textContent).toBe('Visible Card');
    });
  });

  it('opens the shared CardPreview on a battlefield card, resolved via Scryfall id', async () => {
    resolveAll([scryCard('sf-1', 'Sol Ring')]);
    render(
      <OpponentBoardModal
        opp={opp({}, { battlefield: [bfCard('sf-1', 'Sol Ring')] })}
        active={false}
        onClose={() => {}}
      />
    );
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Sol Ring' }));
      expect(screen.getByTestId('card-preview').textContent).toBe('Sol Ring');
    });
  });

  it('shows empty-zone states for battlefield, graveyard, exile, and command', () => {
    resolveAll([]);
    render(<OpponentBoardModal opp={opp()} active={false} onClose={() => {}} />);
    expect(screen.getByText('No permanents.')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Graveyard/ }));
    expect(screen.getByText('No cards in graveyard.')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Exile/ }));
    expect(screen.getByText('No cards in exile.')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Command/ }));
    expect(screen.getByText('No cards in the command zone.')).toBeTruthy();
  });

  it('shows a distinct state for a pending opponent instead of fabricated zeros', () => {
    resolveAll([]);
    render(
      <OpponentBoardModal
        opp={{ ...opp({}, { life: 40 }), pending: true }}
        active={false}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('No board shared yet.')).toBeTruthy();
    // No tabs/zones at all for a placeholder board — nothing to browse.
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('0 permanents')).toBeNull();
  });

  it('still shows the pending opponent’s real life total', () => {
    resolveAll([]);
    render(
      <OpponentBoardModal
        opp={{ ...opp({}, { life: 27 }), pending: true }}
        active={false}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('27 life')).toBeTruthy();
  });

  it('closes on Escape', () => {
    mockReducedMotion(true);
    resolveAll([]);
    const onClose = vi.fn();
    render(<OpponentBoardModal opp={opp()} active={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on the explicit close control', () => {
    mockReducedMotion(true);
    resolveAll([]);
    const onClose = vi.fn();
    render(<OpponentBoardModal opp={opp()} active={false} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close board view' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a backdrop click, but not on a click inside the sheet', () => {
    mockReducedMotion(true);
    resolveAll([]);
    const onClose = vi.fn();
    render(<OpponentBoardModal opp={opp()} active={false} onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.body.querySelector('.opponent-board-backdrop')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('moves focus into the dialog on open and restores it on close', () => {
    mockReducedMotion(true);
    resolveAll([]);
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            open
          </button>
          {open && <OpponentBoardModal opp={opp()} active={false} onClose={() => setOpen(false)} />}
        </div>
      );
    }
    render(<Harness />);
    const openBtn = screen.getByText('open');
    openBtn.focus();
    fireEvent.click(openBtn);

    // Focus lands inside the dialog (the close button is the first
    // focusable descendant in DOM order).
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Close board view' }));
    expect(document.activeElement).toBe(openBtn);
  });
});

describe('OpponentBoardModal — pointing', () => {
  /** Seat this device at an online table so `useOnlineSignals` links up; the
   *  point affordances are gated on exactly that (solo playtest has no table
   *  to point for, which the suite above covers by never setting this). */
  function seatMeOnline() {
    const sendSignal = vi.fn().mockResolvedValue(undefined);
    useAuth.setState({ user: { id: 'me-id', username: 'me', role: 'user' } });
    usePlayStore.setState({
      onlineSignal: null,
      sendSignal,
      online: createGameState({
        id: 'g1',
        code: 'ABCD',
        mode: 'online',
        hostUserId: 'me-id',
        format: 'commander',
        startingLife: 40,
        commanderDamageEnabled: true,
        poisonEnabled: false,
        players: [
          makePlayer({
            id: 'me',
            userId: 'me-id',
            seat: 1,
            name: 'Me',
            startingLife: 40,
            isHost: true,
          }),
          makePlayer({ id: 'p', userId: 'u', seat: 0, name: 'Priya', startingLife: 40 }),
        ],
      }),
    });
    return sendSignal;
  }

  afterEach(() => {
    usePlayStore.setState({ online: null, onlineSignal: null });
  });

  it('offers no point affordances in solo playtest', () => {
    resolveAll([scryCard('c1', 'Sol Ring')]);
    render(
      <OpponentBoardModal
        opp={opp({}, { battlefield: [bfCard('c1', 'Sol Ring')] })}
        active={false}
        onClose={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: 'Point at Priya' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Point at Sol Ring' })).toBeNull();
  });

  it('points at the seat as a whole from the header, carrying no card', () => {
    const sendSignal = seatMeOnline();
    render(<OpponentBoardModal opp={opp()} active={false} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Point at Priya' }));
    expect(sendSignal).toHaveBeenCalledWith({ kind: 'point', targetSeat: 0 });
  });

  it('points at one permanent from its tile', () => {
    const sendSignal = seatMeOnline();
    resolveAll([scryCard('c1', 'Sol Ring')]);
    render(
      <OpponentBoardModal
        opp={opp({}, { battlefield: [bfCard('c1', 'Sol Ring')] })}
        active={false}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Point at Sol Ring' }));
    expect(sendSignal).toHaveBeenCalledWith({ kind: 'point', targetSeat: 0, cardId: 'c1' });
  });

  it('a face-down permanent can be pointed at without naming it', () => {
    // Its identity is redacted upstream, and a point carries only the opaque
    // instance id — so indicating "the morph" reveals nothing.
    const sendSignal = seatMeOnline();
    render(
      <OpponentBoardModal
        opp={opp({}, { battlefield: [bfCard('c1', 'Sol Ring', { faceDown: true })] })}
        active={false}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Point at Face-down card' }));
    expect(sendSignal).toHaveBeenCalledWith({ kind: 'point', targetSeat: 0, cardId: 'c1' });
  });

  it('lights the permanent an incoming point names, and only that one', async () => {
    seatMeOnline();
    resolveAll([scryCard('c1', 'Sol Ring'), scryCard('c2', 'Mox Pearl')]);
    render(
      <OpponentBoardModal
        opp={opp({}, { battlefield: [bfCard('c1', 'Sol Ring'), bfCard('c2', 'Mox Pearl')] })}
        active={false}
        onClose={() => {}}
      />
    );
    await act(async () => {
      usePlayStore.setState({
        onlineSignal: {
          seq: 1,
          signal: { kind: 'point', seat: 0, ts: 1, targetSeat: 0, cardId: 'c2' },
        },
      });
    });
    // The sheet is portaled to <body>, so query the document, not `container`.
    const lit = document.querySelectorAll('.opponent-board-card.is-pointed');
    expect(lit.length).toBe(1);
    expect(lit[0].getAttribute('aria-label')).toBe('Mox Pearl');
  });

  it('a point at a DIFFERENT seat lights nothing in this sheet', async () => {
    seatMeOnline();
    resolveAll([scryCard('c1', 'Sol Ring')]);
    render(
      <OpponentBoardModal
        opp={opp({}, { battlefield: [bfCard('c1', 'Sol Ring')] })}
        active={false}
        onClose={() => {}}
      />
    );
    await act(async () => {
      usePlayStore.setState({
        onlineSignal: {
          seq: 1,
          signal: { kind: 'point', seat: 0, ts: 1, targetSeat: 5, cardId: 'c1' },
        },
      });
    });
    // Guard against a vacuous pass: the tile exists, it just isn't lit.
    expect(document.querySelector('.opponent-board-card')).toBeTruthy();
    expect(document.querySelector('.opponent-board-card.is-pointed')).toBeNull();
  });
});
