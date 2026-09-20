/**
 * How your table looks: the felt under the cards, and the sleeves your
 * face-down cards and library wear.
 *
 * Both are **per-device preferences**, the same class of thing as card size
 * and the takeback rule — not table-wide `GameState` like the mulligan rule
 * or the turn timer. Opponents see the board you publish, never your CSS, so
 * there is nothing here for a pod to agree on: it is your table, the way you
 * like looking at it.
 *
 * Applied as `data-felt` / `data-sleeve` on `<body>` rather than on the board
 * element, because a face-down card also turns up in surfaces that portal out
 * of the board tree (the opponent-board modal, the drag overlay). The CSS
 * lives in `styles/playtest.css` beside the felt and card-back rules it
 * overrides, and every value is a colour — no new image per sleeve, since a
 * sleeve is the one card back tinted (see `.playtest-card__back`).
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

/** `original` is the printed card back, untinted. */
export const SLEEVES: readonly SkinOption[] = [
  { id: 'original', label: 'Original', swatch: '#6b4423' },
  { id: 'black', label: 'Black', swatch: '#141414' },
  { id: 'blue', label: 'Blue', swatch: '#1c3f6e' },
  { id: 'red', label: 'Red', swatch: '#6e1c1c' },
  { id: 'green', label: 'Green', swatch: '#1c5a34' },
  { id: 'purple', label: 'Purple', swatch: '#452a6e' },
];

export const DEFAULT_FELT = 'theme';
export const DEFAULT_SLEEVE = 'original';

const FELT_KEY = 'playtest-felt-v1';
const SLEEVE_KEY = 'playtest-sleeve-v1';

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

export function readSleeve(): string {
  return read(SLEEVE_KEY, SLEEVES, DEFAULT_SLEEVE);
}

export function writeSleeve(id: string): void {
  write(SLEEVE_KEY, id, DEFAULT_SLEEVE);
}

/**
 * Puts the chosen look on `<body>` and hands back the undo, so a board that
 * unmounts leaves the rest of the app exactly as it found it. Defaults write
 * no attribute at all — the plain rules are the default look.
 */
export function applyTableSkin(felt: string, sleeve: string): () => void {
  if (typeof document === 'undefined') return () => {};
  const { body } = document;
  const before = { felt: body.dataset.felt, sleeve: body.dataset.sleeve };
  const set = (name: 'felt' | 'sleeve', value: string, fallback: string) => {
    if (value === fallback) delete body.dataset[name];
    else body.dataset[name] = value;
  };
  set('felt', felt, DEFAULT_FELT);
  set('sleeve', sleeve, DEFAULT_SLEEVE);
  return () => {
    if (before.felt === undefined) delete body.dataset.felt;
    else body.dataset.felt = before.felt;
    if (before.sleeve === undefined) delete body.dataset.sleeve;
    else body.dataset.sleeve = before.sleeve;
  };
}

/** The label a settings row shows for the current choice. */
export function skinLabel(options: readonly SkinOption[], id: string): string {
  return options.find((o) => o.id === id)?.label ?? options[0].label;
}
