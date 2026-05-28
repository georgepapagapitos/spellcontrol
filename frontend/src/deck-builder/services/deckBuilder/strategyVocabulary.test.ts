import { describe, it, expect } from 'vitest';
import { Archetype } from '@/deck-builder/types';
import { THEME_TO_ARCHETYPE, ARCHETYPE_LABEL } from './strategyVocabulary';

// Verbatim snapshot of the theme→archetype map as it existed when it lived
// inline in roleTargets.ts. Guards against accidental edits that would silently
// shift role targeting for a theme.
const EXPECTED_THEME_TO_ARCHETYPE: Record<string, Archetype> = {
  aggro: Archetype.AGGRO,
  combat: Archetype.AGGRO,
  'extra combat': Archetype.AGGRO,
  infect: Archetype.AGGRO,
  poison: Archetype.AGGRO,
  control: Archetype.CONTROL,
  stax: Archetype.CONTROL,
  pillowfort: Archetype.CONTROL,
  combo: Archetype.COMBO,
  'extra turns': Archetype.COMBO,
  voltron: Archetype.VOLTRON,
  equipment: Archetype.VOLTRON,
  auras: Archetype.VOLTRON,
  spellslinger: Archetype.SPELLSLINGER,
  cantrips: Archetype.SPELLSLINGER,
  tokens: Archetype.TOKENS,
  'go wide': Archetype.TOKENS,
  aristocrats: Archetype.ARISTOCRATS,
  sacrifice: Archetype.ARISTOCRATS,
  lifedrain: Archetype.ARISTOCRATS,
  reanimator: Archetype.REANIMATOR,
  graveyard: Archetype.REANIMATOR,
  mill: Archetype.REANIMATOR,
  dredge: Archetype.REANIMATOR,
  flashback: Archetype.REANIMATOR,
  landfall: Archetype.LANDFALL,
  lands: Archetype.LANDFALL,
  artifacts: Archetype.ARTIFACTS,
  treasures: Archetype.ARTIFACTS,
  vehicles: Archetype.ARTIFACTS,
  clues: Archetype.ARTIFACTS,
  food: Archetype.ARTIFACTS,
  enchantress: Archetype.ENCHANTRESS,
  enchantments: Archetype.ENCHANTRESS,
  constellation: Archetype.ENCHANTRESS,
  storm: Archetype.STORM,
  tribal: Archetype.TRIBAL,
  elves: Archetype.TRIBAL,
  goblins: Archetype.TRIBAL,
  zombies: Archetype.TRIBAL,
  vampires: Archetype.TRIBAL,
  dragons: Archetype.TRIBAL,
  angels: Archetype.TRIBAL,
  demons: Archetype.TRIBAL,
  wizards: Archetype.TRIBAL,
  warriors: Archetype.TRIBAL,
  rogues: Archetype.TRIBAL,
  clerics: Archetype.TRIBAL,
  soldiers: Archetype.TRIBAL,
  knights: Archetype.TRIBAL,
  merfolk: Archetype.TRIBAL,
  spirits: Archetype.TRIBAL,
  dinosaurs: Archetype.TRIBAL,
  pirates: Archetype.TRIBAL,
  cats: Archetype.TRIBAL,
  dogs: Archetype.TRIBAL,
  beasts: Archetype.TRIBAL,
  elementals: Archetype.TRIBAL,
  slivers: Archetype.TRIBAL,
  allies: Archetype.TRIBAL,
  humans: Archetype.TRIBAL,
  '+1/+1 counters': Archetype.MIDRANGE,
  '-1/-1 counters': Archetype.MIDRANGE,
  counters: Archetype.MIDRANGE,
  proliferate: Archetype.MIDRANGE,
  blink: Archetype.MIDRANGE,
  flicker: Archetype.MIDRANGE,
  etb: Archetype.MIDRANGE,
  clones: Archetype.MIDRANGE,
  copy: Archetype.MIDRANGE,
  lifegain: Archetype.MIDRANGE,
  energy: Archetype.MIDRANGE,
  cascade: Archetype.MIDRANGE,
  monarch: Archetype.MIDRANGE,
  superfriends: Archetype.GOODSTUFF,
  planeswalkers: Archetype.GOODSTUFF,
  chaos: Archetype.GOODSTUFF,
  politics: Archetype.GOODSTUFF,
  wheels: Archetype.GOODSTUFF,
  discard: Archetype.GOODSTUFF,
  tutors: Archetype.GOODSTUFF,
};

describe('strategyVocabulary', () => {
  it('keeps the theme→archetype map stable', () => {
    expect(THEME_TO_ARCHETYPE).toEqual(EXPECTED_THEME_TO_ARCHETYPE);
  });

  it('uses lowercased theme keys (the lookup contract everywhere)', () => {
    for (const key of Object.keys(THEME_TO_ARCHETYPE)) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it('has a display label for every archetype', () => {
    for (const arch of Object.values(Archetype)) {
      expect(ARCHETYPE_LABEL[arch]).toBeTruthy();
    }
  });
});
