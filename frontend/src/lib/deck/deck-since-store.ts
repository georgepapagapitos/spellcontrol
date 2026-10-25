/**
 * Per-device baseline for the deck "Since" read (E1038 3.4).
 *
 * Device-local on purpose: localStorage, never synced and no sync kind. The
 * question it answers is "what changed since I last looked at this deck HERE",
 * which includes edits another device pushed in between. The record keeps two
 * snapshots per deck: the baseline the read compares against, and the latest
 * state seen. A visit after a long gap (a new session) promotes `latest` to
 * baseline, so the read shows what changed since the last session ended; within
 * a session the baseline holds, so the edits made so far stay on screen.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { sameCards, type DeckSnapshot } from './deck-since';

export interface BaselineRecord {
  baseline: DeckSnapshot;
  latest: DeckSnapshot;
  /** Payloads of baseline cards that have left the deck, so the baseline's
   *  numbers can be recomputed with today's classifiers. */
  pool: Record<string, ScryfallCard>;
}

/** A visit this long after the last change starts a new session. */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/** Decks remembered per device; the least recently changed are dropped. */
export const MAX_RECORDS = 40;

const KEY = 'deck-since-v2';

/** Open a deck page: the first visit seeds both snapshots, a late one rolls the baseline. */
export function startSession(
  rec: BaselineRecord | null,
  current: DeckSnapshot,
  now: number
): BaselineRecord {
  if (!rec) return { baseline: current, latest: current, pool: {} };
  if (now - rec.latest.at > SESSION_GAP_MS) {
    return { baseline: rec.latest, latest: rec.latest, pool: {} };
  }
  return rec;
}

/**
 * Record the deck as it stands now. While the card list still matches the
 * baseline, metrics the baseline was missing (the bracket and the simulations
 * land after the cards) are filled in from now, so they have a "before" to
 * compare against once the cards change.
 */
export function observe(
  rec: BaselineRecord,
  current: DeckSnapshot,
  pool: BaselineRecord['pool'] = rec.pool
): BaselineRecord {
  const baseline = sameCards(rec.baseline, current)
    ? { ...rec.baseline, metrics: { ...current.metrics, ...rec.baseline.metrics } }
    : rec.baseline;
  return { baseline, latest: current, pool };
}

/** "Got it": the deck as it stands becomes the baseline. */
export function markSeen(rec: BaselineRecord): BaselineRecord {
  return { baseline: rec.latest, latest: rec.latest, pool: {} };
}

type Records = Record<string, BaselineRecord>;

function readAll(): Records {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Records)
      : {};
  } catch {
    return {};
  }
}

function isRecord(v: unknown): v is BaselineRecord {
  const r = v as BaselineRecord | undefined;
  return (
    !!r?.baseline?.cards &&
    !!r.latest?.cards &&
    !!r.baseline.metrics &&
    !!r.latest.metrics &&
    Array.isArray(r.baseline.commanders) &&
    !!r.pool
  );
}

export function loadRecord(deckId: string): BaselineRecord | null {
  const rec = readAll()[deckId];
  return isRecord(rec) ? rec : null;
}

export function saveRecord(deckId: string, rec: BaselineRecord): void {
  try {
    const all = { ...readAll(), [deckId]: rec };
    const ids = Object.keys(all);
    if (ids.length > MAX_RECORDS) {
      ids.sort((a, b) => (all[b]?.latest.at ?? 0) - (all[a]?.latest.at ?? 0));
      for (const id of ids.slice(MAX_RECORDS)) delete all[id];
    }
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage full or blocked: the read just starts over next visit */
  }
}

export function clearRecord(deckId: string): void {
  try {
    const all = readAll();
    delete all[deckId];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
