// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { OpeningHandSheet, TAKEOVER_QUERY } from './OpeningHandSheet';
import type { PlaytestCard } from '@/lib/playtest';

/** `useMediaQuery` reads `window.matchMedia`; happy-dom has none by default.
 *  `wide` decides only the takeover query, so the same stub serves the sheet
 *  tier (phone) and the takeover tier (tablet and up). */
function stubViewport(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === TAKEOVER_QUERY ? wide : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function hand(n = 7): PlaytestCard[] {
  return Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Card ${i}` }));
}

type Overrides = Partial<React.ComponentProps<typeof OpeningHandSheet>>;

function renderSheet(overrides: Overrides = {}) {
  const props = {
    phase: 'opening' as const,
    hand: hand(),
    mulliganCount: 0,
    cardsOwedToBottom: 0,
    freeMulligan: false,
    onFreeMulliganChange: vi.fn(),
    onDraw: false,
    onOnDrawChange: vi.fn(),
    onKeep: vi.fn(),
    onMulligan: vi.fn(),
    onConfirmBottom: vi.fn(),
    ...overrides,
  };
  const result = render(<OpeningHandSheet {...props} />);
  return { ...result, props };
}

function root() {
  return document.querySelector('.playtest-opening-root');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('OpeningHandSheet tier', () => {
  it('renders the takeover at tablet and up', () => {
    stubViewport(true);
    renderSheet({ deckName: 'Atraxa' });
    expect(root()?.className).toContain('is-takeover');
    // The takeover names the deck and carries the peek action; the sheet does
    // neither.
    expect(screen.getByRole('heading', { name: 'Atraxa' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View battlefield' })).toBeTruthy();
  });

  it('renders the sheet below tablet, unchanged', () => {
    stubViewport(false);
    renderSheet({ deckName: 'Atraxa' });
    expect(root()?.className).not.toContain('is-takeover');
    expect(screen.getByRole('heading', { name: 'Opening hand' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'View battlefield' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Keep this hand' })).toBeTruthy();
  });

  it('gives every card a fan index so the geometry has something to read', () => {
    stubViewport(true);
    renderSheet();
    const slots = document.querySelectorAll<HTMLElement>('.playtest-opening-slot');
    expect(slots).toHaveLength(7);
    expect(slots[0].style.getPropertyValue('--oh-i')).toBe('0');
    expect(slots[0].style.getPropertyValue('--oh-n')).toBe('7');
    // Middle card sits highest in the arc; the ends hang below it.
    expect(slots[3].style.getPropertyValue('--oh-lift')).toBe('0px');
    expect(slots[0].style.getPropertyValue('--oh-lift')).toBe('36px');
  });
});

describe('OpeningHandSheet peek', () => {
  it('pulls the takeover aside and back again', () => {
    stubViewport(true);
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'View battlefield' }));
    expect(root()?.className).toContain('is-peeking');

    fireEvent.click(screen.getByRole('button', { name: 'Back to hand' }));
    expect(root()?.className).not.toContain('is-peeking');
  });

  it('ends on Escape — the only thing Escape does here', () => {
    stubViewport(true);
    renderSheet();
    fireEvent.keyDown(window, { key: 'Escape' });
    // Nothing to end yet: the opening hand is non-dismissable.
    expect(root()).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'View battlefield' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(root()?.className).not.toContain('is-peeking');
    expect(root()).toBeTruthy();
  });
});

describe('OpeningHandSheet online curtain', () => {
  it('waits on the seats still choosing, counts the table in, then lifts', () => {
    vi.useFakeTimers();
    stubViewport(true);
    const { rerender, props } = renderSheet({
      phase: 'playing',
      online: { waitingOn: ['Bo', 'Cy'], allKept: false },
    });
    expect(root()?.className).toContain('is-waiting');
    expect(screen.getByText('Waiting for Bo and Cy')).toBeTruthy();
    // The decision is already made — no way back to it.
    expect(screen.queryByRole('button', { name: 'Mulligan' })).toBeNull();

    rerender(
      <OpeningHandSheet {...props} phase="playing" online={{ waitingOn: [], allKept: true }} />
    );
    expect(screen.getByText('Game starts in 3s')).toBeTruthy();

    // One second per act: each tick's successor is scheduled by the effect
    // that runs after that render, so the clock can't be jumped in one go.
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByText('Game starts in 2s')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1000));
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByText('Game has started')).toBeTruthy();

    act(() => void vi.advanceTimersByTime(800));
    expect(root()).toBeNull();
  });

  it('waits for arrivals, never counts itself in, when nobody else is seated', () => {
    vi.useFakeTimers();
    stubViewport(true);
    // PlaytestBoard checks the opponent COUNT before `every()` — an empty
    // table would otherwise report itself all-kept and start the countdown.
    renderSheet({ phase: 'playing', online: { waitingOn: [], allKept: false } });
    expect(screen.getByText('Waiting for players to join')).toBeTruthy();

    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByText('Waiting for players to join')).toBeTruthy();
    expect(root()).toBeTruthy();
  });

  it('is nothing at all once the phase moves on solo', () => {
    stubViewport(true);
    renderSheet({ phase: 'playing' });
    expect(root()).toBeNull();
  });
});

describe('the mulligan rule in force', () => {
  it('bottoms the count it is given, not the mulligan count', () => {
    // A commander-rule table on its second mulligan owes one, not two.
    renderSheet({ phase: 'mulligan-bottom', mulliganCount: 2, cardsOwedToBottom: 1 });
    expect(screen.getByText(/Tap 1 card to send to the bottom/)).toBeTruthy();
  });

  it('offers the free-mulligan switch solo, and states the table rule instead when seated', () => {
    const solo = renderSheet();
    expect(solo.getByRole('checkbox', { name: 'Free mulligans' })).toBeTruthy();
    solo.unmount();

    renderSheet({ tableMulligan: 'Table rule: the first mulligan is free.' });
    expect(screen.getByText('Table rule: the first mulligan is free.')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Free mulligans' })).toBeNull();
  });
});
