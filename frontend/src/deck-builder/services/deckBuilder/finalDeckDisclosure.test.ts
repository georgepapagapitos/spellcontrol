import { describe, it, expect } from 'vitest';
import {
  buildUnownedLeftOutNote,
  finalDeckMembership,
  gapsOutsideDeck,
  survivingSubstitutionRows,
} from './finalDeckDisclosure';

// The live collection panel's own cases (main, 2026-09-29).
const LATHRIL_FINAL = [
  'Elvish Archdruid',
  'Rishkar, Peema Renegade',
  'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki',
];

describe('disclosures against the final deck', () => {
  const inDeck = finalDeckMembership(LATHRIL_FINAL);

  it('knows a double-faced card by its front face too', () => {
    expect(inDeck('Fable of the Mirror-Breaker')).toBe(true);
    expect(inDeck('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki')).toBe(true);
    expect(inDeck('Reflection of Kiki-Jiki')).toBe(false);
  });

  it('drops a gap the deck already fills', () => {
    const gaps = [{ name: 'Elvish Archdruid' }, { name: "Assassin's Trophy" }];
    expect(gapsOutsideDeck(gaps, inDeck)).toEqual([{ name: "Assassin's Trophy" }]);
    expect(gapsOutsideDeck(undefined, inDeck)).toBeUndefined();
  });

  it('drops "Wanted X, used your Y" once X shipped too, or Y was cut', () => {
    const rows = [
      // Lathril partial100: a later swap seated Elvish Archdruid after all.
      { wantedName: 'Elvish Archdruid', usedName: 'Rishkar, Peema Renegade' },
      { wantedName: 'Priest of Titania', usedName: 'Rishkar, Peema Renegade' },
      { wantedName: 'Priest of Titania', usedName: 'Llanowar Tribe' },
    ];
    expect(survivingSubstitutionRows(rows, inDeck)).toEqual([rows[1]]);
  });
});

// E576: the gap list of the user's Rin and Seri Cats+Dogs build (live, main
// b2401e0d), in gap-list order, which is not inclusion order.
const RIN_AND_SERI_GAPS = [
  { name: 'Jetmir, Nexus of Revels', inclusion: 80.0, isOwned: false },
  { name: 'Spirited Companion', inclusion: 71.2, isOwned: false },
  { name: 'Mirri, Weatherlight Duelist', inclusion: 67.2, isOwned: false },
  { name: 'Marisi, Breaker of the Coil', inclusion: 63.1, isOwned: false },
  { name: 'Brimaz, King of Oreskos', inclusion: 59.8, isOwned: false },
  { name: 'Realmwalker', inclusion: 55.8, isOwned: false },
  { name: 'Qasali Slingers', inclusion: 62.3, isOwned: false },
  { name: 'Ajani, Nacatl Pariah', inclusion: 47.6, isOwned: true },
  { name: 'Prowling Serpopard', inclusion: 43.5, isOwned: false },
  { name: 'Pride of the Road', inclusion: 21.0, isOwned: false },
];

describe('buildUnownedLeftOutNote (E576)', () => {
  it('names the most-played unowned staples, then counts the rest', () => {
    expect(buildUnownedLeftOutNote(RIN_AND_SERI_GAPS, 'full')).toBe(
      "Left out because you don't own them: Jetmir, Nexus of Revels (80%), Spirited Companion (71%), Mirri, Weatherlight Duelist (67%), Marisi, Breaker of the Coil (63%), Qasali Slingers (62%), and 3 more played in 40%+ of decks."
    );
  });

  it("says 'no free copy' for an Available build", () => {
    expect(buildUnownedLeftOutNote(RIN_AND_SERI_GAPS.slice(0, 1), 'available')).toBe(
      'Left out because you have no free copy: Jetmir, Nexus of Revels (80%).'
    );
  });

  it('names a lone staple in the singular, and nothing below 40%', () => {
    expect(buildUnownedLeftOutNote(RIN_AND_SERI_GAPS.slice(7), 'full')).toBe(
      "Left out because you don't own it: Prowling Serpopard (44%)."
    );
    expect(buildUnownedLeftOutNote(RIN_AND_SERI_GAPS.slice(9), 'full')).toBeUndefined();
    expect(buildUnownedLeftOutNote(undefined, 'full')).toBeUndefined();
  });
});
