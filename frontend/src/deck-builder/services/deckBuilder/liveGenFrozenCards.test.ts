// @vitest-environment node
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { freezeCards, nameOnlyIdentifiers, thawCards } from './liveGenFrozenCards';

const answer = (names: string[], tag: string, missing: string[] = []) => ({
  object: 'list' as const,
  not_found: missing.map((name) => ({ name })),
  data: names.map((name) => ({ name, tag })),
});

describe('frozen collection cards (E1061)', () => {
  it('reads only name-only requests', () => {
    expect(
      nameOnlyIdentifiers(JSON.stringify({ identifiers: [{ name: 'A' }, { name: 'B' }] }))
    ).toEqual(['A', 'B']);
    expect(
      nameOnlyIdentifiers(JSON.stringify({ identifiers: [{ name: 'A', set: 'x' }] }))
    ).toBeNull();
    expect(nameOnlyIdentifiers('nope')).toBeNull();
  });

  it('serves a reshuffled batch from the first answer, not the new one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frozen-'));
    freezeCards(dir, ['A', 'B'], answer(['A', 'B'], 'old'));
    // A later batch holds B and C; the live answer for B is newer and must lose.
    freezeCards(dir, ['B', 'C'], answer(['B', 'C'], 'new'));
    const { body, complete } = thawCards(dir, ['C', 'B', 'A']);
    expect(complete).toBe(true);
    expect(body.data).toEqual([
      { name: 'C', tag: 'new' },
      { name: 'B', tag: 'old' },
      { name: 'A', tag: 'old' },
    ]);
  });

  it('matches a double-faced card by its front name and reports the unknown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frozen-'));
    freezeCards(dir, ['Fire'], answer(['Fire // Ice'], 'dfc'));
    expect(thawCards(dir, ['Fire']).body.data).toEqual([{ name: 'Fire // Ice', tag: 'dfc' }]);
    const r = thawCards(dir, ['Fire', 'Zed']);
    expect(r.complete).toBe(false);
    expect(thawCards(dir, ['Zed'], answer([], 'x', ['Zed'])).body.not_found).toEqual([
      { name: 'Zed' },
    ]);
  });
});
