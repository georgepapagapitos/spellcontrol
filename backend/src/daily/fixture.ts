import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RARITIES } from './score';

/** A small answer pool and card index for tests, in the shape refresh-daily-cards.mjs writes. */
export const FIXTURE_ART = 'https://cards.example.test/art/answer.jpg';

type Row = [string, string, number, string, number, number];

const CARDS: Row[] = [
  ['Swords to Plowshares', 'W', 1, 'Instant', 1, 1993],
  ['Lightning Bolt', 'R', 1, 'Instant', 0, 1993],
  ['Sol Ring', '', 1, 'Artifact', 1, 1993],
  ['Wear // Tear', 'RW', 2, 'Instant // Instant', 1, 2000],
  ["Lim-Dûl's Vault", 'UB', 2, 'Instant', 1, 1994],
  ['Llanowar Elves', 'G', 1, 'Creature — Elf Druid', 0, 1993],
  ['Counterspell', 'U', 2, 'Instant', 0, 1993],
  ['Black Lotus', '', 0, 'Artifact', 4, 1993],
];

export const POOL_NAMES = ['Swords to Plowshares', 'Sol Ring', 'Llanowar Elves', 'Counterspell'];

export function poolCard(name: string) {
  const row = CARDS.find((r) => r[0] === name)!;
  return {
    name: row[0],
    colors: row[1],
    mv: row[2],
    typeLine: row[3],
    rarity: RARITIES[row[4]],
    year: row[5],
    setName: 'Test Set',
    rulesText: 'Rules text of this card.',
    flavor: name === 'Sol Ring' ? '' : 'A line of flavor.',
    art: FIXTURE_ART,
  };
}

/** Write the fixture into a fresh temp dir and return it. */
export function writeDailyFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'daily-fixture-'));
  writeFileSync(
    path.join(dir, 'pool.json'),
    JSON.stringify({ version: 1, generatedAt: 'test', cards: POOL_NAMES.map(poolCard) })
  );
  writeFileSync(
    path.join(dir, 'cards.json'),
    JSON.stringify({ version: 1, generatedAt: 'test', rarities: [...RARITIES], cards: CARDS })
  );
  return dir;
}
