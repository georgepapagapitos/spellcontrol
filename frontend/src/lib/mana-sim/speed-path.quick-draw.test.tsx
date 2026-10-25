// @vitest-environment happy-dom
// Quick Draw (OTC 2024, commander Stella Lee, Wild Card): the one complete
// Spellbook combo in the list is the commander alone (5534--28, tag S, needs a
// card the list has to name). Read as "assembled", it came together on turn 1
// in 100% of games on every surface that timed the win path.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { detectWinConditions } from '@/deck-builder/services/winConditions/detect';
import { WinConditionPanel } from '@/components/deck/WinConditionPanel';
import { drawCard } from './__fixtures__/draw-cards';
import { toClockLibrary } from './hand-classify';
import { speedPathOf } from './speed-path';

// Real Scryfall record, trimmed to the fields the detector reads.
const STELLA = {
  name: 'Stella Lee, Wild Card',
  layout: 'normal',
  mana_cost: '{1}{U}{R}',
  cmc: 3,
  type_line: 'Legendary Creature — Human Rogue',
  oracle_text:
    "Whenever you cast your second spell each turn, exile the top card of your library. Until the end of your next turn, you may play that card.\n{T}: Copy target instant or sorcery spell you control. You may choose new targets for the copy. Activate only if you've cast three or more spells this turn.",
  colors: ['R', 'U'],
  color_identity: ['R', 'U'],
  keywords: [],
} as unknown as ScryfallCard;

const cards = [
  ...Array.from({ length: 36 }, () => drawCard('Island')),
  ...Array.from({ length: 63 }, () => drawCard('Counterspell')),
];

const analysis = () =>
  detectWinConditions({
    cards,
    commander: STELLA,
    combosInDeck: [{ cards: [STELLA.name], results: ['Win the game'] }],
    deckSynergy: analyzeDeckSynergy(cards),
    format: 'commander',
  });

describe('a combo whose only piece is the commander', () => {
  it('is a win path the detector finds, with nothing in the library to draw', () => {
    const wc = analysis();
    expect(wc.primary?.category).toBe('infinite-combo');
    expect(wc.primary?.assembly).toEqual([{ names: [], need: 0 }]);
  });

  it('has no clock to time, so no surface can read it as turn 1', () => {
    expect(speedPathOf(analysis())).toBeNull();
  });

  it('shows no clock line in the Win conditions panel', () => {
    const { container } = render(
      <WinConditionPanel analysis={analysis()} library={toClockLibrary(cards)} />
    );
    expect(container.querySelector('.win-con-clock')).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/turn 1\b/);
  });
});
