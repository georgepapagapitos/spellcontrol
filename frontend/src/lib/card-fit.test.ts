import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { computeAddFit } from './card-fit';
import type { CutCandidate } from './intelligent-cuts';

function card(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: name,
    oracle_id: `o-${name}`,
    name,
    cmc: 0,
    type_line: 'Creature',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...over,
  } as ScryfallCard;
}

const slot = (c: ScryfallCard): CutCandidate => ({ slotId: `slot-${c.name}`, card: c });

// A deck genuinely invested in the tokens axis (3 producers + 2 payoffs = 5).
const tokenDeck: CutCandidate[] = [
  slot(card('Maker A', { oracle_text: 'Create a 1/1 white Soldier creature token.' })),
  slot(card('Maker B', { oracle_text: 'Create a 1/1 green Saproling creature token.' })),
  slot(card('Maker C', { oracle_text: 'Create a 1/1 red Goblin creature token.' })),
  slot(card('Anthem Lord', { oracle_text: 'Creatures you control get +1/+1.' })),
  slot(
    card('Watcher', { oracle_text: 'Whenever another creature you control enters, draw a card.' })
  ),
];

describe('computeAddFit — synergy axes', () => {
  it('reports axesHit when the add reinforces an invested engine', () => {
    const add = card('New Maker', { oracle_text: 'Create a 1/1 blue Bird creature token.' });
    const fit = computeAddFit({ addCard: add, deckCards: tokenDeck });
    expect(fit.axesHit.map((a) => a.axis)).toContain('tokens');
    expect(fit.axesHit.find((a) => a.axis === 'tokens')?.side).toBe('producer');
    expect(fit.axesMissed).toHaveLength(0);
  });

  it('reports axesMissed when the add ignores the invested engine', () => {
    const add = card('Lone Bear', { oracle_text: '' }); // vanilla — no axes
    const fit = computeAddFit({ addCard: add, deckCards: tokenDeck });
    expect(fit.axesHit).toHaveLength(0);
    expect(fit.axesMissed.map((a) => a.axis)).toContain('tokens');
  });

  it('surfaces axesNew for the add’s own axes the deck is not invested in', () => {
    const add = card('Soul Warden', { oracle_text: 'When this creature enters, you gain 3 life.' });
    const fit = computeAddFit({ addCard: add, deckCards: tokenDeck });
    expect(fit.axesNew.map((a) => a.axis)).toContain('lifegain');
    // The deck's tokens engine is untouched by a pure lifegain card.
    expect(fit.axesMissed.map((a) => a.axis)).toContain('tokens');
  });
});

describe('computeAddFit — curve / role / color', () => {
  it('counts nonland cards at the add mana value, ignoring lands', () => {
    const deck: CutCandidate[] = [
      slot(card('Three Drop A', { cmc: 3, type_line: 'Creature' })),
      slot(card('Three Drop B', { cmc: 3, type_line: 'Instant' })),
      slot(card('Karoo Land', { cmc: 3, type_line: 'Land' })), // a land at 3 must not count
      slot(card('Two Drop', { cmc: 2, type_line: 'Creature' })),
    ];
    const add = card('Another Three', { cmc: 3, type_line: 'Sorcery' });
    const fit = computeAddFit({ addCard: add, deckCards: deck });
    expect(fit.curve.cmc).toBe(3);
    expect(fit.curve.nonlandAtCmc).toBe(2);
  });

  it('counts deck cards sharing the add’s role', () => {
    const deck: CutCandidate[] = [
      slot(card('Rock A', { deckRole: 'ramp' })),
      slot(card('Rock B', { deckRole: 'ramp' })),
      slot(card('Wrath', { deckRole: 'boardwipe' })),
    ];
    const add = card('Rock C', { deckRole: 'ramp' });
    const fit = computeAddFit({ addCard: add, deckCards: deck });
    expect(fit.role.role).toBe('ramp');
    expect(fit.role.label).toBe('Ramp');
    expect(fit.role.countInDeck).toBe(2);
  });

  it('flags an off-identity add and a colorless add', () => {
    const off = computeAddFit({
      addCard: card('Green Thing', { color_identity: ['G'] }),
      deckCards: tokenDeck,
      commanderColorIdentity: ['U', 'R'],
    });
    expect(off.color.withinIdentity).toBe(false);
    expect(off.color.colorless).toBe(false);

    const colorless = computeAddFit({
      addCard: card('Sol Ring', { color_identity: [], type_line: 'Artifact' }),
      deckCards: tokenDeck,
      commanderColorIdentity: ['U', 'R'],
    });
    expect(colorless.color.colorless).toBe(true);
    expect(colorless.color.withinIdentity).toBe(true);
  });
});

describe('computeAddFit — ranked cuts', () => {
  it('returns ranked replacement cuts from the Slice-A engine', () => {
    const add = card('New Maker', { oracle_text: 'Create a 1/1 blue Bird creature token.' });
    const fit = computeAddFit({ addCard: add, deckCards: tokenDeck, cutLimit: 3 });
    // Same-axis token makers are valid like-for-like cuts; the engine surfaces them.
    expect(fit.rankedCuts.length).toBeGreaterThan(0);
    expect(fit.rankedCuts.length).toBeLessThanOrEqual(3);
  });
});
