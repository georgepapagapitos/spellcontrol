// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OpponentLife } from '@/lib/playtest';
import { makePlayer, type GamePlayer } from '@/lib/game-state';
import type { OnlineTable } from '../hooks/use-online-table';
import { LifeStrip } from './LifeStrip';

function soloProps() {
  return {
    life: 40,
    opponents: [] as OpponentLife[],
    commanderDamageThreshold: 21,
    isNarrow: false,
    monarch: false,
    initiative: false,
    citysBlessing: false,
    playerCounters: {},
    onAdjustLife: vi.fn(),
    onAdjustCommanderDamage: vi.fn(),
    onAdjustCounter: vi.fn(),
    onlineTable: null,
  };
}

/** `makePlayer` derives `life` from `startingLife` and always zeroes
 *  `poison` — neither can be dialed in through its own input, so this
 *  overrides them on the result instead of fighting its signature. */
function player(opts: {
  seat: number;
  name: string;
  life?: number;
  poison?: number;
  partner?: string | null;
}): GamePlayer {
  const base = makePlayer({
    id: `p${opts.seat}`,
    userId: `u${opts.seat}`,
    seat: opts.seat,
    name: opts.name,
    startingLife: opts.life ?? 40,
    partner: opts.partner,
  });
  return { ...base, life: opts.life ?? base.life, poison: opts.poison ?? 0 };
}

function onlineTable(overrides: Partial<OnlineTable> = {}): OnlineTable {
  const me = player({ seat: 0, name: 'Me', life: 40 });
  const maya = player({ seat: 1, name: 'Maya', life: 34 });
  const dispatch = vi.fn();
  return {
    activeSeat: null,
    mySeat: 0,
    isHost: false,
    me,
    players: [me, maya],
    // Unused by LifeStrip's online branch (it renders off `players`, not
    // `opponents` — that field feeds OpponentRail instead).
    opponents: [],
    phase: undefined,
    poisonEnabled: false,
    commanderDamageEnabled: true,
    mulliganType: 'commander' as const,
    turnTimerEnabled: false,
    turnStartedAt: null,
    designations: { monarch: null, initiative: null },
    dispatch,
    ...overrides,
  };
}

describe('LifeStrip — solo mode', () => {
  it('renders the local life total, not a table', () => {
    render(<LifeStrip {...soloProps()} />);
    expect(screen.getByRole('button', { name: /You: 40 life/ })).toBeTruthy();
  });

  /** Goldfishing is a deck against nobody. Your own popover listing three
   *  virtual seats and their commander damage was the whole reason it ran
   *  650px tall while EDHPlay's is a counter list. */
  it('keeps opponents out of MY panel entirely — goldfishing has none to list', () => {
    render(
      <LifeStrip
        {...soloProps()}
        opponents={[
          { life: 40, commanderDamage: 5 },
          { life: 40, commanderDamage: 0 },
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /You: 40 life/ }));
    expect(screen.queryByText('Opponents')).toBeNull();
    expect(screen.queryByText('Commander damage')).toBeNull();
    expect(screen.getByText('Poison')).toBeTruthy();
  });

  /** It moved rather than went: this is what still feeds the "swept the table
   *  on turn N" kill clock (`deriveTableDefeatedTurn`), and it belongs on the
   *  opponent taking the damage, not in your counter list. */
  it("steps commander damage from the opponent's own panel", () => {
    const props = soloProps();
    render(<LifeStrip {...props} opponents={[{ life: 40, commanderDamage: 5 }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Opponent: 40 life/ }));
    expect(screen.getByRole('button', { name: 'Life +1' })).toBeTruthy();
    expect(screen.getByText('Commander damage')).toBeTruthy();
    expect(screen.getByText('16 to lethal')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Commander damage from Your commander +1' })
    );
    expect(props.onAdjustCommanderDamage).toHaveBeenCalledWith(0, 1);
  });
});

