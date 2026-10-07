// @vitest-environment node
//
// E574: the theme-fidelity measure, over the REAL data it reads. The fixture
// holds the Cats and Dogs theme pages of Rin and Seri, Inseparable on EDHREC
// (name -> synergy, fetched 2026-10-07), the two themes' average-deck spells, a
// real Cats+Dogs build from the live panel (main b2401e0d), and real off-theme
// staples from the commander's base page, all with their Scryfall type lines
// and keywords. Nothing here is author-written card data.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GeneratedDeck, ScryfallCard } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';
import { checkDeckInvariants } from './deckInvariants';
import { normalizeCardName } from './cardIdentity';
import { assembleBuildReport } from './buildReport';
import {
  THEME_SHARE_MARGIN,
  describeThemeFidelity,
  isOnTheme,
  measureThemeFidelity,
  themeDilution,
  themeTribe,
  type ThemeCard,
  type ThemePage,
} from './themeFidelity';
import { assemble, cleanCategories, context, customization } from './__fixtures__/invariant-deck';

const here = dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(
  readFileSync(resolve(here, '__fixtures__', 'theme-fidelity.fixture.json'), 'utf8')
) as {
  pages: Record<'Cats' | 'Dogs', Record<string, number>>;
  averageDecks: Record<'Cats' | 'Dogs', string[]>;
  deck: string[];
  staples: string[];
  cards: Record<string, ThemeCard>;
};

const card = (name: string): ThemeCard => {
  const c = FX.cards[name];
  if (!c) throw new Error(`no fixture card ${name}`);
  return c;
};
const cards = (names: string[]) => names.map(card);

function page(name: 'Cats' | 'Dogs', withAverage = true): ThemePage {
  return {
    name,
    tribe: themeTribe(name),
    synergy: new Map(
      Object.entries(FX.pages[name]).map(([n, s]) => [normalizeCardName(frontFaceName(n)), s])
    ),
    averageDeck: withAverage ? cards(FX.averageDecks[name]) : undefined,
  };
}
const PAGES = [page('Cats'), page('Dogs')];

/** The real build with its first `n` on-theme cards swapped for real staples. */
function dilute(n: number): ThemeCard[] {
  const nonland = cards(FX.deck);
  const drop = new Set(
    nonland
      .filter((c) => PAGES.some((p) => isOnTheme(c, p)))
      .slice(0, n)
      .map((c) => c.name)
  );
  return [...nonland.filter((c) => !drop.has(c.name)), ...cards(FX.staples).slice(0, n)];
}

describe('themeTribe', () => {
  it('reads a tribal theme name as its creature type', () => {
    expect(themeTribe('Cats')).toBe('Cat');
    expect(themeTribe('Dogs')).toBe('Dog');
    expect(themeTribe('Elves')).toBe('Elf');
  });
  it('is undefined for a mechanic theme', () => {
    expect(themeTribe('+1/+1 Counters')).toBeUndefined();
    expect(themeTribe('Ninjutsu')).toBeUndefined();
  });
});

describe('isOnTheme', () => {
  it('counts a changeling as every creature type, even when the page does not list it', () => {
    const changeling = FX.deck.map(card).find((c) => c.keywords?.includes('Changeling'));
    expect(changeling, 'the real build seats a changeling').toBeDefined();
    const bare: ThemePage = { name: 'Dogs', tribe: 'Dog', synergy: new Map() };
    expect(isOnTheme(changeling!, bare)).toBe(true);
  });

  it('does not count a staple the theme page lists without lift', () => {
    // Swords to Plowshares is on the Cats page (a theme page lists the
    // commander's staples too) but without synergy, so the page alone must not
    // make it on-theme.
    expect(FX.pages.Cats['Swords to Plowshares']).toBeDefined();
    expect(isOnTheme(card('Swords to Plowshares'), page('Cats'))).toBe(false);
  });
});

