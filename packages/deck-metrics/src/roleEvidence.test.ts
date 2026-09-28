import { describe, it, expect } from 'vitest';
import { checkRoleEvidence } from './roleEvidence';

describe('checkRoleEvidence', () => {
  it('confirms a role whose oracle text matches its evidence pattern', () => {
    expect(checkRoleEvidence('removal', 'Destroy target creature.')).toBe('removal');
  });

  it('drops a role the oracle text does not corroborate', () => {
    expect(checkRoleEvidence('removal', 'Vigilance.')).toBeNull();
  });

  it('trusts the tag when there is no oracle text to check', () => {
    expect(checkRoleEvidence('ramp', '')).toBe('ramp');
    expect(checkRoleEvidence('ramp', '   ')).toBe('ramp');
  });

  it('checks each role against its own pattern, not a shared one', () => {
    expect(checkRoleEvidence('ramp', 'Add {G}.')).toBe('ramp');
    expect(checkRoleEvidence('cardDraw', 'Add {G}.')).toBeNull();
    expect(checkRoleEvidence('boardwipe', 'Destroy all creatures.')).toBe('boardwipe');
    expect(checkRoleEvidence('cardDraw', 'Draw a card.')).toBe('cardDraw');
  });
});

// Verbatim Scryfall oracle text (2026-09-28): the patterns are regexes, so a
// hand-written line proves nothing.
describe('checkRoleEvidence: scoped counters (E486) and graveyard-to-hand (E487)', () => {
  it.each([
    ['Negate', 'Counter target noncreature spell.'],
    [
      'Swan Song',
      'Counter target enchantment, instant, or sorcery spell. Its controller creates a 2/2 blue Bird creature token with flying.',
    ],
    [
      'Stifle',
      "Counter target activated or triggered ability. (Mana abilities can't be targeted.)",
    ],
    ['Summary Dismissal', 'Exile all other spells and counter all abilities.'],
  ])('%s is removal evidence', (_name, text) => {
    expect(checkRoleEvidence('removal', text)).toBe('removal');
  });

  it('a counter-placing effect is not a counterspell', () => {
    expect(checkRoleEvidence('removal', 'Put a +1/+1 counter on target creature.')).toBeNull();
  });

  it('Deadbridge Chant moves a graveyard card to hand a sentence later', () => {
    const text =
      "When this enchantment enters, mill ten cards.\nAt the beginning of your upkeep, choose a card at random in your graveyard. If it's a creature card, put it onto the battlefield. Otherwise, put it into your hand.";
    expect(checkRoleEvidence('cardDraw', text)).toBe('cardDraw');
  });

  it('bouncing your own permanent is not graveyard card advantage', () => {
    expect(
      checkRoleEvidence('cardDraw', "Return target land you control to its owner's hand.")
    ).toBeNull();
  });
});
