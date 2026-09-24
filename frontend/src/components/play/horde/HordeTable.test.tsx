// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createPlaytestState, type PlaytestCard } from '@/lib/playtest';
import { resolveHordeSettings, type HordeSettings } from '@/lib/horde';
import { useHordeGameStore, type HordeConfig } from '@/store/horde-game';
import { HordeTable } from './HordeTable';

const CREATURE: PlaytestCard = {
  id: 'c1',
  name: 'Zombie',
  typeLine: 'Token Creature — Zombie',
  power: '2',
  toughness: '2',
  isToken: true,
};
const SPELL: PlaytestCard = { id: 's1', name: 'Plague Wind', typeLine: 'Sorcery' };
const FILLER: PlaytestCard[] = Array.from({ length: 6 }, (_, i) => ({
  id: `f${i}`,
  name: `Filler ${i}`,
  typeLine: 'Token Creature — Zombie',
  isToken: true,
}));

function seed(settingsOverride?: Partial<HordeSettings>) {
  const library = [CREATURE, SPELL, ...FILLER];
  const board = createPlaytestState({ library, command: [], seed: 1, openingHandSize: 0 });
  const settings = resolveHordeSettings('standard', 2, { setupTurns: 0, ...settingsOverride });
  const config: HordeConfig = {
    hordeId: 'zombies',
    hordeName: 'Zombies',
    level: 'standard',
    settings,
    survivors: [
      { name: 'Alice', deckId: null, deckName: null },
      { name: 'Bo', deckId: null, deckName: null },
    ],
  };
  useHordeGameStore.setState({
    config,
    boardVisible: true,
    status: 'idle',
    loadError: null,
    pendingStart: null,
    seed: 1,
    survivorsLife: settings.life,
    board,
    librarySizeAtStart: library.length,
    bossesRemaining: 0,
    bossTicksCrossed: [],
    survivorTurn: 1,
    hordeTurn: 0,
    phase: 'live',
    pendingReveal: null,
    pendingAttack: null,
    lastDamageResult: null,
    attackingIds: [],
    outcome: null,
    startedAt: Date.now(),
    cardsMilledByDamage: 0,
    damageTaken: 0,
    past: [],
    finished: [],
  });
}

beforeEach(() => {
  localStorage.clear();
  // Reduced motion true so `useSheetExit` closes every sheet synchronously
  // (no `animationend` fires under happy-dom); every other query reads
  // false, so the portrait-tablet gate never blocks the table.
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  );
});

describe('HordeTable', () => {
  it('renders the survivors life, the horde name/status, and the two actions', () => {
    seed();
    render(<HordeTable />);
    expect(screen.getByText('Zombies')).toBeTruthy();
    expect(screen.getByText(/Survivors · 2/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /You: \d+ life/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Damage the horde' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Horde turn' })).toBeTruthy();
  });

  it('shows the library meter with a boss tick per bossTicks entry and the next-boss countdown', () => {
    seed(); // standard preset: bossTicks [0.5, 1], an 8-card fixture library
    render(<HordeTable />);
    expect(screen.getByText(/Horde library · 8 \/ 8/)).toBeTruthy();
    expect(document.querySelectorAll('.horde-table-meter-tick').length).toBe(2);
    // Half of 8 is 4 remaining — the next tick (0.5) fires 4 cards from now.
    expect(screen.getByText('Next boss in 4')).toBeTruthy();
  });

  it('disables Horde turn during setup and names the turn it arrives', () => {
    seed({ setupTurns: 3 });
    useHordeGameStore.setState({ phase: 'setup' });
    render(<HordeTable />);
    const btn = screen.getByRole('button', {
      name: /Horde arrives after turn 3/,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('opens the reveal sheet on Horde turn, and confirming closes it', () => {
    seed();
    render(<HordeTable />);
    fireEvent.click(screen.getByRole('button', { name: 'Horde turn' }));
    expect(screen.getByRole('dialog', { name: 'The horde reveals' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.queryByRole('dialog', { name: 'The horde reveals' })).toBeNull();
  });

  it('opens the damage sheet and mills the library on confirm', () => {
    seed();
    render(<HordeTable />);
    fireEvent.click(screen.getByRole('button', { name: 'Damage the horde' }));
    expect(screen.getByRole('dialog', { name: 'Damage the horde' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(useHordeGameStore.getState().cardsMilledByDamage).toBeGreaterThan(0);
  });

  function seedBattlefieldCard() {
    seed();
    // A card already on the battlefield gets its own id, distinct from any
    // library card — `locate()` checks zones before the battlefield, so a
    // shared id would resolve to the wrong copy.
    const onBoard: PlaytestCard = { ...CREATURE, id: 'onboard-1' };
    useHordeGameStore.setState((s) => ({
      board: {
        ...s.board!,
        battlefield: [
          {
            card: onBoard,
            tapped: false,
            counters: {},
            stickers: [],
            x: 0.5,
            y: 0.5,
            faceDown: false,
          },
        ],
      },
    }));
  }

  it("opens a card's menu from a mouse click on the battlefield and records it destroyed", () => {
    seedBattlefieldCard();
    render(<HordeTable />);
    const cardEl = document.querySelector('[data-card-id="onboard-1"]') as HTMLElement;
    fireEvent.click(cardEl);
    expect(screen.getByRole('dialog', { name: 'Zombie' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Destroyed' }));
    expect(useHordeGameStore.getState().board?.battlefield).toEqual([]);
  });

  it("opens a card's menu from the keyboard (Enter)", () => {
    seedBattlefieldCard();
    render(<HordeTable />);
    const cardEl = document.querySelector('[data-card-id="onboard-1"]') as HTMLElement;
    cardEl.focus();
    fireEvent.keyDown(cardEl, { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Zombie' })).toBeTruthy();
  });

  it("opens a card's menu from the Context Menu key", () => {
    seedBattlefieldCard();
    render(<HordeTable />);
    const cardEl = document.querySelector('[data-card-id="onboard-1"]') as HTMLElement;
    cardEl.focus();
    fireEvent.keyDown(cardEl, { key: 'ContextMenu' });
    expect(screen.getByRole('dialog', { name: 'Zombie' })).toBeTruthy();
  });

  it("opens a card's menu from a touch tap (a release that never reached the long-press delay)", () => {
    seedBattlefieldCard();
    render(<HordeTable />);
    const cardEl = document.querySelector('[data-card-id="onboard-1"]') as HTMLElement;
    fireEvent.touchStart(cardEl, { touches: [{ clientX: 10, clientY: 10 }] });
    fireEvent.touchEnd(cardEl);
    // A quick tap synthesizes a click, same as a real touchscreen.
    fireEvent.click(cardEl);
    expect(screen.getByRole('dialog', { name: 'Zombie' })).toBeTruthy();
  });
});
