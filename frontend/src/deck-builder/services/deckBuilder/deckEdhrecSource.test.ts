// Guard (T171 lane M re-gate): Coach reads a generated deck against the EDHREC
// page it was built from. The analysis always read the commander's base page,
// so a Zombies Gisa deck's 62% lords read as 0% misfits and a Bracket 4
// Yuriko's Scroll Rack (54.7% on its bracket page) fell under the 40% staple
// line.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EDHRECCard, EDHRECCommanderData, ThemeResult } from '@/deck-builder/types';

const page = (names: string[]): EDHRECCommanderData =>
  ({
    themes: [],
    stats: { numDecks: 100 },
    cardlists: {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand: names.map(
        (name) => ({ name, sanitized: name, primary_type: 'Creature', inclusion: 50 }) as EDHRECCard
      ),
    },
    similarCommanders: [],
  }) as unknown as EDHRECCommanderData;

const client = vi.hoisted(() => ({
  fetchCommanderData: vi.fn(),
  fetchPartnerCommanderData: vi.fn(),
  fetchCommanderThemeData: vi.fn(),
  fetchPartnerThemeData: vi.fn(),
}));
vi.mock('@/deck-builder/services/edhrec/client', () => client);

import { deckEdhrecSource, fetchDeckEdhrecPage } from './deckEdhrecSource';

const zombies: ThemeResult = {
  name: 'Zombies',
  slug: 'zombies',
  source: 'edhrec',
  isSelected: true,
};
const generated = (
  rung: string | undefined,
  customization: Record<string, unknown>,
  themes: ThemeResult[] = [zombies]
) => ({
  generationContext: {
    selectedThemes: themes,
    targetBracket: (customization.targetBracket as number | 'all') ?? 'all',
    landCount: 36,
    collectionMode: false,
    customization,
  },
  buildReport: rung ? { dataSource: rung as 'theme' } : undefined,
});
const commander = { name: 'Gisa, Glorious Resurrector' } as never;

beforeEach(() => {
  for (const f of Object.values(client)) f.mockReset();
  client.fetchCommanderData.mockImplementation(async (_n: string, _b?: string, t?: number) =>
    page([t ? `bracket-${t}` : 'base'])
  );
  client.fetchCommanderThemeData.mockImplementation(async (_n: string, slug: string) =>
    page([`theme-${slug}`])
  );
});

describe('deckEdhrecSource', () => {
  it('reads nothing for a hand-built deck', () => {
    expect(deckEdhrecSource({ generationContext: null })).toBeUndefined();
  });

  it('follows the rung the build report records', () => {
    expect(
      deckEdhrecSource(generated('theme+bracket', { targetBracket: 3, budgetOption: 'budget' }))
    ).toEqual({ themes: [zombies], targetBracket: 3, budgetOption: 'budget' });
    // E93 laddered off the bracket: the theme page without it.
    expect(deckEdhrecSource(generated('theme', { targetBracket: 3 }))).toEqual({
      themes: [zombies],
      targetBracket: undefined,
      budgetOption: undefined,
    });
    expect(deckEdhrecSource(generated('base+bracket', { targetBracket: 4 }))).toEqual({
      themes: [],
      targetBracket: 4,
      budgetOption: undefined,
    });
  });

  it('replays the settings of a deck saved before the rung was recorded', () => {
    expect(deckEdhrecSource(generated(undefined, { targetBracket: 2 }))).toEqual({
      themes: [zombies],
      targetBracket: 2,
      budgetOption: undefined,
    });
  });
});

describe('fetchDeckEdhrecPage', () => {
  const names = (p: EDHRECCommanderData) => p.cardlists.allNonLand.map((c) => c.name);

  it('reads the theme page a themed deck was built from', async () => {
    const p = await fetchDeckEdhrecPage(commander, null, {
      themes: [zombies],
      targetBracket: 4,
    });
    expect(names(p)).toEqual(['theme-zombies']);
    expect(client.fetchCommanderThemeData).toHaveBeenCalledWith(
      'Gisa, Glorious Resurrector',
      'zombies',
      undefined,
      4
    );
  });

  it('reads the bracket page a bracket deck was built from', async () => {
    const p = await fetchDeckEdhrecPage(commander, null, { themes: [], targetBracket: 4 });
    expect(names(p)).toEqual(['bracket-4']);
  });

  it('falls back to the base page when the theme page is empty or fails', async () => {
    client.fetchCommanderThemeData.mockResolvedValueOnce(page([]));
    expect(names(await fetchDeckEdhrecPage(commander, null, { themes: [zombies] }))).toEqual([
      'base',
    ]);
    client.fetchCommanderThemeData.mockRejectedValueOnce(new Error('404'));
    expect(names(await fetchDeckEdhrecPage(commander, null, { themes: [zombies] }))).toEqual([
      'base',
    ]);
  });

  it('reads the base page with no source', async () => {
    expect(names(await fetchDeckEdhrecPage(commander, null, undefined))).toEqual(['base']);
  });
});
