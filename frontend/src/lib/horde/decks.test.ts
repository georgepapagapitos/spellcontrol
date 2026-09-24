import { describe, expect, it } from 'vitest';
import { HORDE_CATALOG } from './catalog';
import { loadHordeDeck } from './load-deck';

// The mechanical half of the copy rules (STYLE_GUIDE `## Voice & copy`) that
// frontend/src/copy-guards.test.ts does not reach — that guard only scans
// object-literal properties named from a fixed allowlist, which does not
// include `specialRule`/`credit`.
const EMDASH = /—/;
const ELLIPSIS = /\.\.\.|&hellip;/;
const ADJECTIVE =
  /\b(curated|tailored|intelligent(ly)?|powerful|comprehensive|elevates?|unlocks?|leverages?|seamless(ly)?|robust|effortless(ly)?|cutting-edge|state-of-the-art)\b/i;
const FILLER = /\b(please|simply)\b/i;
const EG = /\(\s*(e\.g\.|i\.e\.)/i;
const EXCLAIM = /[a-z]!(\s|$)/i;

describe('horde catalog', () => {
  it('lists all six hordes with a librarySize matching their real deck size', () => {
    const ids = HORDE_CATALOG.map((e) => e.id).sort();
    expect(ids).toEqual(
      ['battle-the-horde', 'dinosaurs', 'eldrazi', 'goblins', 'slivers', 'zombies'].sort()
    );
  });

  it.each(HORDE_CATALOG)('$id: specialRule and credit pass the copy rules', (entry) => {
    for (const text of [entry.specialRule, entry.credit]) {
      expect(text).not.toMatch(EMDASH);
      expect(text).not.toMatch(ELLIPSIS);
      expect(text).not.toMatch(ADJECTIVE);
      expect(text).not.toMatch(FILLER);
      expect(text).not.toMatch(EG);
      expect(text).not.toMatch(EXCLAIM);
    }
  });

  it.each(HORDE_CATALOG)('$id: has a signature tileArt crop and theme colors', (entry) => {
    expect(entry.tileArt).toMatch(/^https:\/\/cards\.scryfall\.io\/art_crop\//);
    expect(entry.themeColors.length).toBeGreaterThan(0);
  });
});

describe('loadHordeDeck', () => {
  it('rejects an unknown deck id', async () => {
    await expect(loadHordeDeck('not-a-real-horde')).rejects.toThrow('Unknown horde deck');
  });

  it('zombies: 60 tokens + 40 spells', async () => {
    const def = await loadHordeDeck('zombies');
    expect(def.tokens).toHaveLength(60);
    expect(def.spells).toHaveLength(40);
  });

  it('eldrazi: 65 tokens + 35 spells', async () => {
    const def = await loadHordeDeck('eldrazi');
    expect(def.tokens).toHaveLength(65);
    expect(def.spells).toHaveLength(35);
  });

  it('battle-the-horde: 60 spells, no tokens', async () => {
    const def = await loadHordeDeck('battle-the-horde');
    expect(def.tokens).toHaveLength(0);
    expect(def.spells).toHaveLength(60);
  });

  it.each(HORDE_CATALOG)('$id: matches its catalog librarySize and name', async (entry) => {
    const def = await loadHordeDeck(entry.id);
    expect(def.name).toBe(entry.name);
    expect(def.tokens.length + def.spells.length).toBe(entry.librarySize);
  });

  it.each(HORDE_CATALOG)('$id: 0-4 bosses', async (entry) => {
    const def = await loadHordeDeck(entry.id);
    expect(def.bosses.length).toBeGreaterThanOrEqual(0);
    expect(def.bosses.length).toBeLessThanOrEqual(4);
  });

  it.each(HORDE_CATALOG)('$id: every lateGame name is one of its spells', async (entry) => {
    const def = await loadHordeDeck(entry.id);
    const spellNames = new Set(def.spells.map((c) => c.name));
    for (const name of def.lateGame) {
      expect(spellNames.has(name)).toBe(true);
    }
  });

  it.each(HORDE_CATALOG)('$id: every card has scryfallId, imageUrl and typeLine', async (entry) => {
    const def = await loadHordeDeck(entry.id);
    for (const card of [...def.tokens, ...def.spells, ...def.bosses]) {
      expect(card.scryfallId, card.name).toBeTruthy();
      expect(card.imageUrl, card.name).toBeTruthy();
      expect(card.typeLine, card.name).toBeTruthy();
    }
  });

  it.each(HORDE_CATALOG)('$id: every token has power and toughness', async (entry) => {
    const def = await loadHordeDeck(entry.id);
    for (const token of def.tokens) {
      expect(token.power, token.name).toBeTruthy();
      expect(token.toughness, token.name).toBeTruthy();
    }
  });

  it.each(HORDE_CATALOG)('$id: expanded ids are unique', async (entry) => {
    const def = await loadHordeDeck(entry.id);
    const ids = [...def.tokens, ...def.spells, ...def.bosses].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('eldrazi boss swap', () => {
  it('replaces Consuming Aberration with a true Eldrazi that pressures life/board', async () => {
    const def = await loadHordeDeck('eldrazi');
    const bossNames = def.bosses.map((c) => c.name);
    expect(bossNames).not.toContain('Consuming Aberration');
    expect(bossNames).toContain('It That Betrays');
    const betrayer = def.bosses.find((c) => c.name === 'It That Betrays');
    expect(betrayer?.typeLine).toContain('Eldrazi');
  });
});
