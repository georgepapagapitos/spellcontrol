import { describe, expect, it, vi } from 'vitest';
import { buildBulkActions } from './deck-display-actions';
import type { DeckDisplayCard } from './deck-display-types';

const slot = (slotId: string, name: string): DeckDisplayCard => ({
  slotId,
  card: { name } as DeckDisplayCard['card'],
});

const deck = [
  [slot('a', 'Blood Moon'), slot('b', 'Urborg, Tomb of Yawgmoth'), slot('c', 'Rat Colony')],
  [slot('d', 'Rat Colony')],
  [slot('e', 'Counterspell'), slot('f', 'Swords to Plowshares')],
];

function actions(keys: string[], askRules: ((names: string[]) => void) | null) {
  const setSelection = vi.fn();
  const list = buildBulkActions({
    selection: { zone: 'cards', keys: new Set(keys) },
    hasSideboard: true,
    onBulkMove: vi.fn(),
    onBulkRemove: vi.fn(),
    setSelection,
    setConfirmBulkRemove: vi.fn(),
    askRules,
    zones: deck,
  });
  return { ask: list.find((a) => a.key === 'ask'), list, setSelection };
}

describe('buildBulkActions: Ask a rules question', () => {
  it('asks about the selected cards by name, once each, and ends the selection', () => {
    const askRules = vi.fn();
    const { ask, setSelection } = actions(['a', 'c', 'd'], askRules);
    expect(ask?.label).toBe('Ask a rules question');
    ask!.run();
    expect(askRules).toHaveBeenCalledWith(['Blood Moon', 'Rat Colony']);
    expect(setSelection).toHaveBeenCalledWith(null);
  });

  it('sits after the moves and before Remove', () => {
    const keys = actions(['a'], vi.fn()).list.map((a) => a.key);
    expect(keys.indexOf('ask')).toBeGreaterThan(keys.indexOf('considering'));
    expect(keys.indexOf('ask')).toBeLessThan(keys.indexOf('remove'));
  });

  it('is offered for one to four cards only, and never without AI', () => {
    expect(actions(['a', 'b', 'e', 'f'], vi.fn()).ask).toBeTruthy();
    expect(actions(['a', 'b', 'c', 'e', 'f'], vi.fn()).ask).toBeUndefined();
    expect(actions(['a'], null).ask).toBeUndefined();
  });

  it('is absent for a slot with no card behind it', () => {
    expect(actions(['zz'], vi.fn()).ask).toBeUndefined();
  });
});
