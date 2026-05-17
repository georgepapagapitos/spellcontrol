import { describe, it, expect } from 'vitest';
import {
  MAX_STAGED_FILES,
  uniqueFileName,
  mergeStagedFiles,
  stagedFilesNotice,
  stripExtension,
} from './staged-files';

function file(name: string): File {
  return new File(['x'], name, { type: 'text/csv' });
}

describe('uniqueFileName', () => {
  it('returns the name unchanged when free', () => {
    expect(uniqueFileName('deck.csv', new Set())).toBe('deck.csv');
  });

  it('suffixes the next available index on collision', () => {
    const taken = new Set(['deck.csv', 'deck (1).csv']);
    expect(uniqueFileName('deck.csv', taken)).toBe('deck (2).csv');
  });

  it('handles names without an extension', () => {
    expect(uniqueFileName('deck', new Set(['deck']))).toBe('deck (1)');
  });
});

describe('mergeStagedFiles', () => {
  it('appends onto existing files', () => {
    const { files, renamed, dropped } = mergeStagedFiles([file('a.csv')], [file('b.csv')]);
    expect(files.map((f) => f.name)).toEqual(['a.csv', 'b.csv']);
    expect(renamed).toBe(0);
    expect(dropped).toBe(0);
  });

  it('renames duplicates as copies and reports the count', () => {
    const { files, renamed } = mergeStagedFiles([file('a.csv')], [file('a.csv'), file('a.csv')]);
    expect(files.map((f) => f.name)).toEqual(['a.csv', 'a (1).csv', 'a (2).csv']);
    expect(renamed).toBe(2);
  });

  it('caps the total and reports the dropped count', () => {
    const existing = Array.from({ length: MAX_STAGED_FILES }, (_, i) => file(`f${i}.csv`));
    const { files, dropped } = mergeStagedFiles(existing, [file('extra.csv')]);
    expect(files).toHaveLength(MAX_STAGED_FILES);
    expect(dropped).toBe(1);
  });
});

describe('stagedFilesNotice', () => {
  it('is null when nothing renamed or dropped', () => {
    expect(stagedFilesNotice(0, 0)).toBeNull();
  });

  it('mentions renamed and dropped counts', () => {
    const msg = stagedFilesNotice(1, 2);
    expect(msg).toContain('1 file had a duplicate name');
    expect(msg).toContain('2 files skipped');
  });
});

describe('stripExtension', () => {
  it('drops a trailing extension', () => {
    expect(stripExtension('mono blue terror.csv')).toBe('mono blue terror');
  });

  it('leaves dotless names intact', () => {
    expect(stripExtension('deck')).toBe('deck');
  });
});
