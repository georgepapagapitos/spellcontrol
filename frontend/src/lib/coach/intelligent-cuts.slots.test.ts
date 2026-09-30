// Guard (T171 lane M): the replace-when-full prompt's cut shares the incoming
// card's slot, never takes a premium card or a combo piece, never opens a role
// gap, and never trades a card for one played less here. Lane L's harness
// found 148 of 196 applied cuts came straight off the optimizer's flag list
// whatever was coming in (16 land-for-spell, 26 spell-for-land), and premium
// cards among them. Real cards (Scryfall 2026-09-29) with the pinned tagger
// fixture for roles.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScryfallCard } from '@/deck-builder/types';
import type { OptimizeCard } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { COACH_CARDS } from '@/deck-builder/services/deckBuilder/__fixtures__/coach-cards.fixtures';
import type { ComboMatch } from '@/types/combos';
import { rankReplacementCuts, type CutCandidate } from './intelligent-cuts';

const here = dirname(fileURLToPath(import.meta.url));
const real = (name: string): ScryfallCard => ({ ...COACH_CARDS[name] });
const slots = (names: string[]): CutCandidate[] =>
  names.map((name, i) => ({ slotId: `s${i}`, card: real(name) }));
const flag = (name: string, reason: string, inclusion: number | null = 5): OptimizeCard => ({
  name,
  reason,
  reasonCategory: 'low-inclusion',
  inclusion,
});
const cutNames = (cuts: { card: ScryfallCard }[]) => cuts.map((c) => c.card.name);

beforeAll(async () => {
  const data = JSON.parse(
    readFileSync(
      resolve(
        here,
        '../../deck-builder/services/deckBuilder/__fixtures__/tagger-tags.fixture.json'
      ),
      'utf8'
    )
  );
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => data }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
});
afterAll(() => vi.unstubAllGlobals());

describe('rankReplacementCuts — slot type', () => {
  it('makes room for a land with a land: never the flagged spell, never a utility land', () => {
    const deck = slots([
      'Aetherjacket',
      'Evolving Wilds',
      'Forest',
      'Forest',
      'Swamp',
      'Yavimaya, Cradle of Growth',
      'Command Tower',
    ]);
    const cuts = rankReplacementCuts({
      addCard: real('Overgrown Tomb'),
      deckCards: deck,
      analysis: { optimizeSwaps: { removals: [flag('Aetherjacket', 'Low inclusion')] } },
    });
    // The weakest land first: a land that only fetches a basic, then the
    // most duplicated basic; Command Tower, the best fixer here, last.
    expect(cutNames(cuts)).toEqual(['Evolving Wilds', 'Forest', 'Swamp', 'Command Tower']);
    expect(cuts[1].reason).toBe('One of 2 Forests');
  });

  it('makes room for a spell with a spell, even when a tapland is the flagged cut', () => {
    const cuts = rankReplacementCuts({
      addCard: real('Doom Blade'),
      deckCards: slots(['Jungle Hollow', 'Aetherjacket', 'Forest']),
      analysis: {
        optimizeSwaps: {
          removals: [flag('Jungle Hollow', 'Tapland'), flag('Aetherjacket', 'Low inclusion')],
        },
      },
    });
    expect(cutNames(cuts)).toEqual(['Aetherjacket']);
  });
});

describe('rankReplacementCuts — protected cards', () => {
  it('never offers a premium card, even one the optimizer flagged "Excess Removal"', () => {
    const cuts = rankReplacementCuts({
      addCard: real('Murder'),
      deckCards: slots(['Path to Exile', 'Fierce Guardianship', 'Aetherjacket']),
      analysis: {
        optimizeSwaps: {
          removals: [
            flag('Path to Exile', 'Excess Removal', 12),
            flag('Fierce Guardianship', 'Low inclusion', 14),
            flag('Aetherjacket', 'Excess Removal', 3),
          ],
        },
      },
    });
    expect(cutNames(cuts)).toEqual(['Aetherjacket']);
  });

  it('never takes a piece of a combo the deck has', () => {
    const combo = {
      combo: { cards: [{ oracleId: 'a', cardName: 'Basalt Monolith', quantity: 1 }] },
    } as unknown as ComboMatch;
    const cuts = rankReplacementCuts({
      addCard: real('Mind Stone'),
      deckCards: slots(['Basalt Monolith', 'Aetherjacket']),
      analysis: {
        optimizeSwaps: {
          removals: [flag('Basalt Monolith', 'Excess Ramp'), flag('Aetherjacket', 'Low inclusion')],
        },
      },
      inDeckCombos: [combo],
    });
    expect(cutNames(cuts)).toEqual(['Aetherjacket']);
  });
});

describe('rankReplacementCuts — role balance', () => {
  const deck = slots(['Murder', 'Doom Blade', 'Harmonize', 'Aetherjacket']);
  const removals = [flag('Murder', 'Low inclusion', 4), flag('Harmonize', 'Low inclusion', 6)];

  it('an add that fills a short role never trades away another card in that role', () => {
    const cuts = rankReplacementCuts({
      addCard: real('Beast Within'),
      deckCards: deck,
      analysis: { optimizeSwaps: { removals }, roleTargets: { removal: 5, cardDraw: 1 } },
    });
    expect(cutNames(cuts)).not.toContain('Murder');
    expect(cutNames(cuts)).not.toContain('Doom Blade');
  });

  it('a cut never takes a role below its target', () => {
    const cuts = rankReplacementCuts({
      addCard: real('Beast Within'),
      deckCards: deck,
      analysis: { optimizeSwaps: { removals }, roleTargets: { removal: 5, cardDraw: 1 } },
    });
    // Harmonize is the deck's only draw spell against a target of one.
    expect(cutNames(cuts)).not.toContain('Harmonize');
  });

  it('swaps like for like when the role is already met', () => {
    const cuts = rankReplacementCuts({
      addCard: real('Beast Within'),
      deckCards: deck,
      analysis: { optimizeSwaps: { removals }, roleTargets: { removal: 2, cardDraw: 1 } },
    });
    expect(cutNames(cuts)[0]).toBe('Murder');
  });
});

describe('rankReplacementCuts — play rate', () => {
  it('never offers an unflagged card played here more than the card coming in', () => {
    const cuts = rankReplacementCuts({
      addCard: real('Beast Within'),
      deckCards: slots(['Doom Blade', 'Murder']),
      analysis: {
        cardInclusionMap: { 'Doom Blade': 41, Murder: 12 },
        gapAnalysis: [{ name: 'Beast Within', inclusion: 30 }],
      },
    });
    expect(cutNames(cuts)).toEqual(['Murder']);
  });

  it('falls back to the least-played card when nothing is flagged or related', () => {
    const cuts = rankReplacementCuts({
      addCard: real('Harmonize'),
      deckCards: slots(['Aetherjacket', 'Crib Swap']),
      analysis: {
        cardInclusionMap: { 'Crib Swap': 9 },
        gapAnalysis: [{ name: 'Harmonize', inclusion: 35 }],
      },
    });
    expect(cutNames(cuts)).toEqual(['Aetherjacket', 'Crib Swap']);
    expect(cuts[0].reason).toBe("Not played in this commander's decks");
    expect(cuts[1].reason).toBe('Played in 9% of decklists');
  });
});
