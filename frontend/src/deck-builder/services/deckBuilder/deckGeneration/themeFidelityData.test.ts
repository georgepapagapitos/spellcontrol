// @vitest-environment node
//
// E574: the generator-side wiring of theme fidelity. The EDHREC client is
// stubbed to answer with the REAL Rin and Seri Cats and Dogs theme pages
// (__fixtures__/theme-fidelity.fixture.json), and the deck is the real Cats+Dogs
// build, so the note asserted here is the one the live panel produced.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EDHRECCommanderData, ThemeResult } from '@/deck-builder/types';
import type { ThemeCard } from '../themeFidelity';

const here = dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(
  readFileSync(resolve(here, '..', '__fixtures__', 'theme-fidelity.fixture.json'), 'utf8')
) as {
  pages: Record<'Cats' | 'Dogs', Record<string, number>>;
  deck: string[];
  cards: Record<string, ThemeCard>;
};

const pageData = (name: 'Cats' | 'Dogs'): EDHRECCommanderData =>
  ({
    cardlists: {
      allNonLand: Object.entries(FX.pages[name]).map(([n, synergy]) => ({
        name: n,
        synergy,
        inclusion: 50,
      })),
    },
  }) as unknown as EDHRECCommanderData;

const fetchTheme = vi.fn(
  async (_cmd: string, slug: string, _budget?: string, _bracket?: string) => {
    if (slug === 'broken') throw new Error('404');
    return pageData(slug === 'cats' ? 'Cats' : 'Dogs');
  }
);
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderThemeData: (...args: [string, string, string?, string?]) => fetchTheme(...args),
  fetchPartnerThemeData: vi.fn(),
  fetchAverageDeckSpells: vi.fn(),
}));
vi.mock('@/deck-builder/services/scryfall/client', () => ({ getCardsByNames: vi.fn() }));

import { deckThemeFidelity } from './themeFidelityData';

const theme = (name: string, slug: string): ThemeResult => ({
  name,
  slug,
  source: 'edhrec',
  isSelected: true,
});
const DECK = FX.deck.map((n) => FX.cards[n]);
const req = {
  themes: [theme('Cats', 'cats'), theme('Dogs', 'dogs')],
  commanderName: 'Rin and Seri, Inseparable',
  targetBracket: 3 as const,
};

beforeEach(() => fetchTheme.mockClear());

describe('deckThemeFidelity', () => {
  it('measures a deck built from its theme pages', async () => {
    const out = await deckThemeFidelity({ ...req, dataSource: 'theme+bracket' }, DECK);
    // The live panel dump (main b2401e0d) read 55 on-theme: 47 Cats, 8 Dogs.
    expect(out.themeFidelity).toMatchObject({
      nonland: 64,
      onTheme: 55,
      themes: [
        { name: 'Cats', cards: 47 },
        { name: 'Dogs', cards: 8 },
      ],
    });
  });

  it('reads the theme page the build used: the bracket page only for theme+bracket', async () => {
    await deckThemeFidelity({ ...req, dataSource: 'theme+bracket' }, DECK);
    expect(fetchTheme.mock.calls.map((c) => c[3])).toEqual([3, 3]);
    fetchTheme.mockClear();
    await deckThemeFidelity({ ...req, dataSource: 'theme' }, DECK);
    expect(fetchTheme.mock.calls.map((c) => c[3])).toEqual([undefined, undefined]);
  });

  it('says nothing for a deck that fell back to the base page', async () => {
    expect(await deckThemeFidelity({ ...req, dataSource: 'base+bracket' }, DECK)).toEqual({});
    expect(fetchTheme).not.toHaveBeenCalled();
  });

  it('says nothing without themes', async () => {
    expect(await deckThemeFidelity({ ...req, themes: [], dataSource: 'theme' }, DECK)).toEqual({});
  });

  it('drops a theme whose page cannot be read instead of failing the build', async () => {
    const out = await deckThemeFidelity(
      { ...req, themes: [theme('Cats', 'cats'), theme('Dogs', 'broken')], dataSource: 'theme' },
      DECK
    );
    expect(out.themeFidelity?.themes).toEqual([{ name: 'Cats', cards: expect.any(Number) }]);
  });
});
