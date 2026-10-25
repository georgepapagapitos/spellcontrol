import { describe, expect, it } from 'vitest';
import { simulateAssemblyClock } from './clock';
import { planComboReach, reachTurns, REACH_HORIZON, REACH_TURNS } from './combo-reach';
import { toClockLibrary } from './hand-classify';
import { drawCard } from './__fixtures__/draw-cards';

const combo = (...cardNames: string[]) => ({
  cards: cardNames.map((cardName, i) => ({ oracleId: `o${i}`, cardName, quantity: 1 })),
  templates: null as string[] | null,
});
const none = new Set<string>();

describe('planComboReach', () => {
  const library = ["Thassa's Oracle", 'Demonic Consultation', 'Island'];

  it('times the library pieces of a combo', () => {
    expect(planComboReach(combo("Thassa's Oracle", 'Demonic Consultation'), none, library)).toEqual(
      {
        kind: 'timed',
        option: { names: ["Thassa's Oracle", 'Demonic Consultation'], need: 2 },
      }
    );
  });

  it('leaves the commander out of the pieces to draw, and times the rest', () => {
    const plan = planComboReach(
      combo('Kiki-Jiki, Mirror Breaker', "Thassa's Oracle"),
      new Set(['Kiki-Jiki, Mirror Breaker']),
      library
    );
    expect(plan).toEqual({ kind: 'timed', option: { names: ["Thassa's Oracle"], need: 1 } });
  });

  it('times nothing for a combo of the command zone alone (assembled before the first draw)', () => {
    const zone = new Set(['Tymna the Weaver', 'Thrasios, Triton Hero']);
    expect(
      planComboReach(combo('Tymna the Weaver', 'Thrasios, Triton Hero'), zone, library)
    ).toEqual({
      kind: 'none',
    });
  });

  it('says so for a piece that is not in the 99 (the sideboard) and for a combo with templates', () => {
    expect(planComboReach(combo("Thassa's Oracle", 'Sanguine Bond'), none, library)).toEqual({
      kind: 'untimed',
      reason: 'sideboard',
    });
    expect(
      planComboReach(
        { ...combo("Thassa's Oracle"), templates: ['Instant that untaps a Creature'] },
        none,
        library
      )
    ).toEqual({ kind: 'untimed', reason: 'templates' });
  });

  it('matches a double-faced card named by its front face', () => {
    const plan = planComboReach(combo('Delver of Secrets'), none, [
      'Delver of Secrets // Insectile Aberration',
    ]);
    expect(plan).toEqual({
      kind: 'timed',
      option: { names: ['Delver of Secrets // Insectile Aberration'], need: 1 },
    });
  });
});

describe("reachTurns on a real list: Thassa's Oracle + Demonic Consultation", () => {
  const PIECES = [{ names: ["Thassa's Oracle", 'Demonic Consultation'], need: 2 }];
  const TUTORS = ['Demonic Tutor', 'Vampiric Tutor', 'Mystical Tutor'];
  const deck = (tutors: string[]) => {
    const cards = [
      drawCard("Thassa's Oracle"),
      drawCard('Demonic Consultation'),
      ...tutors.map((t) => drawCard(t)),
    ];
    for (let i = 0; i < 18; i++) cards.push(drawCard('Island'));
    for (let i = 0; i < 18; i++) cards.push(drawCard('Swamp'));
    while (cards.length < 99) cards.push(drawCard('Counterspell'));
    return toClockLibrary(cards);
  };
  const reach = (tutors: string[]) =>
    reachTurns(
      simulateAssemblyClock(deck(tutors), PIECES, {
        iterations: 1000,
        horizon: REACH_HORIZON,
        wildcards: tutors,
        seed: 3,
      })!
    );
  const bare = reach([]);
  const tutored = reach(TUTORS);

  it('reads turns 6, 8 and 10, rising, with intervals around each share', () => {
    for (const r of [bare, tutored]) {
      expect(r.map((t) => t.turn)).toEqual([...REACH_TURNS]);
      expect(r[0].p).toBeLessThanOrEqual(r[1].p);
      expect(r[1].p).toBeLessThanOrEqual(r[2].p);
      for (const t of r) {
        expect(t.lo).toBeLessThanOrEqual(t.p);
        expect(t.hi).toBeGreaterThanOrEqual(t.p);
      }
    }
  });

  it('never beats the draw-only odds: both pieces among the first 7 + t cards, C(97, 5+t) / C(99, 7+t) = (7+t)(6+t) / (99 * 98)', () => {
    // On the draw a game has seen 7 + t cards by turn t. Casting them in color can only lower it.
    for (const t of bare) {
      const bound = ((7 + t.turn) * (6 + t.turn)) / (99 * 98);
      const sigma = Math.sqrt((bound * (1 - bound)) / 1000);
      expect(t.p).toBeLessThanOrEqual(bound + 3 * sigma);
    }
    // And the no-tutor figure is real, not zero: 10 turns find both pieces a couple of games in a hundred.
    expect(bare[2].p).toBeGreaterThan(0.005);
  });

  it('counts tutors as extra outs: three of them at least double the chance by turn 10', () => {
    expect(tutored[2].p).toBeGreaterThan(bare[2].p * 2);
    expect(tutored[2].lo).toBeGreaterThan(bare[2].hi);
  });
});
