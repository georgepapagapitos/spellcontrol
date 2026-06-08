/**
 * Pure undo/redo command history, keyed per deck.
 *
 * This is the store-independent core behind the deck editor's undo/redo
 * (`store/deck-history.ts` wraps it in a Zustand store). It's a plain reducer
 * over an immutable {@link History} value so the branching/cap/invalidation
 * logic can be unit-tested without constructing real `Deck` objects — hence the
 * generic snapshot type `S` (the store binds `S = Deck`).
 *
 * Model: each undoable user action is one {@link Command} carrying a full
 * before/after snapshot of the affected deck. Because a deck is a single sync
 * row (see `lib/sync.ts`), "undo" is just restoring the `before` snapshot
 * through the normal store setter — no per-field inverse logic. History is
 * in-memory and ephemeral (not persisted, not synced); it's dropped for a deck
 * when a server pull rewrites that deck's row (`invalidate`).
 *
 * Stacks are per deck so Cmd+Z only affects the deck currently on screen.
 */

/** Max undo depth per deck. Oldest commands are dropped past this. */
export const MAX_DEPTH = 50;

export interface Command<S> {
  /** Deck this command belongs to. */
  deckId: string;
  /** Human label for the affordance tooltip (e.g. "swap", "remove 3 cards"). */
  label: string;
  /** Snapshot of the deck before the action — restored on undo. */
  before: S;
  /** Snapshot of the deck after the action — restored on redo. */
  after: S;
}

interface Stack<S> {
  /** Applied commands, oldest → newest. The last is the next to undo. */
  past: Command<S>[];
  /** Undone commands, next-to-redo first. */
  future: Command<S>[];
}

export interface History<S> {
  byDeck: Record<string, Stack<S>>;
}

export function emptyHistory<S>(): History<S> {
  return { byDeck: {} };
}

function stackFor<S>(h: History<S>, deckId: string): Stack<S> {
  return h.byDeck[deckId] ?? { past: [], future: [] };
}

/**
 * Record a new command. Appends to the deck's `past` (trimming to
 * {@link MAX_DEPTH}) and clears its `future` — a fresh edit branches history,
 * discarding any previously-undone commands (standard undo semantics).
 */
export function pushCommand<S>(h: History<S>, cmd: Command<S>): History<S> {
  const stack = stackFor(h, cmd.deckId);
  const past = [...stack.past, cmd];
  if (past.length > MAX_DEPTH) past.splice(0, past.length - MAX_DEPTH);
  return { byDeck: { ...h.byDeck, [cmd.deckId]: { past, future: [] } } };
}

/**
 * Pop the most recent command off `past`. Returns the new history plus the
 * popped command (the caller restores its `before`). `null` when nothing to
 * undo for this deck.
 */
export function undo<S>(
  h: History<S>,
  deckId: string
): { history: History<S>; command: Command<S> } | null {
  const stack = stackFor(h, deckId);
  if (stack.past.length === 0) return null;
  const command = stack.past[stack.past.length - 1];
  const past = stack.past.slice(0, -1);
  const future = [command, ...stack.future];
  return { history: { byDeck: { ...h.byDeck, [deckId]: { past, future } } }, command };
}

/**
 * Take the next redoable command off `future`. Returns the new history plus
 * the command (the caller restores its `after`). `null` when nothing to redo.
 */
export function redo<S>(
  h: History<S>,
  deckId: string
): { history: History<S>; command: Command<S> } | null {
  const stack = stackFor(h, deckId);
  if (stack.future.length === 0) return null;
  const command = stack.future[0];
  const future = stack.future.slice(1);
  const past = [...stack.past, command];
  return { history: { byDeck: { ...h.byDeck, [deckId]: { past, future } } }, command };
}

/**
 * Drop the undo/redo stacks for the given decks. Called when a server pull
 * rewrites a deck row — the local snapshots are now stale, so undoing them
 * would clobber the newer remote edit (LWW). No-op for decks with no history.
 */
export function invalidate<S>(h: History<S>, deckIds: Iterable<string>): History<S> {
  let changed = false;
  const byDeck = { ...h.byDeck };
  for (const id of deckIds) {
    if (id in byDeck) {
      delete byDeck[id];
      changed = true;
    }
  }
  return changed ? { byDeck } : h;
}

export function canUndo<S>(h: History<S>, deckId: string): boolean {
  return stackFor(h, deckId).past.length > 0;
}

export function canRedo<S>(h: History<S>, deckId: string): boolean {
  return stackFor(h, deckId).future.length > 0;
}

/** Label of the next command to undo for this deck, if any. */
export function undoLabel<S>(h: History<S>, deckId: string): string | null {
  const stack = stackFor(h, deckId);
  return stack.past.length ? stack.past[stack.past.length - 1].label : null;
}

/** Label of the next command to redo for this deck, if any. */
export function redoLabel<S>(h: History<S>, deckId: string): string | null {
  const stack = stackFor(h, deckId);
  return stack.future.length ? stack.future[0].label : null;
}
