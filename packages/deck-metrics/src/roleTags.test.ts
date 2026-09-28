import { describe, it, expect } from 'vitest';
import { isIncidentalRampByTags, isRampByTags, isRemovalByTags } from './roleTags';
import { createTagLookup, estimateBracket } from './index';

// Tag sets as Scryfall's tagger ships them (tagger-tags.json, 2026-09-27).
const TAGS: Record<string, string[]> = {
  'Mana Drain': ['ramp', 'counterspell'],
  'Sword of Feast and Famine': ['ramp', 'protection'],
  'Tinder Wall': ['ramp', 'removal', 'spot-removal'],
  'Path to Exile': ['ramp', 'removal', 'spot-removal', 'tutor', 'land-tutor'],
  'Mina and Denn, Wildborn': ['ramp', 'bounce'],
  'Mana Bloom': ['ramp', 'bounce'],
  'Arcane Signet': ['ramp', 'mana-rock'],
  Farseek: ['ramp', 'tutor'],
  'Cloud Key': ['cost-reducer'],
  'Llanowar Elves': ['ramp', 'mana-dork'],
};

const hasOf = (name: string) => (tag: string) => TAGS[name]?.includes(tag) ?? false;

describe('isIncidentalRampByTags', () => {
  it('flags generic-ramp cards whose tags name another job', () => {
    expect(isIncidentalRampByTags(hasOf('Mana Drain'))).toBe(true);
    expect(isIncidentalRampByTags(hasOf('Sword of Feast and Famine'))).toBe(true);
    expect(isIncidentalRampByTags(hasOf('Tinder Wall'))).toBe(true);
  });

  it('keeps a card with a ramp-specific tag, whatever else it does', () => {
    expect(isIncidentalRampByTags(hasOf('Path to Exile'))).toBe(false);
    expect(isIncidentalRampByTags(hasOf('Arcane Signet'))).toBe(false);
  });

  it('does not treat self-bounce as another job', () => {
    // Interactive bounce is always tagged removal too; bounce alone is a card
    // returning its own permanent (a land for an extra land drop, itself).
    expect(isIncidentalRampByTags(hasOf('Mina and Denn, Wildborn'))).toBe(false);
    expect(isIncidentalRampByTags(hasOf('Mana Bloom'))).toBe(false);
  });

  it('keeps plain ramp', () => {
    expect(isIncidentalRampByTags(hasOf('Farseek'))).toBe(false);
  });
});

describe('isRampByTags', () => {
  it('folds every ramp tag except incidental ramp', () => {
    for (const n of ['Arcane Signet', 'Farseek', 'Cloud Key', 'Llanowar Elves', 'Mana Bloom']) {
      expect(isRampByTags(hasOf(n))).toBe(true);
    }
    for (const n of ['Mana Drain', 'Sword of Feast and Famine', 'Tinder Wall']) {
      expect(isRampByTags(hasOf(n))).toBe(false);
    }
  });

  it('is false for an untagged card', () => {
    expect(isRampByTags(hasOf('Grizzly Bears'))).toBe(false);
  });
});

describe('createTagLookup reads the shared ramp rule', () => {
  // Invert name → tags into the tagger's tag → names shape.
  const byTag: Record<string, string[]> = {};
  for (const [name, tags] of Object.entries(TAGS)) {
    for (const t of tags) (byTag[t] ??= []).push(name);
  }
  const lookup = createTagLookup(byTag);

  it('gives incidental ramp its other role, or none', () => {
    expect(lookup.getCardRole('Mana Drain')).toBe('removal'); // E486: counterspells are removal
    expect(lookup.getCardRole('Sword of Feast and Famine')).toBeNull();
    expect(lookup.getCardRole('Tinder Wall')).toBe('removal');
    expect(lookup.getCardRole('Mina and Denn, Wildborn')).toBe('ramp');
  });

  it('counts a counterspell as interaction once, through the removal role', () => {
    // Callers build roleCounts from getCardRole (backend ai/bracket.ts does);
    // the role-less-counterspell set must not count it a second time.
    const roleCounts = { removal: 0, ramp: 0, boardwipe: 0, cardDraw: 0 };
    roleCounts[lookup.getCardRole('Mana Drain')!]++;
    const r = estimateBracket(['Mana Drain'], [], 3, undefined, roleCounts, new Set(), lookup);
    expect(r.breakdown.interactionCount).toBe(1);
  });
});

describe('isRemovalByTags (E486)', () => {
  const has = (tags: string[]) => (tag: string) => tags.includes(tag);

  it('folds counterspells into removal', () => {
    expect(isRemovalByTags(has(['counterspell']))).toBe(true);
    expect(isRemovalByTags(has(['removal', 'spot-removal']))).toBe(true);
  });

  it('does not fold bounce alone', () => {
    expect(isRemovalByTags(has(['ramp', 'bounce']))).toBe(false);
  });
});
