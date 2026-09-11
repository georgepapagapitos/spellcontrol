// @vitest-environment happy-dom
/**
 * B6-04: a compact "back" control the ActionBar only shows when the caller
 * supplies one — the short-landscape tier folds `.playtest-page__header`'s
 * back-navigation in here (CSS-gated); every other tier omits it entirely,
 * since `.playtest-page__header` already covers it there.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActionBar, type OnlineBarProps } from './ActionBar';

function baseProps() {
  return {
    turn: 1,
    libraryCount: 60,
    isNarrow: false,
    onDraw: vi.fn(),
    onShuffle: vi.fn(),
    onMulligan: vi.fn(),
    onUntapAll: vi.fn(),
    onNextTurn: vi.fn(),
    onReset: vi.fn(),
    takeback: {
      stepsAvailable: 0,
      verdict: 'none' as const,
      mode: 'ask' as const,
      boundaryReason: null,
      isPending: false,
      onClick: vi.fn(),
      onOpenSettings: vi.fn(),
    },
    onScry: vi.fn(),
    onCreateToken: vi.fn(),
    onOpenStats: vi.fn(),
    onOpenLog: vi.fn(),
    onOpenDice: vi.fn(),
    onOpenResistance: vi.fn(),
    onOpenDesignations: vi.fn(),
    selectMode: false,
    onToggleSelectMode: vi.fn(),
    selectionSize: 0,
    resistanceLevel: 'off' as const,
    monarch: false,
    initiative: false,
    citysBlessing: false,
    hasUnreadLog: false,
  };
}

describe('ActionBar — back button (B6-04)', () => {
  it('omits the back button when onBack is not supplied', () => {
    render(<ActionBar {...baseProps()} />);
    expect(screen.queryByRole('button', { name: /^←/ })).toBeNull();
  });

  it('renders and wires the back button when supplied', () => {
    const onBack = vi.fn();
    render(<ActionBar {...baseProps()} backLabel="Abigale" onBack={onBack} />);
    const btn = screen.getByRole('button', { name: '← Abigale' });
    fireEvent.click(btn);
    expect(onBack).toHaveBeenCalledOnce();
  });

  describe('secondary actions fold by viewport width', () => {
    // happy-dom's matchMedia never matches; emulate a viewport by answering
    // only `(max-width: Npx)` queries whose N is at least the given width.
    function viewport(width: number) {
      vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
        const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? NaN);
        return {
          matches: Number.isFinite(max) && width <= max,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as unknown as MediaQueryList;
      });
    }
    afterEach(() => vi.restoreAllMocks());

    it('shows every action inline when the full bar fits', () => {
      viewport(1900);
      render(<ActionBar {...baseProps()} />);
      expect(screen.getByRole('button', { name: 'Shuffle' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'More playtest actions' })).toBeNull();
    });

    it('folds the secondary actions into the overflow menu on a laptop-width viewport', () => {
      viewport(1440);
      render(<ActionBar {...baseProps()} />);
      expect(screen.queryByRole('button', { name: 'Shuffle' })).toBeNull();
      expect(screen.getByRole('button', { name: 'More playtest actions' })).toBeTruthy();
      // The everyday actions stay inline.
      expect(screen.getByRole('button', { name: 'Draw' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Next turn' })).toBeTruthy();
    });

    it('never folds Top cards / Create token — they stay inline even when the bar folds', () => {
      viewport(1440);
      render(<ActionBar {...baseProps()} />);
      expect(screen.getByRole('button', { name: 'Top cards' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Create token' })).toBeTruthy();
    });
  });
});

describe('ActionBar — online table controls', () => {
  function onlineProps(overrides: Partial<OnlineBarProps> = {}): OnlineBarProps {
    return {
      phase: undefined,
      activeSeat: 0,
      mySeat: 0,
      activeName: 'Me',
      dispatch: vi.fn(),
      onPassTurn: vi.fn(),
      ...overrides,
    };
  }

  it('shows neither the phase clock nor pass turn in solo play', () => {
    render(<ActionBar {...baseProps()} />);
    expect(screen.queryByRole('button', { name: 'Pass turn' })).toBeNull();
    expect(screen.queryByText('Start the phase clock')).toBeNull();
  });

  it('shows a primary Pass turn button when it is my turn, wired to onPassTurn', () => {
    const online = onlineProps({ activeSeat: 0, mySeat: 0 });
    render(<ActionBar {...baseProps()} online={online} />);
    const btn = screen.getByRole('button', { name: 'Pass turn' });
    fireEvent.click(btn);
    expect(online.onPassTurn).toHaveBeenCalledOnce();
  });

  it('shows Pass turn for everyone when nobody has the turn yet (activeSeat null)', () => {
    const online = onlineProps({ activeSeat: null, mySeat: 1 });
    render(<ActionBar {...baseProps()} online={online} />);
    expect(screen.getByRole('button', { name: 'Pass turn' })).toBeTruthy();
  });

  it("shows a non-interactive '{name}'s turn' chip on another seat's turn", () => {
    const online = onlineProps({ activeSeat: 2, mySeat: 0, activeName: 'Maya' });
    render(<ActionBar {...baseProps()} online={online} />);
    expect(screen.queryByRole('button', { name: 'Pass turn' })).toBeNull();
    expect(screen.getByText("Maya's turn")).toBeTruthy();
  });

  it('demotes local Next turn to a secondary action with an online-specific title', () => {
    const online = onlineProps();
    render(<ActionBar {...baseProps()} online={online} />);
    const btn = screen.getByRole('button', { name: 'Next turn' });
    expect(btn.title).toBe('Untap all and draw for your new turn');
    expect(btn.className).not.toContain('playtest-actionbar__primary');
  });

  it('shows "Start the phase clock" only for the active seat when no phase is running', () => {
    const online = onlineProps({ phase: undefined, activeSeat: 0, mySeat: 0 });
    render(<ActionBar {...baseProps()} online={online} />);
    const startBtn = screen.getByRole('button', { name: 'Start the phase clock' });
    fireEvent.click(startBtn);
    expect(online.dispatch).toHaveBeenCalledWith({
      type: 'phase',
      phase: 'beginning',
      actorSeat: 0,
    });
  });

  it('does not offer to start the phase clock from a non-active seat', () => {
    const online = onlineProps({ phase: undefined, activeSeat: 1, mySeat: 0 });
    render(<ActionBar {...baseProps()} online={online} />);
    expect(screen.queryByText('Start the phase clock')).toBeNull();
  });
});
