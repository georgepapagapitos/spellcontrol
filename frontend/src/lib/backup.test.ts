// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  buildBackup,
  buildBinderBackup,
  buildAllBindersBackup,
  parseBackup,
  backupFileName,
  binderBackupFileName,
  allBindersBackupFileName,
  downloadBackup,
} from './backup';
import type { BinderDef, EnrichedCard } from '../types';

function card(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'copy-1',
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: 'sf-1',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  };
}

const sampleBinder: BinderDef = {
  id: 'b1',
  name: 'Stuff',
  color: '#aaa',
  pocketSize: 9,
  doubleSided: false,
  fixedCapacity: null,
  filterGroups: [{ filter: {} }],
  sorts: [{ field: 'name', dir: 'asc' }],
  position: 0,
  createdAt: 0,
  updatedAt: 0,
};

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
      /SpellControl backup/
    );
  });

  it('rejects mismatched format string', () => {
    expect(() =>
      parseBackup(JSON.stringify({ format: 'something-else', version: 1, binders: [] }))
    ).toThrow(/SpellControl backup/);
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

describe('buildBinderBackup', () => {
  it('packages a single binder with its cards', () => {
    const cards = [card({ copyId: 'a' }), card({ copyId: 'b' })];
    const b = buildBinderBackup(sampleBinder, cards);
    expect(b.binders).toEqual([sampleBinder]);
    expect(b.collection?.cards).toEqual(cards);
    expect(b.collection?.fileName).toBe('binder-Stuff');
    expect(b.collection?.scryfallHits).toBe(2);
  });
});

describe('buildAllBindersBackup', () => {
  it('packages every binder and the union of cards', () => {
    const cards = [card()];
    const b = buildAllBindersBackup([sampleBinder, sampleBinder], cards);
    expect(b.binders).toHaveLength(2);
    expect(b.collection?.fileName).toBe('all-binders');
  });
});

describe('filename helpers', () => {
  const fixed = new Date('2026-03-04T05:06:00Z');

  it('uses a YYYY-MM-DD-HHMM timestamp', () => {
    expect(backupFileName(fixed)).toMatch(/spellcontrol-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json/);
  });

  it('sanitizes binder names', () => {
    expect(binderBackupFileName('My Cool Binder!', fixed)).toContain('my-cool-binder');
    expect(binderBackupFileName('   ', fixed)).toContain('binder');
  });

  it('emits all-binders filename', () => {
    expect(allBindersBackupFileName(fixed)).toMatch(/^spellcontrol-binders-all-/);
  });
});

describe('parseBackup migrations', () => {
  it('upgrades 18-pocket binders to 9-pocket double-sided', () => {
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        binders: [{ ...sampleBinder, pocketSize: 18, doubleSided: false }],
      })
    );
    expect(parsed.binders[0].pocketSize).toBe(9);
    expect(parsed.binders[0].doubleSided).toBe(true);
  });

  it('upgrades 24-pocket binders to 12-pocket double-sided', () => {
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        binders: [{ ...sampleBinder, pocketSize: 24, doubleSided: false }],
      })
    );
    expect(parsed.binders[0].pocketSize).toBe(12);
    expect(parsed.binders[0].doubleSided).toBe(true);
  });

  it('derives fixedCapacity from legacy fixedPageCount', () => {
    const legacy = { ...sampleBinder, pocketSize: 9, fixedPageCount: 5 };
    delete (legacy as Record<string, unknown>).fixedCapacity;
    const parsed = parseBackup(
      JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, binders: [legacy] })
    );
    expect(parsed.binders[0].fixedCapacity).toBe(45);
    expect(
      (parsed.binders[0] as unknown as Record<string, unknown>).fixedPageCount
    ).toBeUndefined();
  });

  it('assigns missing copyIds to cards', () => {
    const collection = {
      fileName: 'x',
      cards: [{ ...card(), copyId: '' }],
      scryfallHits: 0,
      scryfallMisses: 0,
      uploadedAt: 0,
    };
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        binders: [],
        collection,
      })
    );
    expect(parsed.collection?.cards[0].copyId.length).toBeGreaterThan(0);
  });
});

describe('downloadBackup', () => {
  it('triggers a download via an anchor element', () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') (el as HTMLAnchorElement).click = click;
      return el;
    });
    downloadBackup(buildBackup(null, []), 'out.json');
    expect(click).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    createSpy.mockRestore();
  });
});
