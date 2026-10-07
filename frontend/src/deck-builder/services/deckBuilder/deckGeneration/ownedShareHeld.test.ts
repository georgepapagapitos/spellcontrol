// E571: the count the owned-share gap note gives. Real Lathril partial50 cards:
// a 40%+ staple, a staple rock and a protection piece are held, a 6.9% tutor is not.
import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { ownedShareHeld } from './ownedShareHeld';
import type { GenerationState } from './state';

const card = (name: string, oracle_text = '') =>
  ({
    name,
    type_line: 'Creature',
    oracle_text,
    keywords: [],
    color_identity: [],
  }) as unknown as ScryfallCard;

const stateOf = (strategy: string, owned: string[], deck: ScryfallCard[]) =>
  ({
    combos: [],
    usedNames: new Set<string>(),
    comboCardNames: new Set<string>(),
    cfg: { collectionStrategy: strategy, collectionOwnedPercent: 50 },
    context: { collectionNames: new Set(owned) },
    categories: { lands: [card('Forest')], creatures: deck },
    edhrecData: {
      cardlists: {
        allNonLand: [
          { name: 'Wirewood Channeler', inclusion: 49.7 },
          { name: 'Crop Rotation', inclusion: 6.9 },
          { name: 'Reclamation Sage', inclusion: 70.9 },
        ],
      },
    },
  }) as unknown as GenerationState;

describe('ownedShareHeld', () => {
  const deck = [
    card('Wirewood Channeler'),
    card('Reclamation Sage'),
    card('Crop Rotation'),
    card('Sylvan Tutor'),
  ];

  it('counts the unowned nonland cards the share swap may not take', () => {
    // Sylvan Tutor is owned; Channeler and Sage are staples; Crop Rotation is free.
    expect(ownedShareHeld(stateOf('partial', ['Sylvan Tutor'], deck))).toBe(2);
  });

  it('is undefined outside a partial build', () => {
    expect(ownedShareHeld(stateOf('prefer', ['Sylvan Tutor'], deck))).toBeUndefined();
  });
});
