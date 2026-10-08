import { sendBeaconPayload, normalizePath } from '@/lib/util/analytics';
import { useDeckHistoryStore } from '@/store/deck-history';
import type { Deck } from '@/store/decks';
import type { Command } from '@/lib/deck/deck-history-core';
import type { Change } from '@/lib/coach/deck-change';

/**
 * Revealed-preference labels for suggestions (E518): what a player did with a
 * suggestion, sent through the first-party beacon (see analytics.ts and
 * backend/src/routes/suggestion-labels.ts).
 *
 * The privacy line is the whole design, so it lives in one place:
 *
 *  - `buildSuggestionPayload` is the ONLY thing that shapes what leaves the
 *    browser. It copies named fields out of its input and never spreads it, so
 *    a caller that holds a deck id, a user id or a deck list cannot leak one
 *    through it. What is sent: the commander (and partner) oracle id, the card
 *    added and/or cut by name, the surface, the action, the suggestion's rank
 *    in its lane, and the reason kind.
 *  - The deck id this module holds (to match an undo to its accept) stays in
 *    memory and is never read into a payload.
 *  - `isSuggestionLabelsEnabled` is checked before anything is built. The
 *    Settings toggle writes it; off means nothing is sent.
 */

export type SuggestionSurface =
  | 'coach:all'
  | 'coach:fill-gaps'
  | 'coach:upgrade'
  | 'coach:budget'
  | 'coach:collection'
  | 'coach:decks'
  | 'coach:bracket-fit'
  | 'coach:combos'
  | 'coach:lands'
  | 'coach:cuts'
  | 'coach:plan'
  | 'swap'
  | 'similar'
  | 'hidden-gems'
  | 'add-suggestions'
  | 'add-combos'
  | 'generation';

export type SuggestionAction = 'shown' | 'accept' | 'dismiss' | 'undo';

export interface SuggestionInput {
  surface: SuggestionSurface;
  action: SuggestionAction;
  /** 1-based position in its lane; 0 when the surface has no ranking. */
  rank?: number;
  /** The suggestion's reason category (its lane, e.g. `fill-gaps`). */
  reason?: string;
  cardIn?: string;
  cardOut?: string;
  /** `shown` only: how many suggestions the lane displayed. */
  n?: number;
}

export interface LabelCommander {
  oracleId: string;
  name: string;
  partnerOracleId?: string;
}

const PREF_KEY = 'sc-suggestion-labels';

/** On unless the player turned it off in Settings. */
export function isSuggestionLabelsEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setSuggestionLabelsEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, '0');
  } catch {
    // Best effort: a blocked store leaves the default, which Settings reflects on reload.
  }
}

const NAME_MAX = 100;

const clip = (v: string | undefined): string | undefined =>
  v ? v.trim().slice(0, NAME_MAX) || undefined : undefined;

/** The beacon body for one label. Named fields only, so nothing else can ride along. */
export function buildSuggestionPayload(
  input: SuggestionInput,
  commander: LabelCommander,
  path: string
): Record<string, unknown> {
  const reason = (input.reason ?? '').toLowerCase().replace(/[^a-z-]/g, '');
  const rank = Math.min(99, Math.max(0, Math.trunc(input.rank ?? 0) || 0));
  const payload: Record<string, unknown> = {
    name: 'suggestion',
    path,
    surface: input.surface,
    action: input.action,
    cmdr: commander.oracleId,
    cmdrName: clip(commander.name),
  };
  if (rank) payload.rank = rank;
  if (reason) payload.reason = reason.slice(0, 24);
  if (commander.partnerOracleId) payload.partner = commander.partnerOracleId;
  if (input.action === 'shown') {
    payload.n = Math.min(200, Math.max(1, Math.trunc(input.n ?? 1)));
  } else {
    const cardIn = clip(input.cardIn);
    const cardOut = clip(input.cardOut);
    if (cardIn) payload.cardIn = cardIn;
    if (cardOut) payload.cardOut = cardOut;
  }
  return payload;
}

/**
 * The accept label for a Coach-style `Change`. A swap's `name` is the card
 * coming in and `inName` the one going out; a cut names only the card leaving.
 * The reason kind is the move's lane.
 */
export function suggestionInputForChange(
  change: Change,
  surface: SuggestionSurface,
  rank: number
): SuggestionInput {
  return {
    surface,
    action: 'accept',
    rank,
    reason: change.lane,
    cardIn: change.type === 'cut' ? undefined : change.name,
    cardOut: change.type === 'cut' ? change.name : change.inName,
  };
}

// ── The deck the player is editing ─────────────────────────────────────────

interface LabelContext {
  /** In memory only: matches an undo to its accept. Never read into a payload. */
  deckId: string;
  commander: LabelCommander;
}

let context: LabelContext | null = null;

/**
 * The deck editor calls this with the open deck, and with null on leave.
 * Without a commander (a 60-card deck) nothing is sent: a label is keyed on one.
 */