describe('LifeStrip — the popover is one fixed list (EDHPlay shape)', () => {
  it('lists the five player counters even at zero, in Title case with the by-name field folded away', () => {
    render(<LifeStrip {...soloProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /You: 40 life/ }));
    for (const label of ['Poison', 'Energy', 'Experience', 'Rad', 'Tickets']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByRole('textbox', { name: 'Counter name' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Another counter' }));
    expect(screen.getByRole('textbox', { name: 'Counter name' })).toBeTruthy();
  });

  it('a custom counter already on the player stays adjustable below the fixed five', () => {
    const props = soloProps();
    render(<LifeStrip {...props} playerCounters={{ oil: 2 }} />);
    fireEvent.click(screen.getByRole('button', { name: /You: 40 life/ }));
    fireEvent.click(screen.getByRole('button', { name: 'oil +1' }));
    expect(props.onAdjustCounter).toHaveBeenCalledWith('self', 'oil', 1);
  });

  it('table variant: the resting panel is the total, its steppers and a bare chevron — nothing else', () => {
    render(
      <LifeStrip
        {...soloProps()}
        opponents={[
          { life: 40, commanderDamage: 0 },
          { life: 38, commanderDamage: 0 },
        ]}
        variant="table"
      />
    );
    expect(screen.queryByText('Details')).toBeNull();
    // The opponent chips used to sit here. They are behind the chevron now,
    // so nothing but your own controls is on the felt at rest.
    expect(screen.queryByRole('button', { name: /Opponent 1: 40 life/ })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(4); // −, total, +, chevron
  });

  it('table variant: goldfishing, the chevron opens the counter list and nothing else', () => {
    render(
      <LifeStrip
        {...soloProps()}
        opponents={[
          { life: 40, commanderDamage: 0 },
          { life: 38, commanderDamage: 0 },
        ]}
        variant="table"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Counters' }));
    expect(screen.getByRole('dialog', { name: 'You' })).toBeTruthy();
    // Life stays out: the corner panel already has the numeral and steppers.
    expect(screen.queryByRole('button', { name: 'Life +5' })).toBeNull();
    expect(screen.queryByText('Opponents')).toBeNull();
    expect(screen.queryByText('Commander damage')).toBeNull();
    // A lone section needs no heading naming it, and no title above it: the
    // chevron it hangs from is on the panel showing your own total.
    expect(document.querySelector('.playtest-life-panel__counters-heading')).toBeNull();
    expect(document.querySelector('.playtest-life-panel__title')).toBeNull();
    expect(screen.getByText('Poison')).toBeTruthy();
  });

  /** The chevron only ever opened. A second press did close the popover, but
   *  by landing on the full-screen backdrop rather than on the chevron, and
   *  the glyph pointed down the entire time it was open. */
  it('table variant: the chevron is one toggle — it flips, and it closes', () => {
    render(<LifeStrip {...soloProps()} variant="table" />);
    const shut = () => screen.getByRole('button', { expanded: false });
    expect(shut().querySelector('.lucide-chevron-down')).toBeTruthy();

    fireEvent.click(shut());
    const open = screen.getByRole('button', { expanded: true });
    expect(open.querySelector('.lucide-chevron-up')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'You' })).toBeTruthy();

    fireEvent.click(open);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(shut()).toBeTruthy();
  });

  it('table variant: shows the running life change, then stops showing it', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<LifeStrip {...soloProps()} variant="table" />);
      // The numeral says 34; only the delta says whether that was one or six.
      rerender(<LifeStrip {...soloProps()} life={37} variant="table" />);
      rerender(<LifeStrip {...soloProps()} life={34} variant="table" />);
      expect(screen.getByText('−6')).toBeTruthy();
      act(() => void vi.advanceTimersByTime(2000));
      expect(screen.queryByText('−6')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('strip variant keeps the life row in the sheet, since the chip has no steppers of its own', () => {
    render(<LifeStrip {...soloProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /You: 40 life/ }));
    expect(screen.getByRole('button', { name: 'Life +5' })).toBeTruthy();
  });

  it("online: the table's poison stepper takes the Poison row's place, once", () => {
    const table = onlineTable({
      poisonEnabled: true,
      me: player({ seat: 0, name: 'Me', life: 40, poison: 2 }),
    });
    render(<LifeStrip {...soloProps()} onlineTable={table} />);
    fireEvent.click(screen.getByText('You').closest('button')!);
    expect(screen.getAllByText('Poison')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Poison +1' }));
    expect(table.dispatch).toHaveBeenCalledWith({
      type: 'poison',
      seat: 0,
      delta: 1,
      actorSeat: 0,
    });
  });
});

describe('LifeStrip — online mode', () => {
  it('renders real seats (You + opponent by name), never the solo virtual opponents', () => {
    const table = onlineTable();
    render(
      <LifeStrip
        {...soloProps()}
        life={999} // local playtest life — must NOT appear anywhere
        opponents={[{ life: 1, commanderDamage: 0 }]} // solo virtual opponent — must NOT render
        onlineTable={table}
      />
    );
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Maya')).toBeTruthy();
    expect(screen.queryByText('999')).toBeNull();
    expect(screen.queryByText('Opponent')).toBeNull();
  });

  it('shows the table life for both seats, not the local playtest life', () => {
    render(<LifeStrip {...soloProps()} life={7} onlineTable={onlineTable()} />);
    expect(screen.getByText('40')).toBeTruthy(); // me.life
    expect(screen.getByText('34')).toBeTruthy(); // Maya's life
    expect(screen.queryByText('7')).toBeNull();
  });

  it('marks the active seat with is-active-turn', () => {
    const table = onlineTable({ activeSeat: 1 });
    render(<LifeStrip {...soloProps()} onlineTable={table} />);
    const mayaChip = screen.getByText('Maya').closest('button')!;
    expect(mayaChip.className).toContain('is-active-turn');
    const meChip = screen.getByText('You').closest('button')!;
    expect(meChip.className).not.toContain('is-active-turn');
  });

  it('shows a poison badge only when poisonEnabled and poison > 0', () => {
    const table = onlineTable({
      poisonEnabled: true,
      players: [
        player({ seat: 0, name: 'Me', life: 40, poison: 3 }),
        player({ seat: 1, name: 'Maya', life: 34, poison: 0 }),
      ],
      me: player({ seat: 0, name: 'Me', life: 40, poison: 3 }),
    });
    render(<LifeStrip {...soloProps()} onlineTable={table} />);
    expect(screen.getByText('☠ 3')).toBeTruthy();
  });

  it("opens my panel with an editable life stepper dispatching the online 'life' action", () => {
    const table = onlineTable();
    render(<LifeStrip {...soloProps()} onlineTable={table} />);
    fireEvent.click(screen.getByText('You').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Life +1' }));
    expect(table.dispatch).toHaveBeenCalledWith({
      type: 'life',
      seat: 0,
      delta: 1,
      actorSeat: 0,
    });
  });

  it("opens an opponent's panel read-only, with the 'only they can change their life' note and a View board button", () => {
    const table = onlineTable();
    const onViewOpponentBoard = vi.fn();
    render(
      <LifeStrip {...soloProps()} onlineTable={table} onViewOpponentBoard={onViewOpponentBoard} />
    );
    fireEvent.click(screen.getByText('Maya').closest('button')!);
    expect(screen.getByText('Only Maya can change their life.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View board' }));
    expect(onViewOpponentBoard).toHaveBeenCalledWith(1);
  });

  it('steps commander damage FROM an opponent onto MY OWN seat, from MY panel', () => {
    const table = onlineTable();
    render(<LifeStrip {...soloProps()} onlineTable={table} />);
    fireEvent.click(screen.getByText('You').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Commander damage from Maya +1' }));
    expect(table.dispatch).toHaveBeenCalledWith({
      type: 'cmd-dmg',
      seat: 0,
      fromSeat: 1,
      fromPartner: false,
      delta: 1,
      actorSeat: 0,
    });
  });
});

describe('LifeStrip — a real game gets the Opponents section goldfishing does not', () => {
  it('lists every other seat with its life, and opens that seat from its name', () => {
    render(
      <LifeStrip
        {...soloProps()}
        variant="table"
        onlineTable={onlineTable({
          players: [
            player({ seat: 0, name: 'Me', life: 40 }),
            player({ seat: 1, name: 'Maya', life: 34 }),
            player({ seat: 2, name: 'Rin', life: 21 }),
          ],
        })}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Opponents, commander damage and counters' })
    );
    expect(screen.getByText('Opponents')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Maya: 34 life/ })).toBeTruthy();

    // No stepper on their row: a seat owns its own total, so this section
    // reads the table and hands you a way into any seat's full panel.
    expect(screen.queryByRole('button', { name: 'Maya life -1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Rin: 21 life/ }));
    expect(screen.getByRole('dialog', { name: 'Rin' })).toBeTruthy();
  });
});

describe('LifeStrip — the table popover escapes its chip', () => {
  /**
   * `.playtest-life-table` carries `backdrop-filter: blur(6px)`, which makes it
   * a containing block for `position: fixed` descendants exactly as a transform
   * would. The popover is positioned from VIEWPORT coordinates, so rendered as
   * a child of the chip those coordinates were applied relative to the chip.
   *
   * On the local board the chip sits at (12, 12) and the error was 13px, so it
   * went unnoticed. At an online table's 2x2 grid the chip sits in a quadrant
   * roughly 530px down, and the panel landed off the bottom of the screen: the
   * chevron looked dead. jsdom has no layout and cannot see that, but it can
   * see where the node is mounted.
   */
  it('portals the popover to the body, not inside the life chip', () => {
    render(<LifeStrip {...soloProps()} variant="table" />);
    fireEvent.click(screen.getByRole('button', { name: 'Counters' }));
    const panel = document.querySelector('.playtest-life-panel-floating');
    expect(panel).toBeTruthy();
    expect(panel?.closest('.playtest-life-table')).toBeNull();
  });

  it('opens from the chevron at an online table too, not only solo', () => {
    render(
      <LifeStrip
        {...soloProps()}
        variant="table"
        onlineTable={onlineTable({
          players: [
            player({ seat: 0, name: 'seat1' }),
            player({ seat: 1, name: 'seat2' }),
            player({ seat: 2, name: 'seat3' }),
            player({ seat: 3, name: 'seat4' }),
          ],
        })}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Opponents, commander damage and counters' })
    );
    expect(document.querySelector('.playtest-life-panel-floating')).toBeTruthy();
  });
});
