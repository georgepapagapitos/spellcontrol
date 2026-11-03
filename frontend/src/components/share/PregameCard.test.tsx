// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Deck } from '@/store/decks';
import { PregameCard } from './PregameCard';

const { clockState } = vi.hoisted(() => ({
  clockState: { value: { clock: null, pending: false } as unknown },
}));
vi.mock('@/lib/mana-sim/use-assembly-clock', () => ({
  useAssemblyClock: () => clockState.value,
}));

const path = {
  primary: {
    category: 'infinite-combo',
    assembly: [{ names: ['Thassa’s Oracle', 'Demonic Consultation'], need: 2 }],
  },
  tutors: [],
};

function deck(over: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Kinnan Tempo',
    commander: { name: 'Kinnan, Bonder Prodigy' },
    bracketEstimation: { bracket: 3, breakdown: { gameChangerCount: 2 } },
    winConditions: path,
    ...over,
  } as unknown as Deck;
}

const props = {
  library: [],
  bracket: 3,
  bracketText: 'Bracket 3',
  url: 'https://spellcontrol.com/d/abc',
};

const clock = {
  runs: 1000,
  assembledBy: [0, 0, 0, 0, 0, 0.22, 0.5, 0.6, 0.7, 0.8],
};

describe('PregameCard', () => {
  beforeEach(() => {
    clockState.value = { clock, pending: false };
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows bracket, Game Changers and the speed against the Wizards band', () => {
    render(<PregameCard deck={deck()} {...props} />);
    expect(screen.getByRole('heading', { name: 'Before you sit down' })).toBeTruthy();
    expect(screen.getByText('Kinnan, Bonder Prodigy')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('before turn 6: 22% of games')).toBeTruthy();
    expect(
      screen.getByText(/Bracket 3 expects turn 6 or later\. From 1,000 simulated games/)
    ).toBeTruthy();
  });

  it('holds the speed row with a status while the clock runs', () => {
    clockState.value = { clock: null, pending: true };
    const { container } = render(<PregameCard deck={deck()} {...props} />);
    expect(screen.getByText('Running the speed read')).toBeTruthy();
    expect(container.querySelector('dl')?.getAttribute('aria-busy')).toBe('true');
  });

  it('says so when the deck has no win path to time', () => {
    clockState.value = { clock: null, pending: false };
    render(<PregameCard deck={deck({ winConditions: undefined })} {...props} />);
    expect(screen.getByText('No combo or alternate win path to time.')).toBeTruthy();
  });

  it('leaves out Game Changers when the estimate never counted them', () => {
    render(<PregameCard deck={deck({ bracketEstimation: undefined })} {...props} />);
    expect(screen.queryByText('Game Changers')).toBeNull();
  });

  it('folds Copy summary and Copy link into one Share menu (PS-05)', () => {
    vi.stubGlobal('navigator', { ...navigator, share: undefined });
    render(<PregameCard deck={deck()} {...props} />);
    // One button at rest: Copy link no longer wraps alone onto a second row.
    const actions = document.querySelector('.pregame-card-actions')!;
    expect(actions.querySelectorAll('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Copy summary' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Share this deck' }));
    expect(screen.getByRole('menuitem', { name: 'Copy summary' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Copy link' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Share…' })).toBeNull();
  });

  it('adds the native Share row only where the browser can, and the menu is keyboard-operable', () => {
    vi.stubGlobal('navigator', { ...navigator, share: vi.fn() });
    render(<PregameCard deck={deck()} {...props} />);
    const trigger = screen.getByRole('button', { name: 'Share this deck' });
    expect(trigger.getAttribute('aria-haspopup')).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Share…' })).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: 'Copy link' })).toBeNull();
  });
});
