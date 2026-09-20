import { logger } from '@/lib/logger';

/**
 * Keyboard shortcuts for the table — the binding table, its persistence, and
 * the key normaliser the board's one keydown handler dispatches through.
 *
 * Every shortcut has an id the board maps to a handler, a default key, and a
 * home in the sheet. The defaults are EDHPlay's map: a player arriving from
 * that table finds every key where they left it. Where that displaced a key
 * this board already taught (N was Next turn, K was the token maker, Z was
 * the take-back), the displaced action moved to the shifted or modified form
 * of the same letter rather than to some unrelated key — Shift+N, Ctrl+Z.
 *
 * A key is a string like `d`, `space`, `arrowup`, `shift+p`, `mod+a` — one
 * chord, modifiers first, `mod` meaning Ctrl on Windows/Linux and ⌘ on a Mac.
 * Rebinding stores only the overrides, so a new default reaches everyone who
 * never touched that shortcut.
 *
 * ⚠️ `mod+1`/`mod+2`/`mod+3` (the bulk counter steps) are Chrome's own
 * tab-switching chords and a page cannot always take them back. They are the
 * keys EDHPlay uses and the sheet rebinds them like any other, so they stay
 * the defaults — but a browser that keeps them is expected, not a bug.
 */

export type ShortcutGroup = 'turn' | 'table' | 'stack' | 'card' | 'counters' | 'players' | 'view';

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
  | 'view-library'
  | 'scry'
  | 'scry-bottom'
  | 'view-top-card'
  | 'view-bottom-card'
  | 'dice'
  | 'token'
  | 'mana'
  | 'log'
  | 'undo'
  | 'stack-add'
  | 'stack-copy'
  | 'stack-resolve'
  | 'select-all'
  | 'tap-selection'
  | 'copy'
  | 'paste'
  | 'clone'
  | 'transform'
  | 'face-down'
  | 'reveal'
  | 'to-battlefield'
  | 'to-hand'
  | 'to-graveyard'
  | 'to-exile'
  | 'to-library-top'
  | 'to-library-bottom'
  | 'counters'
  | 'counter-plus'
  | 'counter-minus'
  | 'size-up'
  | 'size-down'
  | 'counters-all-inc'
  | 'counters-all-double'
  | 'counters-all-dec'
  | 'power-inc'
  | 'toughness-inc'
  | 'power-dec'
  | 'toughness-dec'
  | 'focus-1'
  | 'focus-2'
  | 'focus-3'
  | 'focus-4'
  | 'focus-5'
  | 'focus-6'
  | 'react-1'
  | 'react-2'
  | 'react-3'
  | 'react-4'
  | 'arrow'
  | 'arrows-clear'
  | 'toggle-layout'
  | 'shortcuts'
  | 'menu';

export const SHORTCUT_GROUP_LABEL: Record<ShortcutGroup, string> = {
  turn: 'Your turn',
  table: 'The table',
  stack: 'The stack',
  card: 'The card in view',
  counters: 'Counters and power',
  players: 'Players',
  view: 'View',
};

/**
 * What "the card in view" means, printed once at the top of its section: the
 * selection when there is one, otherwise whatever the pointer is resting on.
 * One sentence, because it is the single rule that makes half this table
 * make sense.
 */
export const CARD_GROUP_HELP =
  'These act on your selection. With nothing selected, they act on the card under the pointer.';

