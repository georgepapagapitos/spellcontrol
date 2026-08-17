import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { getTagLookup, __resetTagLookup } from './tags';

/**
 * The behaviour worth pinning is the ABSENCE case. Every `TagLookup` predicate
 * answers `false`/`null` on a miss, so a lookup built over missing data claims
 * no deck has mass land denial, extra turns or roles — and the bracket that
 * comes back is confidently too low. `null` (tool not offered) and an empty
 * lookup (tool offered, lying) are the two outcomes that must never be confused.
 */

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-tags-test-'));
  cwd = dir;
  vi.spyOn(process, 'cwd').mockImplementation(() => cwd);
  __resetTagLookup();
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetTagLookup();
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeTags(contents: unknown, where = 'public') {
  fs.mkdirSync(path.join(dir, where), { recursive: true });
  fs.writeFileSync(path.join(dir, where, 'tagger-tags.json'), JSON.stringify(contents));
}

describe('getTagLookup', () => {
  it('returns null when the data is absent — never an empty lookup', () => {
    expect(getTagLookup()).toBeNull();
  });

  it('returns null when the file exists but carries no tags', () => {
    writeTags({ generatedAt: 'now', tags: {} });
    expect(getTagLookup()).toBeNull();
  });

  it('returns null when the file is not valid JSON', () => {
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'public', 'tagger-tags.json'), '{ not json');
    expect(getTagLookup()).toBeNull();
  });

  it('loads from the image path (backend/public) — where the Dockerfile puts it', () => {
    writeTags({ tags: { 'mass-land-denial': ['Armageddon'] } });
    const tags = getTagLookup();
    expect(tags).not.toBeNull();
    expect(tags!.isMassLandDenial('Armageddon')).toBe(true);
    expect(tags!.isMassLandDenial('Forest')).toBe(false);
  });

  it('falls back to the frontend source copy in a dev checkout', () => {
    // No backend/public here — only ../frontend/public, as in a plain clone.
    fs.mkdirSync(path.join(dir, '..', 'frontend', 'public'), { recursive: true });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-tags-repo-'));
    fs.mkdirSync(path.join(outside, 'backend'), { recursive: true });
    fs.mkdirSync(path.join(outside, 'frontend', 'public'), { recursive: true });
    fs.writeFileSync(
      path.join(outside, 'frontend', 'public', 'tagger-tags.json'),
      JSON.stringify({ tags: { 'extra-turn': ['Time Warp'] } })
    );
    cwd = path.join(outside, 'backend');
    __resetTagLookup();

    const tags = getTagLookup();
    expect(tags).not.toBeNull();
    expect(tags!.isExtraTurn('Time Warp')).toBe(true);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('memoises, so a 1MB parse does not repeat per request', () => {
    writeTags({ tags: { ramp: ['Cultivate'] } });
    const first = getTagLookup();
    // Removing the file must not change the answer — proof it was not re-read.
    fs.rmSync(path.join(dir, 'public', 'tagger-tags.json'));
    expect(getTagLookup()).toBe(first);
  });

  it('memoises the FAILURE too — a missing asset stays missing', () => {
    expect(getTagLookup()).toBeNull();
    writeTags({ tags: { ramp: ['Cultivate'] } });
    expect(getTagLookup()).toBeNull();
  });
});
