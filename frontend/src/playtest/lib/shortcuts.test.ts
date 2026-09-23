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

/**
 * The map this table is expected to ship, key → shortcut id.
 *
 * This is the guard for the whole keyboard program: the defaults are
 * EDHPlay's map, and "EDHPlay's map" is a claim that has to be checkable,
 * not a comment somebody has to trust. Changing a default here is a
 * deliberate edit to this table, in the same commit as the change.
 *
 * Shortcuts that ship unbound on purpose (`''`) are listed in UNBOUND below
 * rather than omitted, so turning one on by accident fails too.
 */
const EXPECTED: Record<string, string> = {
  // Global
  space: 'pass-turn',
  d: 'draw',
  u: 'untap-all',
  '=': 'size-up',
  '-': 'size-down',
  plus: 'counter-plus',
  _: 'counter-minus',
  m: 'mana',
  q: 'advance-phase',
  arrowup: 'life-up',
  arrowdown: 'life-down',
  c: 'log',
  s: 'shuffle',
  v: 'view-library',
  p: 'scry',
  'shift+p': 'scry-bottom',
  o: 'dice',
  n: 'token',
  i: 'shortcuts',
  escape: 'menu',
  'mod+a': 'select-all',
  // Displaced by the map above, rehomed to the shifted/modified same letter
  'shift+n': 'next-turn',
  'mod+z': 'undo',
  // The card in view
  t: 'tap-selection',
  f: 'transform',
  z: 'face-down',
  x: 'clone',
  r: 'reveal',
  h: 'to-hand',
  g: 'to-graveyard',
  e: 'to-exile',
  a: 'to-battlefield',
  l: 'to-library-top',
  b: 'to-library-bottom',
  w: 'arrow',
  k: 'stack-add',
  'shift+k': 'stack-copy',
  j: 'counters',
  'mod+c': 'copy',
  'mod+v': 'paste',
  // Counters and power
  'mod+1': 'counters-all-inc',
  'mod+2': 'counters-all-double',
  'mod+3': 'counters-all-dec',
  'alt+1': 'power-inc',
  'alt+2': 'toughness-inc',
  'alt+3': 'power-dec',
  'alt+4': 'toughness-dec',
  // Players and reactions
  '1': 'focus-1',
  '2': 'focus-2',
  '3': 'focus-3',
  '4': 'focus-4',
  '5': 'focus-5',
  '6': 'focus-6',
  '7': 'react-1',
  '8': 'react-2',
  '9': 'react-3',
  '0': 'react-4',
};

/** Shipped with no key, reachable from the sheet and the menus. */
const UNBOUND = [
  'arrows-clear',
  'toggle-layout',
  'view-top-card',
  'view-bottom-card',
  'stack-resolve',
];

describe('the binding table', () => {
  it('binds every default key to exactly one shortcut', () => {
    const seen = new Map<string, string>();
    for (const def of SHORTCUTS) {
      // `''` is "off", not a key — several shortcuts legitimately share it.
      if (def.key === '') continue;
      expect(seen.get(def.key), `${def.key} is both ${seen.get(def.key)} and ${def.id}`).toBe(
        undefined
      );
      seen.set(def.key, def.id);
    }
  });

  it('ships the expected default for every key in the map', () => {
    const b = resolveBindings({});
    for (const [chord, id] of Object.entries(EXPECTED)) {
      expect(b[id as keyof typeof b], `${id} should be on ${chord}`).toBe(chord);
    }
  });

  it('leaves the deliberately-unbound shortcuts unbound', () => {
    const b = resolveBindings({});
    for (const id of UNBOUND) {
      expect(b[id as keyof typeof b], `${id} should ship with no key`).toBe('');
    }
  });

  it('accounts for every shortcut — nothing bound without being expected', () => {
    const accounted = new Set([...Object.values(EXPECTED), ...UNBOUND]);
    const missing = SHORTCUTS.filter((d) => !accounted.has(d.id)).map((d) => d.id);
    expect(missing, 'add these to EXPECTED or UNBOUND above').toEqual([]);
  });

  it('every shortcut has a group the sheet renders', () => {
    const groups = new Set(['global', 'card', 'counters', 'players', 'reactions']);
    for (const def of SHORTCUTS) {
      expect(groups.has(def.group), `${def.id} is in unknown group ${def.group}`).toBe(true);
    }
  });

  it('only optional shortcuts may ship unbound — a required one must have a key', () => {
    for (const def of SHORTCUTS) {
      if (def.key === '') {
        expect(def.optional, `${def.id} ships unbound but is not optional`).toBe(true);
      }
    }
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
    const { next } = rebind({}, 'draw', 'y');
    expect(next).toEqual({ draw: 'y' });
    expect(rebind(next, 'draw', 'd').next).toEqual({});
  });

  it('moves a required shortcut off a taken key back to its default, and names it', () => {
    const { next, displaced } = rebind({ draw: 'y' }, 'shuffle', 'y');
    expect(displaced).toBe('draw');
    expect(next).toEqual({ shuffle: 'y' });
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
