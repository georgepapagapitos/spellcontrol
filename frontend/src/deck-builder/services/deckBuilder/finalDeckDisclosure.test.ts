import { describe, it, expect } from 'vitest';
import {
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
