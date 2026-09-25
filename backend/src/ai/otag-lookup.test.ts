import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

afterEach(() => {
  delete process.env.OTAG_INDEX_PATH;
  vi.resetModules();
});

describe('backendOracleTagLookup', () => {
  it('degrades to "no known tags" when the snapshot is missing on disk', async () => {
    process.env.OTAG_INDEX_PATH = path.join(tmpdir(), 'does-not-exist-otag-index.json');
    const { backendOracleTagLookup } = await import('./otag-lookup');
    const tags = backendOracleTagLookup();
    expect(tags.isKnownTag('mana-dork')).toBe(false);
    expect(tags.hasTag('Llanowar Elves', 'mana-dork')).toBe(false);
  });

  it('loads a real snapshot: known tag + membership, unknown tag stays unknown', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'otag-index-'));
    const file = path.join(dir, 'otag-index.json');
    writeFileSync(
      file,
      JSON.stringify({
        generatedAt: '2026-09-24T00:00:00.000Z',
        tags: [{ s: 'mana-dork', l: 'mana dork', d: '' }],
        cards: { 'Llanowar Elves': [0] },
      })
    );
    process.env.OTAG_INDEX_PATH = file;
    const { backendOracleTagLookup } = await import('./otag-lookup');
    const tags = backendOracleTagLookup();
    expect(tags.isKnownTag('mana-dork')).toBe(true);
    expect(tags.hasTag('Llanowar Elves', 'mana-dork')).toBe(true);
    expect(tags.hasTag('Sol Ring', 'mana-dork')).toBe(false);
    expect(tags.isKnownTag('not-a-real-tag')).toBe(false);
  });
});