export function setSuggestionContext(
  deck: Pick<Deck, 'id' | 'commander' | 'partnerCommander'> | null
): void {
  const oracleId = deck?.commander?.oracle_id;
  if (!deck || !deck.commander || !oracleId) {
    context = null;
    return;
  }
  const partner = deck.partnerCommander;
  context = {
    deckId: deck.id,
    commander: {
      oracleId,
      name: partner ? `${deck.commander.name} / ${partner.name}` : deck.commander.name,
      partnerOracleId: partner?.oracle_id,
    },
  };
  watchHistory();
}

function send(input: SuggestionInput, commander: LabelCommander): void {
  if (typeof window === 'undefined') return;
  sendBeaconPayload(
    buildSuggestionPayload(input, commander, normalizePath(window.location.pathname))
  );
}

// ── Undo: an accept the player takes back ──────────────────────────────────

interface Bound {
  input: SuggestionInput;
  commander: LabelCommander;
}

interface Pending extends Bound {
  deckId: string;
  at: number;
}

/** An accept waits this long for the edit it causes to land in the undo history. */
const PENDING_TTL_MS = 15_000;
let pending: Pending[] = [];
const bound = new WeakMap<Command<Deck>, Bound[]>();

function bind(cmd: Command<Deck>, entries: Bound[]): void {
  bound.set(cmd, [...(bound.get(cmd) ?? []), ...entries]);
}

/** Names the command removed from a generated list, with the card that took a lone slot. */
function generationDismissals(cmd: Command<Deck>): Bound[] {
  const generated = new Set(cmd.before.generationContext?.generatedList?.cards ?? []);
  const commander = cmd.before.commander;
  if (generated.size === 0 || !commander?.oracle_id) return [];
  const names = (d: Deck) => new Set(d.cards.map((c) => c.card.name));
  const was = names(cmd.before);
  const now = names(cmd.after);
  const removed = [...was].filter((n) => !now.has(n) && generated.has(n));
  const added = [...now].filter((n) => !was.has(n));
  const partner = cmd.before.partnerCommander;
  const label: LabelCommander = {
    oracleId: commander.oracle_id,
    name: partner ? `${commander.name} / ${partner.name}` : commander.name,
    partnerOracleId: partner?.oracle_id,
  };
  // Cap a bulk cut: a deck wipe is one decision, not forty.
  return removed.slice(0, 5).map((cardOut) => ({
    commander: label,
    input: {
      surface: 'generation',
      action: 'dismiss',
      reason: 'generated',
      cardOut,
      cardIn: removed.length === 1 && added.length === 1 ? added[0] : undefined,
    },
  }));
}

let unwatch: (() => void) | null = null;

/** Watches the undo history for edits that carry a label, once per page load. */
function watchHistory(): void {
  if (unwatch) return;
  let prev = useDeckHistoryStore.getState().history;
  unwatch = useDeckHistoryStore.subscribe((state) => {
    const before = prev;
    prev = state.history;
    if (state.history === before) return;
    for (const [deckId, stack] of Object.entries(state.history.byDeck)) {
      const old = before.byDeck[deckId];
      const top = stack.past[stack.past.length - 1];
      const oldTop = old?.past[old.past.length - 1];
      const undone = stack.future[0];
      if (undone && undone !== old?.future[0] && undone === oldTop) {
        // An undo: tell the server which labels were taken back, once each.
        for (const b of bound.get(undone) ?? []) {
          if (isSuggestionLabelsEnabled()) send({ ...b.input, action: 'undo' }, b.commander);
        }
        bound.delete(undone);
        continue;
      }
      if (!top || top === oldTop || top === old?.future[0]) continue;
      // A new edit: it belongs to the accepts that were waiting on this deck.
      const now = Date.now();
      pending = pending.filter((p) => now - p.at < PENDING_TTL_MS);
      const mine = pending.filter((p) => p.deckId === deckId);
      pending = pending.filter((p) => p.deckId !== deckId);
      const entries = [...mine, ...(isSuggestionLabelsEnabled() ? generationDismissals(top) : [])];
      if (entries.length === 0) continue;
      bind(top, entries);
      for (const g of entries.slice(mine.length)) send(g.input, g.commander);
    }
  });
}

// ── Public emitters ────────────────────────────────────────────────────────

/** A player acted on a suggestion. An `accept` is remembered so a later undo is labelled. */
export function recordSuggestion(input: SuggestionInput): void {
  if (!isSuggestionLabelsEnabled() || !context) return;
  send(input, context.commander);
  if (input.action === 'accept') {
    pending.push({
      input,
      commander: context.commander,
      deckId: context.deckId,
      at: Date.now(),
    });
  }
}

const shownSeen = new Set<string>();

/**
 * A lane put `n` suggestions in front of the player. Counted once per lane per
 * page load; a surface that lists per card passes that card as `scope`, so each
 * card's list counts once. The scope is a dedupe key and is never sent.
 */
export function recordShown(surface: SuggestionSurface, n: number, scope = ''): void {
  if (!isSuggestionLabelsEnabled() || !context || n < 1) return;
  const key = `${surface}|${context.commander.oracleId}|${scope}`;
  if (shownSeen.has(key)) return;
  shownSeen.add(key);
  send({ surface, action: 'shown', n }, context.commander);
}

/** Test seam: forget everything this module remembers. */
export function resetSuggestionLabelsForTests(): void {
  context = null;
  pending = [];
  shownSeen.clear();
  unwatch?.();
  unwatch = null;
}
