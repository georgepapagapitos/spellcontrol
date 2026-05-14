import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { PhashStore, type HashEntry } from './phash-store';

function entry(id: string, hashBytes: number[]): HashEntry {
  return {
    scryfallId: id,
    name: `Card ${id}`,
    setCode: 'TST',
    collectorNumber: '1',
    hash: new Uint8Array(hashBytes),
  };
}

let dir: string;
let store: PhashStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phash-store-test-'));
  store = new PhashStore(path.join(dir, 'sub', 'phash.db'));
});

afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('PhashStore', () => {
  it('starts empty and reports size 0', () => {
    expect(store.size()).toBe(0);
    expect(store.search(new Uint8Array(8))).toEqual([]);
  });

  it('round-trips an entry and finds it by exact hash', () => {
    const e = entry('a', [1, 2, 3, 4, 5, 6, 7, 8]);
    store.upsertMany([e]);
    expect(store.size()).toBe(1);
    const [match] = store.search(e.hash, 1);
    expect(match.entry.scryfallId).toBe('a');
    expect(match.distance).toBe(0);
  });

  it('returns the K nearest matches in ascending distance', () => {
    store.upsertMany([
      entry('zero', [0, 0, 0, 0, 0, 0, 0, 0]),
      entry('one-bit', [1, 0, 0, 0, 0, 0, 0, 0]),
      entry('two-bits', [3, 0, 0, 0, 0, 0, 0, 0]),
      entry('many', [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    ]);
    const results = store.search(new Uint8Array(8), 3);
    expect(results.map((r) => r.entry.scryfallId)).toEqual(['zero', 'one-bit', 'two-bits']);
    expect(results.map((r) => r.distance)).toEqual([0, 1, 2]);
  });

  it('persists across reopen and reloadIntoMemory', () => {
    const e = entry('persist', [9, 9, 9, 9, 9, 9, 9, 9]);
    store.upsertMany([e]);
    const dbPath = path.join(dir, 'sub', 'phash.db');
    store.close();

    const reopened = new PhashStore(dbPath);
    expect(reopened.size()).toBe(1);
    const [match] = reopened.search(e.hash, 1);
    expect(match.entry.scryfallId).toBe('persist');
    reopened.close();
  });

  it('upsert overwrites by scryfall_id', () => {
    store.upsertMany([entry('dup', [0, 0, 0, 0, 0, 0, 0, 0])]);
    store.upsertMany([
      {
        ...entry('dup', [0xff, 0, 0, 0, 0, 0, 0, 0]),
        name: 'Renamed',
      },
    ]);
    store.reloadIntoMemory();
    expect(store.size()).toBe(1);
    const [match] = store.search(new Uint8Array([0xff, 0, 0, 0, 0, 0, 0, 0]), 1);
    expect(match.entry.name).toBe('Renamed');
    expect(match.distance).toBe(0);
  });

  it('ignores hashes with the wrong byte length', () => {
    store.upsertMany([
      { ...entry('bad', [1, 2, 3]), hash: new Uint8Array(3) },
      entry('good', [1, 2, 3, 4, 5, 6, 7, 8]),
    ]);
    store.reloadIntoMemory();
    expect(store.size()).toBe(1);
  });

  it('rejects a query of the wrong length', () => {
    store.upsertMany([entry('a', [1, 2, 3, 4, 5, 6, 7, 8])]);
    expect(store.search(new Uint8Array(7), 1)).toEqual([]);
  });
});
