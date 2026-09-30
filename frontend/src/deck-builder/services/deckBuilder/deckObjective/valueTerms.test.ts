// @vitest-environment node
//
// The value the first optimizer gate showed the objective missed, over real
// cards: tutors at what they find, land-slot answers, a "choose one or more"
// wipe's full reach, and repeating card draw.
import { describe, expect, it } from 'vitest';
import { readTutors, tutorFilter, tutorFinds, tutorsTerm, TUTOR_SCALE } from './terms/tutors';
import { enginesTerm } from './terms/engines';
import { answerValue, interactionTerm } from './terms/interaction';
import { BASELINE, FIX, MEREN, card, cards, merenCtx } from './__fixtures__/objectiveFixture';

const ctx = merenCtx({ combos: [...FIX.meren.combos, FIX.hermitDruidCombo] });
const withCards = (...names: string[]) => ({
  commanders: [MEREN],
  cards: [...BASELINE.cards.slice(0, 90), ...cards(...names)],
});

describe('tutors: what they can find in this deck', () => {
  it('reads what a tutor finds from its text', () => {
    const worldly = tutorFilter(card('Worldly Tutor'))!;
    expect(worldly).toMatchObject({ types: ['creature'], to: 'top' });
    const enlightened = tutorFilter(card('Enlightened Tutor'))!;
    expect(tutorFinds(enlightened, card('Skullclamp'))).toBe(true);
    expect(tutorFinds(enlightened, card('Hermit Druid'))).toBe(false);
    const natural = tutorFilter(card('Natural Order'))!;
    expect(natural).toMatchObject({ colours: ['G'], to: 'battlefield' });
    expect(tutorFinds(natural, card('Craterhoof Behemoth'))).toBe(true);
    expect(tutorFinds(natural, card('Mikaeus, the Unhallowed'))).toBe(false);
    // Crop Rotation, filed as land ramp, is the land tutor that finds Gaea's Cradle.
    expect(tutorFinds(tutorFilter(card('Crop Rotation'))!, card("Gaea's Cradle"))).toBe(true);
    // A search by basic land type is ramp.
    expect(tutorFilter(card("Nature's Lore"))).toBeNull();
  });

  it('values a tutor at the best thing it finds: a combo piece above anything else', () => {
    // Only the Hermit Druid line counts here, so it is the one to find.
    const one = merenCtx({ combos: [FIX.hermitDruidCombo] });
    const v = tutorsTerm(withCards('Worldly Tutor', 'Hermit Druid', "Thassa's Oracle"), one);
    const worldly = v.cards.find((c) => c.name === 'Worldly Tutor')!;
    expect(worldly.note).toMatch(/finds Hermit Druid, a piece of Hermit Druid \+ Thassa's Oracle/);
    // Before the rank decay, worth more than the inclusion gap a free search
    // traded tutors on (~0.2 of a card).
    const read = readTutors(withCards('Worldly Tutor', 'Hermit Druid', "Thassa's Oracle"), one);
    const own = read.find((t) => t.name === 'Worldly Tutor')!;
    expect(TUTOR_SCALE * own.v).toBeGreaterThan(0.4);
    expect(worldly.value).toBeLessThanOrEqual(TUTOR_SCALE);
    // Break the line and the same tutor is worth what its best creature is.
    const broken = tutorsTerm(withCards('Worldly Tutor', 'Hermit Druid'), one);
    expect(broken.cards.find((c) => c.name === 'Worldly Tutor')!.value).toBeLessThan(worldly.value);
  });
});

describe('answers and engines the gate saw traded away', () => {
  it("counts a land's answer: Boseiju is removal in a land slot", () => {
    const deck = withCards('Boseiju, Who Endures');
    const v = interactionTerm(deck, ctx);
    expect(v.cards.find((c) => c.name === 'Boseiju, Who Endures')?.note).toMatch(/destroy/);
  });

  it('reads "choose one or more" as every mode at once: Farewell answers the whole board', () => {
    const a = answerValue(card('Farewell'), ctx.factsOf(card('Farewell')))!;
    expect(a.fact.hits).toEqual(expect.arrayContaining(['artifact', 'creature', 'enchantment']));
  });

  it('values repeating draw apart from one-shot draw', () => {
    const v = enginesTerm(withCards('The One Ring', 'Sylvan Library', 'Opt'), ctx);
    const names = v.cards.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['The One Ring', 'Sylvan Library']));
    expect(names).not.toContain('Opt');
    // The second engine adds less than the first.
    const [first, second] = v.cards;
    expect(second.value).toBeLessThan(first.value);
  });
});
