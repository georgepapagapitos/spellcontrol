import type { PlaytestCard } from '@/lib/playtest';
import type { HordeDeckDef } from './library';

/** Tiny realistic fixture deck for horde engine tests — a handful of real
 *  Zombie tribal tokens/spells, one entry per authored copy. Not a shipped
 *  deck (PR 2 supplies real horde decks). */

function card(overrides: Partial<PlaytestCard> & Pick<PlaytestCard, 'id' | 'name'>): PlaytestCard {
  return { typeLine: 'Creature — Zombie', power: '2', toughness: '2', ...overrides };
}

const TOKEN_TEMPLATE: Omit<PlaytestCard, 'id'> = {
  name: 'Zombie',
  typeLine: 'Zombie Creature Token',
  power: '2',
  toughness: '2',
  isToken: true,
};

function makeTokens(count: number): PlaytestCard[] {
  return Array.from({ length: count }, (_, i) => ({ ...TOKEN_TEMPLATE, id: `zombie-token-${i}` }));
}

function makeSpells(): PlaytestCard[] {
  const spells: PlaytestCard[] = [
    card({ id: 'geralf-1', name: "Geralf's Messenger", power: '2', toughness: '2' }),
    card({ id: 'geralf-2', name: "Geralf's Messenger", power: '2', toughness: '2' }),
    card({ id: 'diregraf-1', name: 'Diregraf Ghoul', power: '2', toughness: '2' }),
    card({ id: 'diregraf-2', name: 'Diregraf Ghoul', power: '2', toughness: '2' }),
    card({ id: 'rotting-1', name: 'Rotting Rats', power: '2', toughness: '2' }),
    card({
      id: 'zombify-1',
      name: 'Zombify',
      typeLine: 'Sorcery',
      power: undefined,
      toughness: undefined,
    }),
    card({
      id: 'fume-1',
      name: 'Fume Spitter',
    }),
    card({
      id: 'liliana-1',
      name: "Liliana's Mastery",
      typeLine: 'Sorcery',
      power: undefined,
      toughness: undefined,
    }),
  ];
  return spells;
}

/** Every copy has already-unique authored ids — the real per-game ids come
 *  from `buildHordeLibrary`. */
export const ZOMBIE_HORDE_FIXTURE: HordeDeckDef = {
  id: 'zombies',
  name: 'The Undying Horde',
  specialRule: "Whenever a Zombie you control dies, mill the horde's library for 1.",
  tokens: makeTokens(12),
  spells: makeSpells(),
  bosses: [
    card({
      id: 'boss-1',
      name: 'Gisa and Geralf',
      typeLine: 'Legendary Creature — Human Wizard',
      power: '2',
      toughness: '2',
    }),
  ],
  lateGame: ["Liliana's Mastery"],
};
