import { describe, it, expect, vi } from 'vitest';
import type { CommanderProfile } from '@/deck-builder/services/deckBuilder/commanderProfile';
import type { Change } from './deck-change';
import { deriveLeanThemes, leanRank } from './lean-into';

const TAGGED: Record<string, string[]> = {
  'Vito, Thorn of the Dusk Rose': ['lifegain'],
  'Essence Warden': ['lifegain'],
  'Viscera Seer': ['sacrifice'],
};
vi.mock('@/deck-builder/services/tagger/client', () => ({
  hasTag: (name: string, tag: string) => TAGGED[name]?.includes(tag) ?? false,
}));

const profile = {
  abilities: [
    { keyword: 'sacrifice', label: 'Sacrifice payoff' },
    { keyword: 'lifegain', label: 'Lifegain payoff' },
    { keyword: 'tribal', label: 'Tribal' },
    { keyword: 'mill', label: 'Mill' },
  ],
  tribes: [],
} as unknown as CommanderProfile;

const add = (name: string, over: Partial<Change> = {}): Change => ({
  id: `add:${name}`,
  type: 'add',
  lane: 'fill-gaps',
  name,
  ...over,
});

const changes = [
  add('Cultivate'),
  add('Essence Warden'),
  add('Vito, Thorn of the Dusk Rose'),
  add('Viscera Seer'),
  add('Beast Whisperer', { lane: 'upgrade', axis: 'creature-etb', group: 'Creature enters' }),
  add('Budding Thing', { axis: 'tokens', group: 'Tokens', budding: true }),
  { id: 'cut:Vito', type: 'cut', lane: 'upgrade', name: 'Vito, Thorn of the Dusk Rose' } as Change,
];

describe('deriveLeanThemes', () => {
  it('offers only themes some row serves, most rows first, capped at three', () => {
    const themes = deriveLeanThemes(changes, profile);
    expect(themes.map((t) => [t.label, t.count])).toEqual([
      ['Lifegain payoff', 2],
      ['Sacrifice payoff', 1],
      ['Creature enters', 1],
    ]);
  });

  it('skips tribal, themes nothing serves, budding axes and cuts', () => {
    const labels = deriveLeanThemes(changes, profile, 9).map((t) => t.label);
    expect(labels).not.toContain('Mill');
    expect(labels).not.toContain('Tribal');
    expect(labels).not.toContain('Tokens');
  });

  it('still offers a deck engine axis with no commander profile', () => {
    expect(deriveLeanThemes(changes, null).map((t) => t.label)).toEqual(['Creature enters']);
  });
});

describe('leanRank', () => {
  const rows = changes.map((change) => ({ change }));

  it('puts serving rows first, keeps both groups in their order, and says which theme', () => {
    const { rows: ranked, notes } = leanRank(rows, 'ability:lifegain', changes, profile);
    expect(ranked.map((r) => r.change.name).slice(0, 3)).toEqual([
      'Essence Warden',
      'Vito, Thorn of the Dusk Rose',
      'Cultivate',
    ]);
    expect(ranked).toHaveLength(rows.length);
    expect(notes.get('add:Essence Warden')).toMatch(/lifegain payoff/i);
    expect(notes.get('add:Cultivate')).toBeUndefined();
  });

  it('never marks or moves a cut', () => {
    const { notes } = leanRank(rows, 'ability:lifegain', changes, profile);
    expect(notes.has('cut:Vito')).toBe(false);
  });

  it('leaves the list alone for an unknown theme', () => {
    expect(leanRank(rows, 'ability:nope', changes, profile).rows).toBe(rows);
  });
});
