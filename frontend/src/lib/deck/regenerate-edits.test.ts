import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck, DeckCard } from '@/store/decks';
import { regenerateState } from './regenerate-prefill';
import {
  deckEdits,
  keepEditsLabel,
  keepEditsPatch,
  snapshotGeneratedList,
} from './regenerate-edits';

const card = (name: string, type_line = 'Artifact'): ScryfallCard =>
  ({ id: name, name, type_line }) as ScryfallCard;
const slot = (name: string, type_line?: string, id = name): DeckCard => ({
  slotId: id,
  card: card(name, type_line),
  allocatedCopyId: null,
  addedAt: 0,
});

const KRENKO = card('Krenko, Mob Boss', 'Legendary Creature — Goblin Warrior');
const generated = [
  slot('Sol Ring'),
  slot('Arcane Signet'),
  slot('Goblin Chieftain', 'Creature — Goblin'),
  slot('Mountain', 'Basic Land — Mountain', 'm1'),
  slot('Mountain', 'Basic Land — Mountain', 'm2'),
];

function deckWith(cards: DeckCard[], over: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    format: 'commander',
    source: 'generated',
    commander: KRENKO,
    partnerCommander: null,
    cards,
    generationContext: {
      selectedThemes: [],
      targetBracket: 3,
      landCount: 37,
      collectionMode: false,
      customization: { mustIncludeCards: ['Goblin Chieftain'] },
      generatedList: snapshotGeneratedList(generated, KRENKO, null),
    },
    ...over,
  } as unknown as Deck;
}

describe('snapshotGeneratedList', () => {
  it('records non-basic names once and the commanders, never basics', () => {
    expect(snapshotGeneratedList(generated, KRENKO, null)).toEqual({
      cards: ['Sol Ring', 'Arcane Signet', 'Goblin Chieftain'],
      commanders: ['Krenko, Mob Boss'],
      cut: [],
    });
  });
});

describe('deckEdits', () => {
  it('has no edits for an untouched deck', () => {
    expect(deckEdits(deckWith(generated))).toBeNull();
  });

  it('reads added and cut cards by name', () => {
    const edited = [
      slot('Sol Ring'),
      slot('Goblin Chieftain', 'Creature — Goblin'),
      slot('Skullclamp'),
      slot('Impact Tremors', 'Enchantment'),
    ];
    const edits = deckEdits(deckWith(edited));
    expect(edits).toEqual({ added: ['Skullclamp', 'Impact Tremors'], cut: ['Arcane Signet'] });
    expect(keepEditsLabel(edits!)).toBe('Keep my edits (2 added, 1 cut)');
  });

  it('ignores basic-land count changes, quantity changes and printing swaps', () => {
    const edited = [
      slot('Sol Ring'),
      { ...slot('Sol Ring', undefined, 'second'), card: { ...card('Sol Ring'), id: 'other' } },
      { ...slot('Arcane Signet'), card: { ...card('Arcane Signet'), id: 'other-print' } },
      slot('Goblin Chieftain', 'Creature — Goblin'),
      slot('Snow-Covered Mountain', 'Basic Snow Land — Mountain'),
      slot('Wastes', 'Basic Land'),
    ];
    expect(deckEdits(deckWith(edited))).toBeNull();
  });

  it('gives a deck with no recorded list no edits, however different it looks', () => {
    const legacy = deckWith([slot('Skullclamp')]);
    legacy.generationContext = { ...legacy.generationContext!, generatedList: undefined };
    expect(deckEdits(legacy)).toBeNull();
  });

  it('carries nothing after a commander swap, when every card would read as cut', () => {
    const swapped = deckWith([slot('Skullclamp')], {
      commander: card('Purphoros, God of the Forge'),
    });
    expect(deckEdits(swapped)).toBeNull();
  });

  it('counts a card moved out of the main deck as cut', () => {
    const moved = deckWith([slot('Sol Ring'), slot('Goblin Chieftain', 'Creature — Goblin')]);
    expect(deckEdits(moved)?.cut).toEqual(['Arcane Signet']);
  });
});

describe('a carried cut', () => {
  // Regenerated with Arcane Signet cut: the new deck has no Signet, and the
  // generator was told to ban it.
  const second = [slot('Sol Ring'), slot('Goblin Chieftain', 'Creature — Goblin')];
  const regenerated = () =>
    deckWith(second, {
      generationContext: {
        ...deckWith([]).generationContext!,
        generatedList: snapshotGeneratedList(second, KRENKO, null, ['Arcane Signet']),
      },
    });

  it('still counts as a cut on the next regenerate with no new edits', () => {
    const edits = deckEdits(regenerated());
    expect(edits).toEqual({ added: [], cut: ['Arcane Signet'] });
    expect(keepEditsLabel(edits!)).toBe('Keep my edits (0 added, 1 cut)');
    expect(keepEditsPatch({ mustIncludeCards: [], tempBannedCards: [] }, edits!, true)).toEqual({
      mustIncludeCards: [],
      tempBannedCards: ['Arcane Signet'],
    });
  });

  it('is cleared when the player puts the card back', () => {
    const back = regenerated();
    back.cards = [...second, slot('Arcane Signet')];
    expect(deckEdits(back)).toBeNull();
  });
});

describe('keepEditsPatch', () => {
  const edits = { added: ['Skullclamp'], cut: ['Goblin Chieftain'] };
  const base = { mustIncludeCards: ['Goblin Chieftain'], tempBannedCards: [] as string[] };

  it('pins additions, bans cuts and unpins a cut card the source had pinned', () => {
    expect(keepEditsPatch(base, edits, true, ['Goblin Chieftain'])).toEqual({
      mustIncludeCards: ['Skullclamp'],
      tempBannedCards: ['Goblin Chieftain'],
    });
  });

  it('restores the original settings when turned off', () => {
    const on = keepEditsPatch(base, edits, true, ['Goblin Chieftain']);
    expect(keepEditsPatch(on, edits, false, ['Goblin Chieftain'])).toEqual({
      mustIncludeCards: ['Goblin Chieftain'],
      tempBannedCards: [],
    });
  });

  it('leaves picks the player typed in on the page alone when toggling', () => {
    const typed = {
      mustIncludeCards: ['Impact Tremors'],
      tempBannedCards: ['Rings of Brighthearth'],
    };
    const on = keepEditsPatch(typed, edits, true);
    expect(on.mustIncludeCards).toEqual(['Impact Tremors', 'Skullclamp']);
    expect(keepEditsPatch(on, edits, false)).toEqual(typed);
  });
});

describe('regenerateState', () => {
  it('feeds the edits into the prefill only when there are some', () => {
    expect(regenerateState(deckWith(generated)).prefill.edits).toBeUndefined();
    const edited = deckWith([slot('Sol Ring'), slot('Skullclamp')]);
    expect(regenerateState(edited).prefill.edits).toEqual({
      added: ['Skullclamp'],
      cut: ['Arcane Signet', 'Goblin Chieftain'],
    });
  });
});
