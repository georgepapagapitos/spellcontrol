// Guard (T171 round 3, v4 gate): what the deck wins with and what it is
// built on stay out of the replace prompt, and a combo completion always gets
// a cut.
//  - Starfield of Nyx (Sythis's enchantment-animation finisher) went as
//    "Overlapping Enchantress" for Resurgent Belief, a one-shot recursion
//    spell. A finisher or alt-win card is never an overlap cut.
//  - A Bracket 4 Yuriko's Demonic Consultation, the missing Thassa's Oracle
//    piece, had no cut at all: a combo completion isn't an in-role upgrade.
// Real cards (Scryfall 2026-09-29) with the pinned tagger fixture for roles.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { setCardFactsSnapshot } from '@/deck-builder/services/cardFacts';
import {
  COACH_CARDS,
  coachCardFactsSnapshot,
} from '@/deck-builder/services/deckBuilder/__fixtures__/coach-cards.fixtures';
import { rankReplacementCuts, type CutCandidate } from './intelligent-cuts';
import { replaceCuts } from './replace-cuts';

const here = dirname(fileURLToPath(import.meta.url));
const real = (name: string): ScryfallCard => ({ ...COACH_CARDS[name] });
const slots = (names: string[]): CutCandidate[] =>
  names.map((name, i) => ({ slotId: `s${i}`, card: real(name) }));
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
afterEach(() => setCardFactsSnapshot(null));

describe('rankReplacementCuts — finishers are no overlap cut', () => {
  const analysis = {
    cardInclusionMap: { 'Starfield of Nyx': 20 },
    gapAnalysis: [{ name: 'Resurgent Belief', inclusion: 30 }],
  };
  const cutsFor = () =>
    cutNames(
      rankReplacementCuts({
        addCard: real('Resurgent Belief'),
        deckCards: slots(['Starfield of Nyx', 'Aetherjacket']),
        analysis,
      })
    );

  it('keeps an enchantment-animation finisher the card facts read', () => {
    // Without the facts, the two enchantment cards read as an overlap.
    expect(cutsFor()).toContain('Starfield of Nyx');
    setCardFactsSnapshot(coachCardFactsSnapshot());
    expect(cutsFor()).not.toContain('Starfield of Nyx');
  });

  it("keeps a card the deck's win paths name as its alt win", () => {
    const cuts = rankReplacementCuts({
      addCard: real('Resurgent Belief'),
      deckCards: slots(['Starfield of Nyx', 'Aetherjacket']),
      analysis: {
        ...analysis,
        winConditions: {
          primary: {
            category: 'alt-win',
            label: '',
            summary: '',
            evidence: ['Starfield of Nyx'],
            score: 1,
          },
          secondary: [],
        },
      },
    });
    expect(cutNames(cuts)).not.toContain('Starfield of Nyx');
  });
});

describe('rankReplacementCuts — a combo completion always gets a cut', () => {
  // Every role at its target, and the other cards protected: the Isshin
  // payoff (Laelia), a survival piece (Lightning Greaves), a staple rock.
  const deckCards = slots([
    'Laelia, the Blade Reforged',
    'Lightning Greaves',
    'Sol Ring',
    'Rakdos Signet',
    'Murder',
    'Harmonize',
    'Diregraf Colossus',
  ]);
  const analysis = {
    commander: real('Isshin, Two Heavens as One'),
    roleTargets: { ramp: 1, removal: 1, cardDraw: 2 },
    cardInclusionMap: { 'Rakdos Signet': 28, Murder: 20, Harmonize: 15 },
  };

  it('takes the least valuable unprotected card, where an ordinary add gets none', () => {
    setCardFactsSnapshot(coachCardFactsSnapshot());
    const add = real('Demonic Consultation');
    const plain = rankReplacementCuts({ addCard: add, deckCards, analysis });
    const combo = rankReplacementCuts({ addCard: add, deckCards, analysis, completesCombo: true });
    expect(cutNames(combo)[0]).toBe('Diregraf Colossus');
    for (const kept of ['Laelia, the Blade Reforged', 'Lightning Greaves', 'Sol Ring'])
      expect(cutNames(combo)).not.toContain(kept);
    expect(cutNames(plain)).not.toContain('Diregraf Colossus');
  });

  it('still gets a cut when every card left sits at its role target', () => {
    setCardFactsSnapshot(coachCardFactsSnapshot());
    const noSpare = deckCards.filter((d) => d.card.name !== 'Diregraf Colossus');
    const combo = rankReplacementCuts({
      addCard: real('Demonic Consultation'),
      deckCards: noSpare,
      analysis,
      completesCombo: true,
    });
    // The least played of the role cards.
    expect(cutNames(combo)[0]).toBe('Harmonize');
  });

  it('knows a combo completion from the deck one-away combos (replace-cuts.ts)', () => {
    setCardFactsSnapshot(coachCardFactsSnapshot());
    const oracle = {
      combo: {
        id: 'thoracle',
        produces: ['Win the game'],
        popularity: 900,
        cards: [
          { oracleId: 'to', cardName: "Thassa's Oracle", quantity: 1 },
          { oracleId: 'dc', cardName: 'Demonic Consultation', quantity: 1 },
        ],
      },
      presentOracleIds: ['to'],
      missingOracleIds: ['dc'],
    } as unknown as ComboMatch;
    const cuts = replaceCuts({ deckCards, analysis, full: true, oneAwayCombos: [oracle] });
    expect(cutNames(cuts.cutsFor(real('Demonic Consultation')))[0]).toBe('Diregraf Colossus');
  });
});
