import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { EnrichedCard } from '@spellcontrol/binder-routing';

function card(name: string): EnrichedCard {
  return {
    copyId: name,
    name,
    setCode: 'TST',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: name,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
  };
}

const tagBinder = [
  {
    filterGroups: [
      { filter: { oracleTagChips: { chips: [{ value: 'mana-rock' }], joiners: [] } } },
    ],
  },
];
const plainBinder = [
  { filterGroups: [{ filter: { typeChips: { chips: [{ value: 'artifact' }] } } }] },
];

afterEach(() => {
  delete process.env.TAGGER_SNAPSHOT_PATH;
  vi.resetModules();
});

describe('anyBinderUsesTagRules', () => {
  it('detects a tag rule and ignores plain binders / malformed input', async () => {
    const { anyBinderUsesTagRules } = await import('./card-tags');
    expect(anyBinderUsesTagRules(tagBinder)).toBe(true);
    expect(anyBinderUsesTagRules(plainBinder)).toBe(false);
    expect(anyBinderUsesTagRules([])).toBe(false);
    expect(anyBinderUsesTagRules(null)).toBe(false);
    expect(anyBinderUsesTagRules([{ filterGroups: 'nope' }])).toBe(false);
  });
});

describe('decorateCardsWithTags', () => {
  it('attaches tags from the snapshot, copying only tagged cards', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'otag-'));
    const snap = path.join(dir, 'tagger-tags.json');
    writeFileSync(
      snap,
      JSON.stringify({ tags: { 'mana-rock': ['Sol Ring'], ramp: ['Sol Ring', 'Llanowar Elves'] } })
    );
    process.env.TAGGER_SNAPSHOT_PATH = snap;
    vi.resetModules();
    const { decorateCardsWithTags } = await import('./card-tags');

    const input = [card('Sol Ring'), card('Mountain')];
    const out = decorateCardsWithTags(input);
    expect(out[0].tags).toEqual(['mana-rock', 'ramp']);
    expect(out[1].tags).toBeUndefined();
    // Untagged card is returned by reference (not copied).
    expect(out[1]).toBe(input[1]);
  });

  it('degrades to no-op when the snapshot file is absent', async () => {
    process.env.TAGGER_SNAPSHOT_PATH = path.join(tmpdir(), 'does-not-exist-otag.json');
    vi.resetModules();
    const { decorateCardsWithTags } = await import('./card-tags');
    const input = [card('Sol Ring')];
    expect(decorateCardsWithTags(input)).toBe(input);
  });
});
