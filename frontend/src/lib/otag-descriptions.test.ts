import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OTAG_DESCRIPTIONS, describeOtag } from './otag-descriptions';

const snapshotPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'public',
  'tagger-tags.json'
);

describe('OTAG_DESCRIPTIONS', () => {
  it('covers every tag key in the bundled snapshot', () => {
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
      tags: Record<string, string[]>;
    };
    const snapshotKeys = Object.keys(snapshot.tags).sort();
    const described = Object.keys(OTAG_DESCRIPTIONS);
    const missing = snapshotKeys.filter((k) => !described.includes(k));
    expect(missing).toEqual([]);
  });

  it('has a non-empty one-line description for every key', () => {
    for (const [key, desc] of Object.entries(OTAG_DESCRIPTIONS)) {
      expect(desc.length, key).toBeGreaterThan(0);
      expect(desc, key).not.toContain('\n');
    }
  });
});

describe('describeOtag', () => {
  it('returns the curated description for known keys', () => {
    expect(describeOtag('tapland')).toBe('Land that enters the battlefield tapped');
    expect(describeOtag('boardwipe')).toBe('Destroys or removes many permanents at once');
  });

  it('falls back to a humanized label for unknown keys', () => {
    expect(describeOtag('repeatable-creature-tokens')).toBe('Repeatable creature tokens');
    expect(describeOtag('stax')).toBe('Stax');
  });
});
