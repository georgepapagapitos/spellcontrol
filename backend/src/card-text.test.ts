import { describe, expect, it } from 'vitest';
import { cardFaceText } from './card-text';
import { oracleEntry } from './routes/ai';
import {
  AGADEEM_MDFC,
  BONECRUSHER_ADVENTURE,
  DELVER_TRANSFORM,
  FIRE_ICE_SPLIT,
} from './multiface-cards.fixture';

describe('cardFaceText', () => {
  it('joins every face unlabeled for the search index', () => {
    const t = cardFaceText(DELVER_TRANSFORM);
    expect(t.oracleText).toContain('look at the top card of your library');
    expect(t.oracleText).toContain('Flying');
    expect(t.oracleText).not.toContain('Insectile Aberration:');
    expect(t.typeLine).toBe('Creature — Human Wizard // Creature — Human Insect');
  });

  it('keeps a top-level mana cost and falls back to the faces when it is absent', () => {
    expect(cardFaceText(BONECRUSHER_ADVENTURE).manaCost).toBe('{2}{R} // {1}{R}');
    expect(cardFaceText(DELVER_TRANSFORM).manaCost).toBe('{U}');
    expect(cardFaceText(AGADEEM_MDFC).manaCost).toBe('{X}{B}{B}{B}');
  });

  it('prefers a single-faced card’s own text', () => {
    const t = cardFaceText({ type_line: 'Artifact', oracle_text: 'Tap: add two.' });
    expect(t).toEqual({ manaCost: '', typeLine: 'Artifact', oracleText: 'Tap: add two.' });
  });
});

// The model reads these through the Card reference. Scryfall leaves the top
// level of each empty, so before E1023 every one reached the prompt as a bare name.
describe('oracleEntry (the AI Card reference)', () => {
  it('carries both faces of a transform card, named', () => {
    const e = oracleEntry(DELVER_TRANSFORM);
    expect(e.oracleText).toMatch(/^Delver of Secrets: At the beginning of your upkeep/);
    expect(e.oracleText).toContain('\n//\nInsectile Aberration: Flying');
    expect(e.manaCost).toBe('{U}');
  });

  it('carries both faces of a modal DFC land', () => {
    const e = oracleEntry(AGADEEM_MDFC);
    expect(e.typeLine).toBe('Sorcery // Land');
    expect(e.oracleText).toContain("Agadeem's Awakening: Return from your graveyard");
    expect(e.oracleText).toContain(
      'Agadeem, the Undercrypt: As this land enters, you may pay 3 life'
    );
  });

  it('carries the adventure half of an adventure card', () => {
    const e = oracleEntry(BONECRUSHER_ADVENTURE);
    expect(e.oracleText).toContain('Bonecrusher Giant: Whenever this creature becomes the target');
    expect(e.oracleText).toContain("Stomp: Damage can't be prevented this turn.");
  });

  it('carries both halves of a split card', () => {
    const e = oracleEntry(FIRE_ICE_SPLIT);
    expect(e.oracleText).toContain('Fire: Fire deals 2 damage divided');
    expect(e.oracleText).toContain('Ice: Tap target permanent.');
  });
});
