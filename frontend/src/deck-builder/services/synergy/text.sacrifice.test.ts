import { describe, expect, it } from 'vitest';
import { parseCard, sacrificeSignals } from './text';

/**
 * Fetchlands vs real sacrifice outlets. Every oracle string here is Scryfall's
 * CURRENT text (verified against the live API 2026-08-10) — the templating
 * matters: fetchlands now read "Sacrifice this land", and `this` is a
 * deliberate member of the outlet regex's determiner list because self-saccing
 * creatures/tokens are genuine aristocrats fodder.
 *
 * Found by running the win-condition detector over real EDHREC average decks:
 * fetch-heavy lists (Kaalia, Sliver Overlord) were getting an "Aristocrats"
 * win condition assembled out of four fetchlands, which also drove the
 * assembly clock to turn 60 / turn 46.
 */
const oracle = (name: string, typeLine: string, text: string) =>
  parseCard({ name, type_line: typeLine, oracle_text: text } as never).oracle;

describe('sacrificeSignals — fetchlands are not sacrifice outlets', () => {
  it.each([
    [
      'Arid Mesa',
      '{T}, Pay 1 life, Sacrifice this land: Search your library for a Mountain or Plains card, put it onto the battlefield, then shuffle.',
    ],
    [
      'Evolving Wilds',
      '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
    ],
    [
      'Marsh Flats',
      '{T}, Pay 1 life, Sacrifice this land: Search your library for a Plains or Swamp card, put it onto the battlefield, then shuffle.',
    ],
  ])('%s is not an outlet', (name, text) => {
    expect(sacrificeSignals(oracle(name, 'Land', text)).outlet).toBe(false);
  });

  it('still counts a land that eats OTHER creatures (High Market)', () => {
    const text = '{T}: Add {C}.\n{T}, Sacrifice a creature: You gain 1 life.';
    expect(sacrificeSignals(oracle('High Market', 'Land', text)).outlet).toBe(true);
  });

  it('still counts Phyrexian Tower', () => {
    const text = '{T}: Add {C}.\n{T}, Sacrifice a creature: Add {B}{B}.';
    expect(sacrificeSignals(oracle('Phyrexian Tower', 'Land', text)).outlet).toBe(true);
  });

  it('still counts a self-saccing creature as fodder', () => {
    // "this creature" self-sac stays an outlet — that IS aristocrats fodder,
    // which is why the exclusion is scoped to lands only.
    const text = 'Sacrifice this creature: Add one mana of any color.';
    expect(sacrificeSignals(oracle('Birds', 'Creature — Bird', text)).outlet).toBe(true);
  });

  it('still counts a true land-sacrifice outlet that eats other lands', () => {
    // Zuran Orb eats "a land", not itself — unaffected by the exclusion.
    const text = 'Sacrifice a land: You gain 2 life.';
    expect(sacrificeSignals(oracle('Zuran Orb', 'Artifact', text)).outlet).toBe(true);
  });
});
