// E537 follow-up: the owned-share swap names what it may displace (filler) and
// protects the rest. Lathril partial50 lost Canopy Tactician (57.8%, an elf that
// taps for GGG) to an owned 0% Sage of the Maze once Arcane Signet was held; Sythis
// partial50 seated an owned symmetric wipe that the deck's own audit flags as a nonbo.
import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { shareKeeper, seatsAsNonbo } from './ownedShareEviction';

const card = (name: string, type_line: string, oracle_text = '') =>
  ({ name, type_line, oracle_text, keywords: [], color_identity: [] }) as unknown as ScryfallCard;

const CANOPY = card('Canopy Tactician', 'Creature — Elf Warrior', '{T}: Add {G}{G}{G}.');
const SIGNET = card(
  'Arcane Signet',
  'Artifact',
  "{T}: Add one mana of any color in your commander's color identity."
);
const FILLER = card('Vanquisher’s Banner', 'Artifact', 'As this enters, choose a creature type.');
const VANQUISH = card(
  'Vanquish the Horde',
  'Sorcery',
  'This spell costs {1} less to cast for each creature on the battlefield.\nDestroy all creatures.'
);
const PAGE: Record<string, number> = {
  'Canopy Tactician': 57.8,
  'Arcane Signet': 56.7,
  'Vanquisher’s Banner': 12.1,
};
const keeper = (ownedPercent: number, comboCardNames: string[] = []) =>
  shareKeeper({
    combos: [],
    usedNames: new Set<string>(),
    comboCardNames: new Set(comboCardNames),
    cfg: { collectionOwnedPercent: ownedPercent },
    edhrecData: {
      cardlists: {
        allNonLand: Object.entries(PAGE).map(([name, inclusion]) => ({ name, inclusion })),
      },
    },
  } as unknown as Parameters<typeof shareKeeper>[0]);

describe('shareKeeper', () => {
  it('below 100%, keeps staple rocks and any card at the staple bar, frees filler', () => {
    const keeps = keeper(50);
    expect(keeps(SIGNET)).toBe(true);
    expect(keeps(CANOPY)).toBe(true);
    expect(keeps(FILLER)).toBe(false);
  });

  it('keeps a piece of a combo the deck completes', () => {
    expect(keeper(50, ['Vanquisher’s Banner'])(FILLER)).toBe(true);
  });

  it('keeps a must-include at any share, and lets a staple go at 100%', () => {
    const keeps = keeper(100);
    expect(keeps({ ...FILLER, isMustInclude: true } as ScryfallCard)).toBe(true);
    expect(keeps(CANOPY)).toBe(false);
    expect(keeps(SIGNET)).toBe(false);
  });

  it('keeps the protection pieces the wide reading finds (E555)', () => {
    const ward = card(
      'Flickering Ward',
      'Enchantment — Aura',
      `Enchant creature
As Flickering Ward enters, choose a color.
Enchanted creature has protection from the chosen color. This effect doesn't remove Flickering Ward.
{W}: Change Flickering Ward's chosen color.`
    );
    const confinement = card(
      'Solitary Confinement',
      'Enchantment',
      `At the beginning of your upkeep, sacrifice Solitary Confinement unless you discard a card.
Skip your draw step.
Skip all combat phases of your turns.
You have shroud.
Damage that would be dealt to you is prevented.`
    );
    expect(keeper(50)(ward)).toBe(true);
    expect(keeper(50)(confinement)).toBe(true);
  });
});

describe('seatsAsNonbo', () => {
  const makers = Array.from({ length: 10 }, (_, i) =>
    card(
      `Goblin Maker ${i}`,
      'Creature — Goblin',
      'When this creature enters, create two 1/1 red Goblin creature tokens.'
    )
  );
  const doublers = [
    ['Anointed Procession', 'Enchantment'],
    ['Parallel Lives', 'Enchantment'],
    ['Primal Vigor', 'Enchantment'],
  ].map(([name, type]) =>
    card(
      name,
      type,
      'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.'
    )
  );
  const state = {
    categories: { creatures: makers, enchantments: doublers, lands: [] },
    context: {
      commander: card('Krenko, Mob Boss', 'Legendary Creature — Goblin Warrior'),
      partnerCommander: null,
    },
  } as unknown as Parameters<typeof seatsAsNonbo>[1];

  it('refuses a symmetric creature wipe into a token deck, allows a plain card', () => {
    expect(seatsAsNonbo(VANQUISH, state)).toBe(true);
    expect(seatsAsNonbo(FILLER, state)).toBe(false);
  });
});
