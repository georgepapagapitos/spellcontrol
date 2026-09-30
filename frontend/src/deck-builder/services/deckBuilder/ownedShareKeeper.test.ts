// E537 follow-up: the owned-share swap names what it may displace (filler) and
// protects the rest. Lathril partial50 lost Canopy Tactician (57.8%, an elf that
// taps for GGG) to an owned 0% Sage of the Maze once Arcane Signet was held.
import { describe, it, expect } from 'vitest';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import { ownedShareKeeper } from './ownedShareEviction';

const card = (name: string, type_line: string, oracle_text = '') =>
  ({ name, type_line, oracle_text, keywords: [] }) as unknown as ScryfallCard;

const CANOPY = card('Canopy Tactician', 'Creature — Elf Warrior', '{T}: Add {G}{G}{G}.');
const SIGNET = card(
  'Arcane Signet',
  'Artifact',
  "{T}: Add one mana of any color in your commander's color identity."
);
const FILLER = card('Vanquisher’s Banner', 'Artifact', 'As this enters, choose a creature type.');
const PAGE: Record<string, number> = {
  'Canopy Tactician': 57.8,
  'Arcane Signet': 56.7,
  'Vanquisher’s Banner': 12.1,
};
const inclusionOf = (n: string) => PAGE[n] ?? -1;
const state = (comboCardNames: string[] = []) => ({
  combos: [],
  usedNames: new Set<string>(),
  comboCardNames: new Set(comboCardNames),
});
const pool: EDHRECCard[] = [];

describe('ownedShareKeeper', () => {
  it('below 100%, keeps staple rocks and any card at the staple bar, frees filler', () => {
    const keeps = ownedShareKeeper(state(), 50, inclusionOf, pool);
    expect(keeps(SIGNET)).toBe(true);
    expect(keeps(CANOPY)).toBe(true);
    expect(keeps(FILLER)).toBe(false);
  });

  it('keeps a piece of a combo the deck completes', () => {
    expect(ownedShareKeeper(state(['Vanquisher’s Banner']), 50, inclusionOf, pool)(FILLER)).toBe(
      true
    );
  });

  it('keeps a must-include at any share, and lets a staple go at 100%', () => {
    const keeps = ownedShareKeeper(state(), 100, inclusionOf, pool);
    expect(keeps({ ...FILLER, isMustInclude: true })).toBe(true);
    expect(keeps(CANOPY)).toBe(false);
    expect(keeps(SIGNET)).toBe(false);
  });
});
