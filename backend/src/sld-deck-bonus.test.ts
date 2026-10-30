import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resetSldDeckBonusCache, sldDeckBonus } from './sld-deck-bonus';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sld-bonus-'));
  // The shape refresh-sld-drops.mjs writes (frontend/scripts/sld-deck-bonus.mjs).
  writeFileSync(
    path.join(dir, 'sld-drops.json'),
    JSON.stringify({
      drops: [],
      deckBonus: [
        {
          deck: 'Odds and Ends',
          cards: [{ name: 'Perplexing Chimera', number: '7039', foil: true }],
        },
        { deck: 'Broken', cards: [{ name: 'No Number' }] },
      ],
    })
  );
});

beforeEach(() => {
  process.env.SLD_DROPS_SNAPSHOT_PATH = path.join(dir, 'sld-drops.json');
  resetSldDeckBonusCache();
});

afterAll(() => {
  delete process.env.SLD_DROPS_SNAPSHOT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe('sldDeckBonus', () => {
  it("reads a deck's bonus cards from the snapshot", () => {
    expect(sldDeckBonus('Odds and Ends')).toEqual([
      { name: 'Perplexing Chimera', number: '7039', foil: true },
    ]);
  });

  it('drops a malformed card and answers [] for an unknown deck', () => {
    expect(sldDeckBonus('Broken')).toEqual([]);
    expect(sldDeckBonus('Nope')).toEqual([]);
  });

  it('answers [] with no snapshot on disk', () => {
    process.env.SLD_DROPS_SNAPSHOT_PATH = path.join(dir, 'missing.json');
    resetSldDeckBonusCache();
    expect(sldDeckBonus('Odds and Ends')).toEqual([]);
  });
});
