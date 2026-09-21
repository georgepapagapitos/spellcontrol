/**
 * How your table looks: the felt under the cards.
 *
 * A **per-device preference**, the same class of thing as card size and the
 * takeback rule — not table-wide `GameState` like the mulligan rule or the
 * turn timer. Opponents see the board you publish, never your CSS, so there
 * is nothing here for a pod to agree on: it is your table, the way you like
 * looking at it.
 *
 * Applied as `data-felt` on `<body>` rather than on the board element,
 * because the felt vars are read by surfaces that portal out of the board
 * tree. The CSS lives in `styles/playtest.css` beside the felt rules it
 * overrides — and note that the DEFAULTS must be declared on `body` alone:
 * a custom property resolves from the nearest declaring ancestor, so
 * re-declaring them on `.playtest-page` (as they once were) puts a reset
 * between `body[data-felt]` and the felt, and the setting does nothing.
 */

export interface SkinOption {
  id: string;
  label: string;
  /** The colour the picker's swatch shows. */
  swatch: string;
}

/** `theme` is the default: the felt follows whichever theme the app is in. */
export const FELTS: readonly SkinOption[] = [
  { id: 'theme', label: 'Theme', swatch: 'var(--accent)' },
  { id: 'green', label: 'Green', swatch: '#1b4332' },
  { id: 'blue', label: 'Blue', swatch: '#14304d' },
  { id: 'wine', label: 'Wine', swatch: '#45161f' },
  { id: 'slate', label: 'Slate', swatch: '#23262b' },
];

export const DEFAULT_FELT = 'theme';

const FELT_KEY = 'playtest-felt-v1';
/** Left behind by the retired sleeve picker; cleared on the next board open. */
const RETIRED_SLEEVE_KEY = 'playtest-sleeve-v1';

function read(key: string, options: readonly SkinOption[], fallback: string): string {
  try {
    const saved = localStorage.getItem(key);
    return saved && options.some((o) => o.id === saved) ? saved : fallback;
  } catch {
    // Private mode / blocked site data: the table still has a default look.
    return fallback;
  }
}

function write(key: string, value: string, fallback: string): void {
  try {
    if (value === fallback) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // A remembered look is a convenience, never a requirement.
  }
}

export function readFelt(): string {
  return read(FELT_KEY, FELTS, DEFAULT_FELT);
}

export function writeFelt(id: string): void {
  write(FELT_KEY, id, DEFAULT_FELT);
}

/**
 * Puts the chosen look on `<body>` and hands back the undo, so a board that
 * unmounts leaves the rest of the app exactly as it found it. Defaults write
 * no attribute at all — the plain rules are the default look.
 */
export function applyTableSkin(felt: string): () => void {
  if (typeof document === 'undefined') return () => {};
  const { body } = document;
  const before = body.dataset.felt;
  if (felt === DEFAULT_FELT) delete body.dataset.felt;
  else body.dataset.felt = felt;
  // The sleeve picker is gone, so a stale attribute from a build that had it
  // would keep tinting card backs with no way left to change it back.
  delete body.dataset.sleeve;
  try {
    localStorage.removeItem(RETIRED_SLEEVE_KEY);
  } catch {
    // Nothing to clean up if storage is blocked; the attribute is already off.
  }
  return () => {
    if (before === undefined) delete body.dataset.felt;
    else body.dataset.felt = before;
  };
}

/** The label a settings row shows for the current choice. */
export function skinLabel(options: readonly SkinOption[], id: string): string {
  return options.find((o) => o.id === id)?.label ?? options[0].label;
}
