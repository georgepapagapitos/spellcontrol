import { logger } from '@/lib/logger';

/**
 * Keyboard shortcuts for the table — the binding table, its persistence, and
 * the key normaliser the board's one keydown handler dispatches through.
 *
 * Every shortcut has an id the board maps to a handler, a default key, and a
 * home in the sheet. Defaults follow EDHPlay where they don't fight what the
 * board already taught people (D draw, N next turn, U untap, Z undo, T tap
 * the selection, K token, M mana): a player coming from that table finds the
 * same keys, and a player already here loses none.
 *
 * A key is a string like `d`, `space`, `arrowup`, `shift+p`, `mod+a` — one
 * chord, modifiers first, `mod` meaning Ctrl on Windows/Linux and ⌘ on a Mac.
 * Rebinding stores only the overrides, so a new default reaches everyone who
 * never touched that shortcut.
 */

export type ShortcutGroup = 'turn' | 'table' | 'selection' | 'players' | 'view';

export interface ShortcutDef {
  id: ShortcutId;
  key: string;
  label: string;
  group: ShortcutGroup;
  /** Rebindable to nothing. A required shortcut can only be moved. */
  optional?: boolean;
}

export type ShortcutId =
  | 'pass-turn'
  | 'draw'
  | 'untap-all'
  | 'next-turn'
  | 'advance-phase'
  | 'life-up'
  | 'life-down'
  | 'shuffle'
  | 'scry'
  | 'dice'
  | 'token'
  | 'mana'
  | 'log'
  | 'undo'
  | 'select-all'
  | 'tap-selection'
  | 'copy'
  | 'paste'
  | 'clone'
  | 'transform'
  | 'to-hand'
  | 'to-graveyard'
  | 'to-exile'
  | 'to-library-top'
  | 'to-library-bottom'
  | 'counter-plus'
  | 'counter-minus'
  | 'focus-1'
  | 'focus-2'
  | 'focus-3'
  | 'focus-4'
  | 'focus-5'
  | 'focus-6'
  | 'shortcuts'
  | 'menu';

export const SHORTCUT_GROUP_LABEL: Record<ShortcutGroup, string> = {
  turn: 'Your turn',
  table: 'The table',
  selection: 'Selected cards',
  players: 'Players',
  view: 'View',
};

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'pass-turn', key: 'space', label: 'Pass turn (online)', group: 'turn' },
  { id: 'next-turn', key: 'n', label: 'Next turn', group: 'turn' },
  { id: 'draw', key: 'd', label: 'Draw a card', group: 'turn' },
  { id: 'untap-all', key: 'u', label: 'Untap all', group: 'turn' },
  { id: 'advance-phase', key: 'q', label: 'Advance phase (online)', group: 'turn' },
  { id: 'life-up', key: 'arrowup', label: 'Life +1', group: 'turn' },
  { id: 'life-down', key: 'arrowdown', label: 'Life −1', group: 'turn' },
  { id: 'shuffle', key: 's', label: 'Shuffle library', group: 'table' },
  { id: 'scry', key: 'p', label: 'Look at the top cards', group: 'table' },
  { id: 'dice', key: 'o', label: 'Roll dice or flip a coin', group: 'table' },
  { id: 'token', key: 'k', label: 'Create a token', group: 'table' },
  { id: 'mana', key: 'm', label: 'Show or hide the mana pool', group: 'table' },
  { id: 'log', key: 'c', label: 'Open the log and chat', group: 'table' },
  { id: 'undo', key: 'z', label: 'Undo (take back)', group: 'table' },
  {
    id: 'select-all',
    key: 'mod+a',
    label: 'Select every card on the battlefield',
    group: 'selection',
  },
  { id: 'tap-selection', key: 't', label: 'Tap or untap', group: 'selection' },
  { id: 'clone', key: 'x', label: 'Make a token copy', group: 'selection' },
  { id: 'transform', key: 'f', label: 'Flip (double-faced cards)', group: 'selection' },
  {
    id: 'counter-plus',
    key: '=',
    label: 'Add a +1/+1 counter; with nothing selected, bigger cards',
    group: 'selection',
  },
  {
    id: 'counter-minus',
    key: '-',
    label: 'Add a −1/−1 counter; with nothing selected, smaller cards',
    group: 'selection',
  },
  { id: 'to-hand', key: 'h', label: 'Move to hand', group: 'selection' },
  { id: 'to-graveyard', key: 'g', label: 'Move to graveyard', group: 'selection' },
  { id: 'to-exile', key: 'e', label: 'Move to exile', group: 'selection' },
  { id: 'to-library-top', key: 'l', label: 'Move to top of library', group: 'selection' },
  { id: 'to-library-bottom', key: 'b', label: 'Move to bottom of library', group: 'selection' },
  { id: 'copy', key: 'mod+c', label: 'Copy', group: 'selection' },
  { id: 'paste', key: 'mod+v', label: 'Paste as token copies', group: 'selection' },
  {
    id: 'focus-1',
    key: '1',
    label: 'Look at player 1’s board (online)',
    group: 'players',
    optional: true,
  },
  {
    id: 'focus-2',
    key: '2',
    label: 'Look at player 2’s board (online)',
    group: 'players',
    optional: true,
  },
  {
    id: 'focus-3',
    key: '3',
    label: 'Look at player 3’s board (online)',
    group: 'players',
    optional: true,
  },
  {
    id: 'focus-4',
    key: '4',
    label: 'Look at player 4’s board (online)',
    group: 'players',
    optional: true,
  },
  {
    id: 'focus-5',
    key: '5',
    label: 'Look at player 5’s board (online)',
    group: 'players',
    optional: true,
  },
  {
    id: 'focus-6',
    key: '6',
    label: 'Look at player 6’s board (online)',
    group: 'players',
    optional: true,
  },
  { id: 'shortcuts', key: 'i', label: 'Open this list', group: 'view' },
  { id: 'menu', key: 'escape', label: 'Clear the selection', group: 'view' },
];

