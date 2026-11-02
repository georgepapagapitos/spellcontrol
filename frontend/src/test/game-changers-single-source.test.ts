// Guard for E1092: the Game Changers list drives a HARD bracket floor, so the
// backend (AI check_bracket) and the frontend (live-query fallback) must read
// the one list in @spellcontrol/deck-metrics, and the weekly workflow must keep
// diffing it against Scryfall. If this fails, restore the property rather than
// loosening the test: a second copy drifts silently, and nothing else notices
// when the Rules Committee changes the list.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const read = (rel: string) => {
  const p = resolve(root, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
};
const code = (s: string) =>
  s
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

describe('Game Changers: one list', () => {
  it('the backend check_bracket and the frontend fallback import it from deck-metrics', () => {
    for (const rel of [
      'backend/src/ai/bracket.ts',
      'frontend/src/deck-builder/services/scryfall/gamechangers.ts',
    ]) {
      const src = read(rel);
      expect(src, rel).toMatch(
        /import\s*\{[^}]*HARDCODED_GAME_CHANGERS[^}]*\}\s*from\s*'@spellcontrol\/deck-metrics'/
      );
      // No local array of card names standing in for it.
      expect(src, rel).not.toMatch(/new Set\(\[\s*['"](?:Drannith Magistrate|Rhystic Study)/);
    }
  });

  it('the list is defined once, in deck-metrics', () => {
    // A copy would carry several of the list's names together in one source file.
    const copies = ['backend/src', 'frontend/src'].flatMap((dir) =>
      (readdirSync(resolve(root, dir), { recursive: true }) as string[])
        .filter((f) => /\.tsx?$/.test(f) && !/\.(test|live\.test)\.tsx?$/.test(f))
        .filter((f) => {
          const src = read(`${dir}/${f}`);
          return ['Rhystic Study', 'Cyclonic Rift', 'Mana Vault', 'Necropotence'].every((n) =>
            src.includes(n)
          );
        })
        .map((f) => `${dir}/${f}`)
    );
    expect(copies).toEqual([]);
    expect(read('packages/deck-metrics/src/index.ts')).toContain(
      'export const HARDCODED_GAME_CHANGERS'
    );
  });
});

describe('Game Changers drift workflow', () => {
  const yml = code(read('.github/workflows/game-changers-drift.yml'));

  it('is scheduled and builds the shared packages first', () => {
    expect(yml).toMatch(/schedule:\s*\n\s*- cron:/);
    expect(yml).toContain('./.github/actions/build-shared');
  });

  it('runs the drift script, opens a labelled issue, and goes red', () => {
    expect(yml).toContain('node scripts/check-game-changers-drift.mjs');
    expect(yml).toContain('gh issue create --label game-changers-drift');
    expect(yml).toContain("steps.drift.outcome == 'failure'");
    expect(yml).toMatch(/issues:\s*write/);
  });

  it('the script fetches is:gamechanger with the project user agent and uses the shared diff', () => {
    const script = read('scripts/check-game-changers-drift.mjs');
    expect(script).toContain('is:gamechanger');
    expect(script).toContain("'User-Agent': 'spellcontrol/1.0'");
    expect(script).toContain('diffGameChangers');
  });
});
