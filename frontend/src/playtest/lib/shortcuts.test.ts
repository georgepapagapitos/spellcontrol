// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  chordOf,
  formatChord,
  loadOverrides,
  rebind,
  resolveBindings,
  saveOverrides,
  shortcutFor,
} from './shortcuts';

function key(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('the binding table', () => {
  it('binds every default key to exactly one shortcut', () => {
    const seen = new Map<string, string>();
    for (const def of SHORTCUTS) {
      expect(seen.get(def.key), `${def.key} is both ${seen.get(def.key)} and ${def.id}`).toBe(
        undefined
      );
      seen.set(def.key, def.id);
    }
  });

  it('keeps the keys the board already taught: D, N, U, Z, T, K, M, Space', () => {
    const b = resolveBindings({});
    expect(b['draw']).toBe('d');
    expect(b['next-turn']).toBe('n');
    expect(b['untap-all']).toBe('u');
    expect(b['undo']).toBe('z');
    expect(b['tap-selection']).toBe('t');
    expect(b['token']).toBe('k');
    expect(b['mana']).toBe('m');
    expect(b['pass-turn']).toBe('space');
  });
});

describe('chordOf', () => {
  it('spells a chord modifiers-first, in the table’s vocabulary', () => {
    expect(chordOf(key({ key: 'd' }))).toBe('d');
    expect(chordOf(key({ key: 'D', shiftKey: true }))).toBe('shift+d');
    expect(chordOf(key({ key: '?', shiftKey: true }))).toBe('?');
    expect(chordOf(key({ key: ' ' }))).toBe('space');
    expect(chordOf(key({ key: 'ArrowUp' }))).toBe('arrowup');
    expect(chordOf(key({ key: 'a', ctrlKey: true }))).toBe('mod+a');
    expect(chordOf(key({ key: 'a', metaKey: true }))).toBe('mod+a');
    expect(chordOf(key({ key: 'ArrowUp', shiftKey: true }))).toBe('shift+arrowup');
    expect(chordOf(key({ key: 'Escape' }))).toBe('escape');
  });

  it('answers null for bare modifiers and reserved keys', () => {
    expect(chordOf(key({ key: 'Shift', shiftKey: true }))).toBeNull();
    expect(chordOf(key({ key: 'Tab' }))).toBeNull();
    expect(chordOf(key({ key: 'F5' }))).toBeNull();
  });
});

describe('shortcutFor', () => {
  it('resolves through overrides, not defaults', () => {
    const b = resolveBindings({ draw: 'j' });
    expect(shortcutFor(key({ key: 'j' }), b)).toBe('draw');
    expect(shortcutFor(key({ key: 'd' }), b)).toBeNull();
  });

  it('an optional shortcut turned off matches nothing', () => {
    const b = resolveBindings({ 'focus-1': '' });
    expect(shortcutFor(key({ key: '1' }), b)).toBeNull();
  });
});

describe('rebind', () => {
  it('records only what differs from the default', () => {
    const { next } = rebind({}, 'draw', 'j');
    expect(next).toEqual({ draw: 'j' });
    expect(rebind(next, 'draw', 'd').next).toEqual({});
  });

  it('moves a required shortcut off a taken key back to its default, and names it', () => {
    const { next, displaced } = rebind({ draw: 'j' }, 'shuffle', 'j');
    expect(displaced).toBe('draw');
    expect(next).toEqual({ shuffle: 'j' });
    expect(resolveBindings(next)['draw']).toBe('d');
  });

  it('turns an optional shortcut off when its key is taken', () => {
    const { next, displaced } = rebind({}, 'draw', '1');
    expect(displaced).toBe('focus-1');
    expect(next).toEqual({ draw: '1', 'focus-1': '' });
  });

  it('a required shortcut whose default key is taken is switched off rather than left doubled', () => {
    const { next } = rebind({}, 'shuffle', 'd');
    expect(resolveBindings(next)['draw']).toBe('');
    expect(resolveBindings(next)['shuffle']).toBe('d');
  });
});

describe('persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips overrides and drops junk', () => {
    saveOverrides({ draw: 'j', 'focus-2': '' });
    expect(loadOverrides()).toEqual({ draw: 'j', 'focus-2': '' });
    localStorage.setItem('playtest-shortcuts-v1', JSON.stringify({ draw: 5, nope: 'x' }));
    expect(loadOverrides()).toEqual({});
    localStorage.setItem('playtest-shortcuts-v1', '{not json');
    expect(loadOverrides()).toEqual({});
  });

  it('an empty override set clears the stored key', () => {
    saveOverrides({ draw: 'j' });
    saveOverrides({});
    expect(localStorage.getItem('playtest-shortcuts-v1')).toBeNull();
  });
});

describe('formatChord', () => {
  it('reads as keys, not as the table’s spelling', () => {
    expect(formatChord('d')).toBe('D');
    expect(formatChord('space')).toBe('Space');
    expect(formatChord('arrowup')).toBe('↑');
    expect(formatChord('escape')).toBe('Esc');
    expect(formatChord('')).toBe('Not set');
    expect(formatChord('mod+a')).toMatch(/^(Ctrl|⌘) A$/);
  });
});