describe('measureThemeFidelity on the real Rin and Seri Cats+Dogs build', () => {
  const nonland = cards(FX.deck);
  const f = measureThemeFidelity(nonland, PAGES)!;

  it('measures the shipped nonland deck', () => {
    expect(f.nonland).toBe(64);
    // The live panel dump (main b2401e0d) read 55 on-theme: 47 Cats, 8 Dogs.
    expect(f.onTheme).toBe(55);
    expect(f.themes).toEqual([
      { name: 'Cats', cards: 47 },
      { name: 'Dogs', cards: 8 },
    ]);
    expect(f.share).toBeCloseTo(55 / 64, 5);
  });

  it('puts the themes average decks at about the same share', () => {
    expect(f.averageShare).toBeGreaterThan(0.85);
    expect(f.averageShare).toBeLessThan(0.92);
  });

  it('is quiet on the real build', () => {
    expect(themeDilution(f)).toBeUndefined();
  });

  it('fires on the same deck with its on-theme cards swapped for staples', () => {
    const d = measureThemeFidelity(dilute(40), PAGES)!;
    expect(d.share).toBeLessThan(f.share - THEME_SHARE_MARGIN);
    expect(themeDilution(d)).toMatch(/of \d+ nonland cards \(\d+%\) are on Cats \+ Dogs/);
  });

  it('reports no verdict without every theme average deck', () => {
    const f2 = measureThemeFidelity(nonland, [page('Cats'), page('Dogs', false)])!;
    expect(f2.averageShare).toBeUndefined();
    expect(themeDilution(f2)).toBeUndefined();
  });

  it('measures nothing without themes or cards', () => {
    expect(measureThemeFidelity(nonland, [])).toBeUndefined();
    expect(measureThemeFidelity([], PAGES)).toBeUndefined();
  });
});

describe('describeThemeFidelity', () => {
  it('names the cards each theme accounts for, in pick order, and the rest', () => {
    const f = measureThemeFidelity(cards(FX.deck), PAGES)!;
    expect(describeThemeFidelity(f)).toBe(
      'Cats theme: 47 cards. Dogs theme: 8 cards. The other 9 cards are not tied to a theme.'
    );
  });

  it('follows the pick order when the themes are swapped', () => {
    const f = measureThemeFidelity(cards(FX.deck), [PAGES[1], PAGES[0]])!;
    expect(describeThemeFidelity(f)).toMatch(/^Dogs theme: \d+ cards\. Cats theme: \d+ cards\./);
  });

  it('is singular for one card', () => {
    expect(
      describeThemeFidelity({
        nonland: 2,
        onTheme: 1,
        share: 0.5,
        themes: [{ name: 'Cats', cards: 1 }],
      })
    ).toBe('Cats theme: 1 card. The other card is not tied to a theme.');
  });
});

describe('the theme-fidelity invariant', () => {
  const asDeck = (spells: ThemeCard[], extra: Partial<GeneratedDeck> = {}) => {
    const cats = cleanCategories();
    for (const k of Object.keys(cats) as Array<keyof typeof cats>) cats[k] = [];
    cats.creatures = spells as ScryfallCard[];
    return assemble(cats, { dataSource: 'theme', ...extra });
  };
  const fidelity = (deck: GeneratedDeck) =>
    checkDeckInvariants(deck, context({ themePages: PAGES })).filter(
      (x) => x.check === 'theme-fidelity'
    );

  it('is quiet on the real build', () => {
    expect(fidelity(asDeck(cards(FX.deck)))).toEqual([]);
  });

  it('flags a diluted themed build as SOFT, with the numbers', () => {
    const v = fidelity(asDeck(dilute(40)));
    expect(v).toHaveLength(1);
    expect(v[0].level).toBe('SOFT');
    expect(v[0].detail).toMatch(/theme average deck is 88%/);
  });

  it('does not judge a deck that fell back to the base page', () => {
    expect(fidelity(asDeck(dilute(40), { dataSource: 'base' }))).toEqual([]);
  });

  it('does not run without theme pages', () => {
    const v = checkDeckInvariants(asDeck(dilute(40)), context());
    expect(v.some((x) => x.check === 'theme-fidelity')).toBe(false);
  });
});

describe('the build report carries the per-theme line', () => {
  it('writes the line from the measure the generator stored', () => {
    const report = assembleBuildReport({
      generated: {
        ...assemble(cleanCategories()),
        themeFidelity: measureThemeFidelity(cards(FX.deck), PAGES),
      },
      customization: customization(),
      collectionNames: new Set(),
    });
    expect(report.themeFidelityNote).toBe(
      'Cats theme: 47 cards. Dogs theme: 8 cards. The other 9 cards are not tied to a theme.'
    );
  });

  it('writes no line for an unthemed deck', () => {
    const report = assembleBuildReport({
      generated: assemble(cleanCategories()),
      customization: customization(),
      collectionNames: new Set(),
    });
    expect(report.themeFidelityNote).toBeUndefined();
  });
});
