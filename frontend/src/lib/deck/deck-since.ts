/**
 * "Since you last looked" for a deck (E1038 3.4): a compact before/after of the
 * numbers a deck owner cares about, plus the cards that moved them. Pure: a
 * snapshot is built from a deck and what the page already computed, and two
 * snapshots diff into rows. No React, no storage (see deck-since-store.ts).
 *
 * A snapshot is deliberately small (names and counts, not card payloads) so a
 * few dozen of them fit in localStorage. Every metric is optional: the bracket
 * and the async simulations arrive after the cards do, and a row appears only
 * when BOTH snapshots carry that metric, so a still-loading number never reads
 * as a change.
 */
import type { Deck } from '@/store/decks';
import { effectiveBracket } from '@/store/decks';
import { analyzeDeck } from '@/lib/deck-analysis/deck-analysis';

export interface SinceMetrics {
  lands?: number;
  ramp?: number;
  cardDraw?: number;
  removal?: number;
  boardwipe?: number;
  /** Share of spells that make their curve, 0 to 1. */
  castable?: number;
  /** Median turn the primary win path is online. */
  clockTurn?: number;
  bracket?: number;
  gameChangers?: number;
  extraTurns?: number;
  massLandDenial?: number;
  twoCardCombos?: number;
  fastMana?: number;
  tutors?: number;
}

export interface DeckSnapshot {
  at: number;
  /** Card name to copies, commanders included. */
  cards: Record<string, number>;
  metrics: SinceMetrics;
}

/** The async numbers the page computes after paint; absent until they land. */
export interface SinceExtras {
  castable?: number | null;
  clockTurn?: number | null;
}

/** Copies per card name across the commanders and the mainboard. */
export function cardCounts(deck: Deck): Record<string, number> {
  const counts: Record<string, number> = {};
  const add = (name: string | undefined) => {
    if (name) counts[name] = (counts[name] ?? 0) + 1;
  };
  add(deck.commander?.name);
  add(deck.partnerCommander?.name);
  for (const c of deck.cards) add(c.card.name);
  return counts;
}

/**
 * Snapshot a deck as it stands. Role counts need the tagger, so without it the
 * role rows are left out rather than read as zero.
 */
export function buildSnapshot(
  deck: Deck,
  taggerReady: boolean,
  extras: SinceExtras = {},
  at = Date.now()
): DeckSnapshot {
  const analysis = analyzeDeck(
    {
      format: deck.format,
      commander: deck.commander,
      partnerCommander: deck.partnerCommander,
      mainboard: deck.cards,
    },
    taggerReady
  );
  const count = (key: string) => analysis.roles.find((r) => r.key === key)?.count;
  const metrics: SinceMetrics = { lands: count('lands') };
  if (taggerReady) {
    metrics.ramp = count('ramp');
    metrics.cardDraw = count('cardDraw');
    metrics.removal = count('removal');
    metrics.boardwipe = count('boardwipe');
  }
  if (extras.castable != null) metrics.castable = extras.castable;
  if (extras.clockTurn != null) metrics.clockTurn = extras.clockTurn;
  const est = deck.bracketEstimation;
  if (est) {
    const b = est.breakdown;
    metrics.bracket = effectiveBracket(deck) ?? est.bracket;
    metrics.gameChangers = b.gameChangerCount;
    metrics.extraTurns = b.extraTurnCount;
    metrics.massLandDenial = b.massLandDenialCount;
    metrics.twoCardCombos = b.twoCardComboCount;
    metrics.fastMana = b.fastManaCount;
    metrics.tutors = b.tutorCount;
  }
  return { at, cards: cardCounts(deck), metrics };
}

/** Whether two snapshots hold the same card list. */
export function sameCards(a: DeckSnapshot, b: DeckSnapshot): boolean {
  const ak = Object.keys(a.cards);
  if (ak.length !== Object.keys(b.cards).length) return false;
  return ak.every((k) => a.cards[k] === b.cards[k]);
}

export type SinceDirection = 'up' | 'down';

export interface SinceRow {
  key: keyof SinceMetrics;
  label: string;
  from: number;
  to: number;
  /** Display strings, so the unit (%, turn, B) lives with the metric. */
  fromText: string;
  toText: string;
  direction: SinceDirection;
}

export interface SinceCard {
  name: string;
  /** Copies gained (added) or lost (removed). */
  qty: number;
  /** Roles the card fills, for the "why" next to it. */
  roles: string[];
}

