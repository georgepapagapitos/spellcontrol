import { describe, expect, it, vi } from 'vitest';
import type { PlaytestState } from '@/lib/playtest';
import { buildSettingsToggles, buildTableMenuItems } from './board-menus';

type TableMenuInput = Parameters<typeof buildTableMenuItems>[0];

function tableItems(overrides: Partial<TableMenuInput> = {}) {
  return buildTableMenuItems({
    state: { zones: { sideboard: [] } } as unknown as PlaytestState,
    onlineTable: null,
    takeback: { mode: 'solo', verdict: 'ok', stepsAvailable: 3 } as never,
    canPassTurn: false,
    hordeBlocksTurn: false,
    manaOpen: false,
    selectMode: false,
    keyFor: (id) => `key:${id}`,
    doPassTurn: vi.fn(),
    doNextTurnHordeAware: vi.fn(() => true),
    doUntapAll: vi.fn(),
    setManaOpen: vi.fn(),
    setTokenCreator: vi.fn(),
    setViewer: vi.fn(),
    setShowDice: vi.fn(),
    setShowDesignations: vi.fn(),
    sendReaction: vi.fn(),
    toggleSelectMode: vi.fn(),
    handleTakebackClick: vi.fn(),
    ...overrides,
  });
}

const labels = (items: ReturnType<typeof tableItems>) =>
  items.map((i) => (typeof i === 'object' ? i.label : '---'));

describe('buildTableMenuItems', () => {
  it('offers Next turn solo, with the pass-turn key, and Pass turn at a table on your turn', () => {
    expect(labels(tableItems())[0]).toBe('Next turn');
    expect(tableItems()[0]).toMatchObject({ shortcut: 'key:pass-turn' });
    expect(labels(tableItems({ canPassTurn: true, onlineTable: {} as never }))[0]).toBe(
      'Pass turn'
    );
  });

  it('only lists the sideboard and reactions when there is one to open', () => {
    expect(labels(tableItems())).not.toContain('View sideboard');
    expect(labels(tableItems())).not.toContain('Reactions');
    const withSideboard = tableItems({
      state: { zones: { sideboard: [{}] } } as unknown as PlaytestState,
      onlineTable: {} as never,
    });
    expect(labels(withSideboard)).toContain('View sideboard');
    expect(labels(withSideboard)).toContain('Reactions');
  });

  it('badges Take back with the step count, a lock, or Off', () => {
    const takeBack = (takeback: object) =>
      tableItems({ takeback: takeback as never }).at(-1) as { label: string; disabled: boolean };
    expect(takeBack({ mode: 'solo', verdict: 'ok', stepsAvailable: 3 }).label).toBe(
      'Take back (3)'
    );
    expect(takeBack({ mode: 'solo', verdict: 'locked', stepsAvailable: 3 }).label).toBe(
      'Take back (Locked)'
    );
    expect(takeBack({ mode: 'off', verdict: 'ok', stepsAvailable: 3 })).toMatchObject({
      label: 'Take back (Off)',
      disabled: true,
    });
    expect(takeBack({ mode: 'solo', verdict: 'ok', stepsAvailable: 0 }).label).toBe('Take back');
  });

  it('disables Next turn while the horde is mid-turn', () => {
    expect(tableItems({ hordeBlocksTurn: true })[0]).toMatchObject({ disabled: true });
  });
});

describe('buildSettingsToggles', () => {
  it('shows the turn alert only at an online table', () => {
    const base = { snap: true, setSnap: vi.fn(), turnAlert: false, setTurnAlert: vi.fn() };
    expect(buildSettingsToggles({ ...base, onlineTable: null }).map((t) => t.label)).toEqual([
      'Snap cards to grid',
    ]);
    expect(buildSettingsToggles({ ...base, onlineTable: {} as never }).map((t) => t.label)).toEqual(
      ['Snap cards to grid', 'Turn alert']
    );
  });
});
