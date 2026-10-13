import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScryfallCard } from '@/deck-builder/types';

vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  upgradeCardPrintings: vi.fn(),
}));

import { upgradeCardPrintings } from '@/deck-builder/services/scryfall/client';
import { holdSpellsToFilter } from './fetchPassingWindows';

// Real Scryfall printings of two spells and a land (see the fixture's _source).
const PRINTINGS = (
  JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '__fixtures__',
        'unpriced-printings.fixture.json'
      ),
      'utf8'
    )
  ) as { cards: ScryfallCard[] }
).cards;
const first = (name: string) => PRINTINGS.find((c) => c.name === name)!;

// E1004: the budget-converge extra pool resolved its names with no Scryfall
// filter, so a card the filter dropped from the main pool came back as a swap.
describe('holdSpellsToFilter', () => {
  beforeEach(() => {
    vi.mocked(upgradeCardPrintings).mockReset();
  });

  it('removes a spell with no matching printing and never shows the filter a land', async () => {
    // t:creature-style filter: Lightning Bolt has no matching printing, Cultivate does.
    let shown: string[] = [];
    vi.mocked(upgradeCardPrintings).mockImplementation(async (cards) => {
      shown = [...cards.keys()].sort();
      cards.delete('Lightning Bolt');
    });
    const cards = new Map([
      ['Lightning Bolt', first('Lightning Bolt')],
      ['Cultivate', first('Cultivate')],
      ['Command Tower', first('Command Tower')],
    ]);

    await holdSpellsToFilter(cards, undefined, 't:sorcery');

    expect([...cards.keys()].sort()).toEqual(['Command Tower', 'Cultivate']);
    expect(shown).toEqual(['Cultivate', 'Lightning Bolt']);
    expect(vi.mocked(upgradeCardPrintings).mock.calls[0][1]).toBe('t:sorcery');
  });

  it('seats the printing the filter chose', async () => {
    const fdc = PRINTINGS.find((c) => c.name === 'Lightning Bolt' && c.set === 'fdc')!;
    vi.mocked(upgradeCardPrintings).mockImplementation(async (cards) => {
      cards.set('Lightning Bolt', fdc);
    });
    const cards = new Map([['Lightning Bolt', first('Lightning Bolt')]]);
    await holdSpellsToFilter(cards, undefined, '-set:cmm');
    expect(cards.get('Lightning Bolt')?.set).toBe('fdc');
  });

  it('drops a spell outside a required set before asking Scryfall', async () => {
    const cards = new Map([['Cultivate', first('Cultivate')]]);
    await holdSpellsToFilter(cards, 'cmm', 'set:cmm');
    expect(cards.size).toBe(0);
  });
});