const STORAGE_KEY = 'playtest-shortcuts-v1';

/** Overrides only: id → key, or id → '' for an optional shortcut turned off. */
export type ShortcutOverrides = Partial<Record<ShortcutId, string>>;

export function loadOverrides(): ShortcutOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: ShortcutOverrides = {};
    for (const def of SHORTCUTS) {
      const v = (parsed as Record<string, unknown>)[def.id];
      if (typeof v === 'string') out[def.id] = v;
    }
    return out;
  } catch (err) {
    logger.warn('[shortcuts] could not read saved bindings', err);
    return {};
  }
}

export function saveOverrides(overrides: ShortcutOverrides): void {
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch (err) {
    logger.warn('[shortcuts] could not save bindings', err);
  }
}

/** The effective key per shortcut: the default unless overridden. '' = off. */
export function resolveBindings(overrides: ShortcutOverrides): Record<ShortcutId, string> {
  const out = {} as Record<ShortcutId, string>;
  for (const def of SHORTCUTS) out[def.id] = overrides[def.id] ?? def.key;
  return out;
}

/**
 * Assign `key` to `id`. Any other shortcut already on that key is moved off
 * it: a required one goes back to its default, an optional one turns off. A
 * key can only ever mean one thing, and the sheet says which one moved.
 */
export function rebind(
  overrides: ShortcutOverrides,
  id: ShortcutId,
  key: string
): { next: ShortcutOverrides; displaced: ShortcutId | null } {
  const bindings = resolveBindings(overrides);
  const next: ShortcutOverrides = { ...overrides };
  let displaced: ShortcutId | null = null;
  for (const def of SHORTCUTS) {
    if (def.id !== id && bindings[def.id] === key && key !== '') {
      displaced = def.id;
      if (def.optional) next[def.id] = '';
      else if (def.key === key) next[def.id] = '';
      else delete next[def.id];
    }
  }
  const def = SHORTCUTS.find((d) => d.id === id)!;
  if (key === def.key) delete next[id];
  else next[id] = key;
  return { next, displaced };
}

/** The keys the sheet never captures for rebinding — they mean too much elsewhere. */
const RESERVED = new Set([
  'tab',
  'enter',
  'capslock',
  'shift',
  'control',
  'alt',
  'meta',
  'contextmenu',
  'f5',
  'f11',
  'f12',
]);

/**
 * One chord from a keydown event, in the binding table's spelling, or null
 * when the event is a bare modifier or a key the table never binds.
 */
export function chordOf(e: KeyboardEvent): string | null {
  const raw = e.key;
  if (!raw) return null;
  const key = raw.length === 1 ? raw.toLowerCase() : raw.toLowerCase();
  if (RESERVED.has(key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  // Shift matters only for keys that don't already change with it: a typed
  // `?` is its own key, so `shift+/` would never match what people press.
  if (e.shiftKey && raw.length !== 1) parts.push('shift');
  parts.push(key === ' ' ? 'space' : key);
  return parts.join('+');
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** A chord as the sheet shows it: `mod+a` → `⌘ A` on a Mac, `Ctrl A` elsewhere. */
export function formatChord(chord: string): string {
  if (!chord) return 'Not set';
  return chord
    .split('+')
    .map((part) => {
      switch (part) {
        case 'mod':
          return IS_MAC ? '⌘' : 'Ctrl';
        case 'shift':
          return IS_MAC ? '⇧' : 'Shift';
        case 'alt':
          return IS_MAC ? '⌥' : 'Alt';
        case 'space':
          return 'Space';
        case 'escape':
          return 'Esc';
        case 'arrowup':
          return '↑';
        case 'arrowdown':
          return '↓';
        case 'arrowleft':
          return '←';
        case 'arrowright':
          return '→';
        default:
          return part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1);
      }
    })
    .join(' ');
}

/** Which shortcut a keydown asks for, under the given bindings. */
export function shortcutFor(
  e: KeyboardEvent,
  bindings: Record<ShortcutId, string>
): ShortcutId | null {
  const chord = chordOf(e);
  if (chord === null) return null;
  for (const def of SHORTCUTS) if (bindings[def.id] === chord) return def.id;
  return null;
}
