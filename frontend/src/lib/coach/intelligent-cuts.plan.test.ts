// Guard (T171 round 3, v4 gate): what the deck wins with and what it is
// built on stay out of the replace prompt, and a combo completion gets a cut
// from any role, under every protection the other cut paths keep (v4b).
//  - Starfield of Nyx (Sythis's enchantment-animation finisher) went as
//    "Overlapping Enchantress" for Resurgent Belief, a one-shot recursion
//    spell. A finisher or alt-win card is never an overlap cut.
//  - A Bracket 4 Yuriko's Demonic Consultation, the missing Thassa's Oracle
//    piece, had no cut at all: a combo completion isn't an in-role upgrade.
//  - v4b then gave every combo a cut past the protections: Yuriko lost Lotus
//    Petal and Dimir Signet (ramp 9/9 to 7/9), Krenko its only wipe
//    (Vandalblast), and Akroma's Memorial counted as a completer for a Krenko
//    line the deck already assembled.
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
import { fromComboCompletion } from './deck-change';

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

describe('rankReplacementCuts — a combo completion and its cut', () => {
  // A Yuriko deck: ramp at its target, Brainstorm a 60% staple, Thassa's
  // Oracle the finisher, Diregraf Colossus the spare.
  const yuriko = [
    'Lotus Petal',
    'Dimir Signet',
    'Brainstorm',
    "Thassa's Oracle",
    'Diregraf Colossus',
  ];
  const analysis = {
    commander: real("Yuriko, the Tiger's Shadow"),
    roleTargets: { ramp: 2 },
    cardInclusionMap: { 'Lotus Petal': 30, 'Dimir Signet': 25, Brainstorm: 60 },
  };
  const comboCuts = (names: string[], extra = {}) =>
    cutNames(
      rankReplacementCuts({
        addCard: real('Demonic Consultation'),
        deckCards: slots(names),
        analysis: { ...analysis, ...extra },
        completesCombo: true,
      })
    );

  it('takes the least valuable unprotected card, where an ordinary add gets none', () => {
    setCardFactsSnapshot(coachCardFactsSnapshot());
    const plain = rankReplacementCuts({
      addCard: real('Demonic Consultation'),
      deckCards: slots(yuriko),
      analysis,
    });
    expect(comboCuts(yuriko)).toEqual(['Diregraf Colossus']);
    expect(cutNames(plain)).not.toContain('Diregraf Colossus');
  });

  it('never takes a role below its target: no spare means no cut (Lotus Petal, Dimir Signet)', () => {
    setCardFactsSnapshot(coachCardFactsSnapshot());
    const noSpare = yuriko.filter((n) => n !== 'Diregraf Colossus');
    expect(comboCuts(noSpare)).toEqual([]);
    // Ramp over its target frees the least played rock first, never the staple.
    const over = comboCuts(noSpare, { roleTargets: { ramp: 1 } });
    expect(over[0]).toBe('Dimir Signet');
    expect(over).not.toContain('Brainstorm');
  });

  it("never takes a deck's only wipe (Krenko's Vandalblast)", () => {
    setCardFactsSnapshot(coachCardFactsSnapshot());
    const cuts = rankReplacementCuts({
      addCard: real("Akroma's Memorial"),
      deckCards: slots(['Vandalblast', 'Goblin Matron', 'Seething Song']),
      analysis: {
        commander: real('Krenko, Mob Boss'),
        roleTargets: { boardwipe: 1, ramp: 1 },
        cardInclusionMap: { Vandalblast: 22, 'Seething Song': 18 },
      },
      completesCombo: true,
    });
    expect(cutNames(cuts)).not.toContain('Vandalblast');
    expect(cutNames(cuts)).not.toContain('Seething Song');
  });

  it('never takes a card Coach would suggest straight back', () => {
    setCardFactsSnapshot(coachCardFactsSnapshot());
    // Diregraf Colossus at 34% sits above the least-played missing staple (30%).
    const cuts = comboCuts(yuriko, {
      cardInclusionMap: { ...analysis.cardInclusionMap, 'Diregraf Colossus': 34 },
      gapAnalysis: [{ name: 'Mystic Remora', inclusion: 30 }],
    });
    expect(cuts).toEqual([]);
  });

  it('ranks by the build relevancy (play rate and synergy) where it has one', () => {
    setCardFactsSnapshot(coachCardFactsSnapshot());
    const spares = [...yuriko, 'Aetherjacket'];
    const cuts = comboCuts(spares, {
      cardRelevancyMap: { 'Diregraf Colossus': 40, Aetherjacket: 12 },
    });
    expect(cuts[0]).toBe('Aetherjacket');
  });
});

describe('replaceCuts — only a combo the add newly completes counts', () => {
  const combo = (id: string, pieces: string[], missing: string, produces: string[]) =>
    ({
      combo: {
        id,
        produces,
        popularity: 900,
        cards: pieces.map((p) => ({ oracleId: p, cardName: p, quantity: 1 })),
      },
      presentOracleIds: pieces.filter((p) => p !== missing),
      missingOracleIds: [missing],
    }) as unknown as ComboMatch;
  const produces = ['Infinite creature LTB', 'Infinite creature ETB'];
  // Krenko already assembles the Skirk Prospector line through Goblin Warchief.
  const assembled = combo(
    'warchief',
    ['Krenko, Mob Boss', 'Skirk Prospector', 'Goblin Warchief'],
    '',
    produces
  );
  const memorial = combo(
    'memorial',
    ['Krenko, Mob Boss', 'Skirk Prospector', "Akroma's Memorial"],
    "Akroma's Memorial",
    produces
  );
  const deckCards = slots(['Skirk Prospector', 'Goblin Warchief', 'Diregraf Colossus']);
  const analysis = {
    commander: real('Krenko, Mob Boss'),
    roleTargets: {},
    cardInclusionMap: { 'Skirk Prospector': 30, 'Goblin Warchief': 45 },
  };

  it("doesn't read Akroma's Memorial as a completer when the deck already assembles the line", () => {
    setCardFactsSnapshot(coachCardFactsSnapshot());
    const row = fromComboCompletion(memorial, "Akroma's Memorial", 'unowned');
    const already = replaceCuts({
      deckCards,
      analysis,
      full: true,
      inDeckCombos: [assembled],
      oneAwayCombos: [memorial],
    });
    // An ordinary add: no unflagged card is played less than an off-page add.
    expect(already.cutsFor(real("Akroma's Memorial"))).toEqual([]);
    expect(already.hasCut(row)).toBe(false);

    // The same add finishing a line the deck doesn't have keeps its rank.
    const fresh = replaceCuts({ deckCards, analysis, full: true, oneAwayCombos: [memorial] });
    expect(fresh.hasCut(row)).toBe(true);
    expect(cutNames(fresh.cutsFor(real("Akroma's Memorial")))).toEqual(['Diregraf Colossus']);
  });
});
