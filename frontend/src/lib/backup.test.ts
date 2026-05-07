import { describe, it, expect } from 'vitest';
import { BACKUP_FORMAT, BACKUP_VERSION, buildBackup, parseBackup } from './backup';

describe('buildBackup', () => {
  it('stamps format, version, and timestamp', () => {
    const before = Date.now();
    const b = buildBackup(null, []);
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.version).toBe(BACKUP_VERSION);
    expect(b.exportedAt).toBeGreaterThanOrEqual(before);
    expect(b.collection).toBeNull();
    expect(b.binders).toEqual([]);
  });
});

describe('parseBackup', () => {
  it('round-trips a valid backup', () => {
    const original = buildBackup(null, []);
    const parsed = parseBackup(JSON.stringify(original));
    expect(parsed).toEqual(original);
  });

  it('rejects non-JSON input', () => {
    expect(() => parseBackup('not json')).toThrow(/JSON/);
  });

  it('rejects missing format marker', () => {
    expect(() => parseBackup(JSON.stringify({ version: 1, binders: [] }))).toThrow(
      /MTG Binder Planner backup/
    );
  });

  it('rejects mismatched format string', () => {
    expect(() =>
      parseBackup(JSON.stringify({ format: 'something-else', version: 1, binders: [] }))
    ).toThrow(/MTG Binder Planner backup/);
  });

  it('rejects newer-than-supported version', () => {
    expect(() =>
      parseBackup(
        JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 1, binders: [] })
      )
    ).toThrow(/newer version/);
  });

  it('rejects malformed collection', () => {
    expect(() =>
      parseBackup(
        JSON.stringify({
          format: BACKUP_FORMAT,
          version: BACKUP_VERSION,
          binders: [],
          collection: { cards: 'not-an-array' },
        })
      )
    ).toThrow(/malformed/);
  });

  it('coerces missing binders to empty array', () => {
    const parsed = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION }));
    expect(parsed.binders).toEqual([]);
    expect(parsed.collection).toBeNull();
  });

  it('preserves a collection payload', () => {
    const collection = {
      fileName: 'test.csv',
      cards: [],
      scryfallHits: 5,
      scryfallMisses: 1,
      uploadedAt: 1700000000000,
      importHistory: [],
    };
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        binders: [],
        collection,
      })
    );
    expect(parsed.collection).toEqual(collection);
  });
});
