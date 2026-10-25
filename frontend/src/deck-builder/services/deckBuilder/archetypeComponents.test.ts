import { describe, expect, it } from 'vitest';
import { componentsOf, tallyComponents, type ComponentKey } from './archetypeComponents';
import { REAL } from './archetypeChecks.fixtures';

const has = (name: string, key: ComponentKey) =>
  componentsOf(REAL[name], () => REAL[name].tags).includes(key);

describe('archetype components, real oracle text', () => {
  it('repeatable outlets: a cost that sacrifices a creature of your choice', () => {
    for (const n of ['Viscera Seer', "Ashnod's Altar", 'Goblin Bombardment', 'Carrion Feeder'])
      expect(has(n, 'repeatableOutlet'), n).toBe(true);
    // One-shot additional costs and self-sacrifice are not outlets.
    for (const n of ['Village Rites', 'Goblin Grenade', 'Sakura-Tribe Elder', 'Blood Artist'])
      expect(has(n, 'repeatableOutlet'), n).toBe(false);
  });

  it('death payoffs: rewards creatures dying, not the sacrifice itself', () => {
    for (const n of ['Blood Artist', 'Zulaport Cutthroat', 'Falkenrath Noble'])
      expect(has(n, 'deathPayoff'), n).toBe(true);
    for (const n of ['Viscera Seer', 'Sol Ring']) expect(has(n, 'deathPayoff'), n).toBe(false);
  });

  it('token makers: creature tokens only', () => {
    for (const n of ['Bitterblossom', 'Ophiomancer', 'Grave Titan', 'Krenko, Mob Boss'])
      expect(has(n, 'tokenMaker'), n).toBe(true);
    // Treasure is not a creature token.
    for (const n of ['Smothering Tithe', 'Sol Ring']) expect(has(n, 'tokenMaker'), n).toBe(false);
  });

  it('team effects: anthems and mass pumps', () => {
    for (const n of ['Glorious Anthem', 'Overrun', "Mirari's Wake"])
      expect(has(n, 'teamEffect'), n).toBe(true);
    expect(has('Sol Ring', 'teamEffect')).toBe(false);
  });

  it('protection: a noncreature card, never a creature that has the keyword', () => {
    for (const n of ['Heroic Intervention', "Teferi's Protection", 'Lightning Greaves'])
      expect(has(n, 'protection'), n).toBe(true);
    for (const n of ['Mother of Runes', 'Swords to Plowshares', 'Sol Ring'])
      expect(has(n, 'protection'), n).toBe(false);
  });

  it('spell payoffs: permanents that reward casting instants and sorceries', () => {
    for (const n of ['Guttersnipe', 'Young Pyromancer', 'Murmuring Mystic'])
      expect(has(n, 'spellPayoff'), n).toBe(true);
    // The spells themselves are not payoffs.
    for (const n of ['Lightning Bolt', 'Rhystic Study'])
      expect(has(n, 'spellPayoff'), n).toBe(false);
  });

  it('land fetch and landfall payoffs', () => {
    for (const n of ['Cultivate', 'Rampant Growth', 'Sakura-Tribe Elder'])
      expect(has(n, 'landFetch'), n).toBe(true);
    for (const n of ['Rampaging Baloths', 'Lotus Cobra'])
      expect(has(n, 'landfallPayoff'), n).toBe(true);
    expect(has('Sol Ring', 'landfallPayoff')).toBe(false);
  });

  it('graveyard fillers and reanimation', () => {
    for (const n of ['Entomb', 'Faithless Looting', "Stitcher's Supplier"])
      expect(has(n, 'graveyardFiller'), n).toBe(true);
    for (const n of ['Reanimate', 'Animate Dead', 'Sun Titan'])
      expect(has(n, 'reanimation'), n).toBe(true);
    // Self-recursion and a return to hand are not reanimation.
    for (const n of ['Gravecrawler', 'Eternal Witness', 'Regrowth'])
      expect(has(n, 'reanimation'), n).toBe(false);
  });

  it('counts copies, lists distinct names, and sets lands apart', () => {
    const cards = [
      REAL['Viscera Seer'],
      REAL['Viscera Seer'],
      REAL['Forest'],
      REAL['Forest'],
      REAL['Forest'],
      REAL['Sol Ring'],
    ];
    const t = tallyComponents(cards, (n) => REAL[n].tags);
    expect(t.count.repeatableOutlet).toBe(2);
    expect(t.names.repeatableOutlet).toEqual(['Viscera Seer']);
    expect(t.lands).toBe(3);
    expect(t.count.artifact).toBe(1);
  });
});