export interface DeckSince {
  rows: SinceRow[];
  added: SinceCard[];
  removed: SinceCard[];
}

interface MetricSpec {
  key: keyof SinceMetrics;
  label: string;
  /** Smallest change worth a row. */
  min: number;
  format: (n: number) => string;
}

const count = (n: number) => String(n);
const pct = (n: number) => `${Math.round(n * 100)}%`;

// Order is the order of the line: the headline bracket first, then the
// build numbers, then the simulations, then the bracket's own signals.
const SPECS: readonly MetricSpec[] = [
  { key: 'bracket', label: 'Bracket', min: 1, format: (n) => `B${n}` },
  { key: 'lands', label: 'Lands', min: 1, format: count },
  { key: 'ramp', label: 'Ramp', min: 1, format: count },
  { key: 'cardDraw', label: 'Card draw', min: 1, format: count },
  { key: 'removal', label: 'Removal', min: 1, format: count },
  { key: 'boardwipe', label: 'Board wipes', min: 1, format: count },
  // Under two points is simulation noise, not an edit's effect.
  { key: 'castable', label: 'Castable on curve', min: 0.02, format: pct },
  { key: 'clockTurn', label: 'Win path online', min: 1, format: (n) => `turn ${n}` },
  { key: 'gameChangers', label: 'Game Changers', min: 1, format: count },
  { key: 'twoCardCombos', label: 'Two-card combos', min: 1, format: count },
  { key: 'extraTurns', label: 'Extra turns', min: 1, format: count },
  { key: 'massLandDenial', label: 'Land denial', min: 1, format: count },
  { key: 'fastMana', label: 'Fast mana', min: 1, format: count },
  { key: 'tutors', label: 'Tutors', min: 1, format: count },
];

/** What changed between a baseline and now: metric rows and the cards behind them. */
export function diffSnapshots(
  base: DeckSnapshot,
  now: DeckSnapshot,
  rolesOf: (name: string) => readonly string[] = () => []
): DeckSince {
  const rows: SinceRow[] = [];
  for (const spec of SPECS) {
    const from = base.metrics[spec.key];
    const to = now.metrics[spec.key];
    if (from == null || to == null) continue;
    if (Math.abs(to - from) < spec.min - 1e-9) continue;
    rows.push({
      key: spec.key,
      label: spec.label,
      from,
      to,
      fromText: spec.format(from),
      toText: spec.format(to),
      direction: to > from ? 'up' : 'down',
    });
  }
  const added: SinceCard[] = [];
  const removed: SinceCard[] = [];
  for (const name of new Set([...Object.keys(base.cards), ...Object.keys(now.cards)])) {
    const delta = (now.cards[name] ?? 0) - (base.cards[name] ?? 0);
    if (delta === 0) continue;
    const entry = { name, qty: Math.abs(delta), roles: [...rolesOf(name)] };
    (delta > 0 ? added : removed).push(entry);
  }
  const byName = (a: SinceCard, b: SinceCard) => a.name.localeCompare(b.name);
  added.sort(byName);
  removed.sort(byName);
  return { rows, added, removed };
}

/** True when the diff has anything to say. */
export function hasChanges(d: DeckSince): boolean {
  return d.rows.length > 0 || d.added.length > 0 || d.removed.length > 0;
}

const ROLE_WORDS: Record<string, string> = {
  ramp: 'ramp',
  cardDraw: 'card draw',
  removal: 'removal',
  boardwipe: 'board wipe',
};
export const roleWord = (role: string): string => ROLE_WORDS[role] ?? role;

/** The one-line read: the first few rows, then "N more". */
export function sinceSummary(d: DeckSince, max = 3): string {
  const parts = d.rows.slice(0, max).map((r) => `${r.label} ${r.fromText} to ${r.toText}`);
  const more = d.rows.length - parts.length;
  if (more > 0) parts.push(`${more} more`);
  if (parts.length === 0) {
    const n = d.added.reduce((s, c) => s + c.qty, 0) + d.removed.reduce((s, c) => s + c.qty, 0);
    return `${n} ${n === 1 ? 'card' : 'cards'} changed`;
  }
  return parts.join(', ');
}

const DAY = 24 * 60 * 60 * 1000;

/** "earlier today", "yesterday" or "Oct 24": when the baseline was taken. */
export function baselineLabel(at: number, now = Date.now()): string {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const gone = Math.round((day(now) - day(at)) / DAY);
  if (gone <= 0) return 'earlier today';
  if (gone === 1) return 'yesterday';
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