export const SHORTCUTS: readonly ShortcutDef[] = [
  // ── Your turn ─────────────────────────────────────────────────────────
  { id: 'pass-turn', key: 'space', label: 'Pass turn (online)', group: 'turn' },
  { id: 'advance-phase', key: 'q', label: 'Advance phase (online)', group: 'turn' },
  { id: 'next-turn', key: 'shift+n', label: 'Next turn', group: 'turn' },
  { id: 'draw', key: 'd', label: 'Draw a card', group: 'turn' },
  { id: 'untap-all', key: 'u', label: 'Untap all', group: 'turn' },
  { id: 'life-up', key: 'arrowup', label: 'Life +1', group: 'turn' },
  { id: 'life-down', key: 'arrowdown', label: 'Life −1', group: 'turn' },

  // ── The table ─────────────────────────────────────────────────────────
  { id: 'shuffle', key: 's', label: 'Shuffle library', group: 'table' },
  { id: 'view-library', key: 'v', label: 'View the library', group: 'table' },
  { id: 'scry', key: 'p', label: 'Look at the top cards', group: 'table' },
  { id: 'scry-bottom', key: 'shift+p', label: 'Look at the bottom cards', group: 'table' },
  {
    id: 'view-top-card',
    key: '',
    label: 'View the top card of the library',
    group: 'table',
    optional: true,
  },
  {
    id: 'view-bottom-card',
    key: '',
    label: 'View the bottom card of the library',
    group: 'table',
    optional: true,
  },
  { id: 'size-up', key: '=', label: 'Bigger cards', group: 'table' },
  { id: 'size-down', key: '-', label: 'Smaller cards', group: 'table' },
  { id: 'dice', key: 'o', label: 'Roll dice or flip a coin', group: 'table' },
  { id: 'token', key: 'n', label: 'Create a token', group: 'table' },
  { id: 'mana', key: 'm', label: 'Show or hide the mana pool', group: 'table' },
  { id: 'log', key: 'c', label: 'Open the log and chat', group: 'table' },
  { id: 'undo', key: 'mod+z', label: 'Undo (take back)', group: 'table' },

  // ── The stack ─────────────────────────────────────────────────────────
  { id: 'stack-add', key: 'k', label: 'Put it on the stack', group: 'stack' },
  { id: 'stack-copy', key: 'shift+k', label: 'Copy it onto the stack', group: 'stack' },
  {
    id: 'stack-resolve',
    key: '',
    label: 'Resolve the top of the stack',
    group: 'stack',
    optional: true,
  },

  // ── The card in view ──────────────────────────────────────────────────
  { id: 'tap-selection', key: 't', label: 'Tap or untap', group: 'card' },
  { id: 'transform', key: 'f', label: 'Flip (double-faced cards)', group: 'card' },
  { id: 'face-down', key: 'z', label: 'Turn face down or face up', group: 'card' },
  { id: 'clone', key: 'x', label: 'Make a token copy', group: 'card' },
  { id: 'reveal', key: 'r', label: 'Reveal it from your hand', group: 'card' },
  { id: 'to-battlefield', key: 'a', label: 'Move to the battlefield', group: 'card' },
  { id: 'to-hand', key: 'h', label: 'Move to hand', group: 'card' },
  { id: 'to-graveyard', key: 'g', label: 'Move to graveyard', group: 'card' },
  { id: 'to-exile', key: 'e', label: 'Move to exile', group: 'card' },
  { id: 'to-library-top', key: 'l', label: 'Move to top of library', group: 'card' },
  { id: 'to-library-bottom', key: 'b', label: 'Move to bottom of library', group: 'card' },
  { id: 'arrow', key: 'w', label: 'Draw an arrow from it (online)', group: 'card' },
  {
    id: 'arrows-clear',
    key: '',
    label: 'Remove every arrow you drew (online)',
    group: 'card',
    optional: true,
  },
  { id: 'select-all', key: 'mod+a', label: 'Select every card on the battlefield', group: 'card' },
  { id: 'copy', key: 'mod+c', label: 'Copy', group: 'card' },
  { id: 'paste', key: 'mod+v', label: 'Paste as token copies', group: 'card' },

  // ── Counters and power ────────────────────────────────────────────────
  { id: 'counters', key: 'j', label: 'Open counters', group: 'counters' },
  // `plus`, not `+`: the chord separator IS `+`, so the bare character
  // cannot be a key name without `+`.split('+') tearing it in half.
  { id: 'counter-plus', key: 'plus', label: 'Add a +1/+1 counter', group: 'counters' },
  { id: 'counter-minus', key: '_', label: 'Add a −1/−1 counter', group: 'counters' },
  { id: 'counters-all-inc', key: 'mod+1', label: 'Add one to every counter', group: 'counters' },
  { id: 'counters-all-double', key: 'mod+2', label: 'Double every counter', group: 'counters' },
  { id: 'counters-all-dec', key: 'mod+3', label: 'Take one off every counter', group: 'counters' },
  { id: 'power-inc', key: 'alt+1', label: 'Power +1', group: 'counters' },
  { id: 'toughness-inc', key: 'alt+2', label: 'Toughness +1', group: 'counters' },
  { id: 'power-dec', key: 'alt+3', label: 'Power −1', group: 'counters' },
  { id: 'toughness-dec', key: 'alt+4', label: 'Toughness −1', group: 'counters' },

  // ── Players ───────────────────────────────────────────────────────────
  ...([1, 2, 3, 4, 5, 6] as const).map(
    (n) =>
      ({
        id: `focus-${n}`,
        key: String(n),
        label: `Look at player ${n}’s board (online)`,
        group: 'players',
        optional: true,
      }) as ShortcutDef
  ),
  { id: 'react-1', key: '7', label: 'React: thumbs up (online)', group: 'players', optional: true },
  { id: 'react-2', key: '8', label: 'React: thinking (online)', group: 'players', optional: true },
  { id: 'react-3', key: '9', label: 'React: wow (online)', group: 'players', optional: true },
  { id: 'react-4', key: '0', label: 'React: crying (online)', group: 'players', optional: true },

  // ── View ──────────────────────────────────────────────────────────────
  {
    id: 'toggle-layout',
    key: '',
    label: 'Switch between the seat grid and the rail',
    group: 'view',
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
  // Shift is part of the chord for letters (`shift+w` is its own key) and
  // for named keys, but not for punctuation that already changes with it: a
  // typed `?` is its own key, so `shift+/` would never match what people press.
  if (e.shiftKey && (raw.length !== 1 || /[a-z]/i.test(raw))) parts.push('shift');
  // `space` and `plus` are named for the same reason: one is unprintable and
  // the other is the separator this very string is joined with.
  parts.push(key === ' ' ? 'space' : key === '+' ? 'plus' : key);
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
        case 'plus':
          return '+';
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
          if (part.length <= 1) return part.toUpperCase();
          return part[0].toUpperCase() + part.slice(1);
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
