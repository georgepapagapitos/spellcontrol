import { describe, it, expect } from 'vitest';
import type { EnrichedCard, SubCollectionDef } from '../types';
import {
  MAX_SUBCOLLECTION_NAME,
  clampSubCollectionName,
  assignSubCollection,
  buildSubCollectionKeyMap,
  restoreSubCollectionAssignments,
  resolveSubCollectionId,
} from './sub-collections';

function card(
  copyId: string,
  scryfallId: string,
  finish: 'nonfoil' | 'foil' = 'nonfoil'
): EnrichedCard {
  return { copyId, scryfallId, finish, name: scryfallId, foil: finish === 'foil' } as EnrichedCard;
}

describe('clampSubCollectionName', () => {
  it('trims whitespace', () => {
    expect(clampSubCollectionName('  Bulk  ')).toBe('Bulk');
  });
  it('clamps to the max length', () => {
    const long = 'x'.repeat(MAX_SUBCOLLECTION_NAME + 10);
    expect(clampSubCollectionName(long)).toHaveLength(MAX_SUBCOLLECTION_NAME);
  });
});

describe('assignSubCollection', () => {
  it('sets id and the durable key when assigning', () => {
    const out = assignSubCollection(card('c1', 'sf1', 'foil'), 'sc1');
    expect(out.subCollectionId).toBe('sc1');
    expect(out.subCollectionKey).toBe('sf1:foil');
  });
  it('clears both fields when assigning null (move to Main)', () => {
    const assigned = assignSubCollection(card('c1', 'sf1'), 'sc1');
    const cleared = assignSubCollection(assigned, null);
    expect(cleared.subCollectionId).toBeUndefined();
    expect(cleared.subCollectionKey).toBeUndefined();
  });
  it('does not mutate the input', () => {
    const input = card('c1', 'sf1');
    assignSubCollection(input, 'sc1');
    expect(input.subCollectionId).toBeUndefined();
  });
});

describe('restoreSubCollectionAssignments', () => {
  it('restores assignment onto a fresh copy with the same printing+finish', () => {
    const prev = [assignSubCollection(card('old', 'sf1', 'foil'), 'sc1')];
    const next = [card('new', 'sf1', 'foil')];
    const restored = restoreSubCollectionAssignments(next, prev);
    expect(restored[0].subCollectionId).toBe('sc1');
    expect(restored[0].subCollectionKey).toBe('sf1:foil');
  });
  it('leaves brand-new cards (no prior key) in Main', () => {
    const prev = [assignSubCollection(card('old', 'sf1'), 'sc1')];
    const next = [card('new2', 'sfDIFFERENT')];
    const restored = restoreSubCollectionAssignments(next, prev);
    expect(restored[0].subCollectionId).toBeUndefined();
  });
  it('restores by count when multiple copies share a key (best-effort)', () => {
    const prev = [assignSubCollection(card('o1', 'sf1'), 'sc1'), card('o2', 'sf1')];
    const next = [card('n1', 'sf1'), card('n2', 'sf1')];
    const restored = restoreSubCollectionAssignments(next, prev);
    const assigned = restored.filter((c) => c.subCollectionId === 'sc1');
    expect(assigned).toHaveLength(1);
  });
  it('does not overwrite an explicit assignment already on the new card', () => {
    const prev = [assignSubCollection(card('o1', 'sf1'), 'sc1')];
    const next = [assignSubCollection(card('n1', 'sf1'), 'sc2')];
    const restored = restoreSubCollectionAssignments(next, prev);
    expect(restored[0].subCollectionId).toBe('sc2');
  });
});

describe('buildSubCollectionKeyMap', () => {
  it('maps assigned keys to their id with multiplicity', () => {
    const map = buildSubCollectionKeyMap([
      assignSubCollection(card('o1', 'sf1'), 'sc1'),
      assignSubCollection(card('o2', 'sf1'), 'sc1'),
      assignSubCollection(card('o3', 'sf2', 'foil'), 'sc2'),
    ]);
    expect(map.get('sf1:nonfoil')).toEqual({ id: 'sc1', count: 2 });
    expect(map.get('sf2:foil')).toEqual({ id: 'sc2', count: 1 });
  });
  it('ignores cards without a subCollectionId', () => {
    const map = buildSubCollectionKeyMap([card('o1', 'sf1')]);
    expect(map.size).toBe(0);
  });
});

describe('resolveSubCollectionId', () => {
  const defs: SubCollectionDef[] = [{ id: 'sc1', name: 'Bulk', order: 0 }];
  it('returns the id when it resolves to a def', () => {
    expect(resolveSubCollectionId('sc1', defs)).toBe('sc1');
  });
  it('returns undefined (Main) for an unknown id', () => {
    expect(resolveSubCollectionId('ghost', defs)).toBeUndefined();
  });
  it('returns undefined for undefined input', () => {
    expect(resolveSubCollectionId(undefined, defs)).toBeUndefined();
  });
});
