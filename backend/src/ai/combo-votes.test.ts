import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { getComboVotes, __resetComboVotes } from './combo-votes';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-combo-votes-test-'));
  vi.spyOn(process, 'cwd').mockImplementation(() => dir);
  __resetComboVotes();
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetComboVotes();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('getComboVotes', () => {
  it('is undefined when the data is absent, so every combo reads as unvoted', () => {
    expect(getComboVotes()).toBeUndefined();
  });

  it('is undefined when the file is not valid JSON', () => {
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'public', 'combo-votes.json'), '{ nope');
    expect(getComboVotes()).toBeUndefined();
  });

  it('reads the image layout (public/ beside the server)', () => {
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'public', 'combo-votes.json'),
      JSON.stringify({ early: ['690-3966'], late: ['1561-2498'] })
    );
    const votes = getComboVotes();
    expect(votes?.get('690-3966')).toBe('early');
    expect(votes?.get('1561-2498')).toBe('late');
  });

  it('finds the committed snapshot from a dev checkout (../frontend/public)', () => {
    const real = path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'combo-votes.json');
    const dev = path.join(dir, 'backend');
    fs.mkdirSync(dev);
    fs.mkdirSync(path.join(dir, 'frontend', 'public'), { recursive: true });
    fs.copyFileSync(real, path.join(dir, 'frontend', 'public', 'combo-votes.json'));
    vi.spyOn(process, 'cwd').mockImplementation(() => dev);
    expect(getComboVotes()?.get('690-3966')).toBe('early');
  });
});
