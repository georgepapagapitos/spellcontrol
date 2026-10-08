import { MAX_COPIES_PER_LINE, keyOf } from './trade-basket';
import type { OwnedTradeLine } from './trade-picker';

/**
 * A half-built trade, saved per (viewer, friend) so the basket survives a
 * reload and a trip around the app.
 *
 * `get` is keyed by oracleId (the ask is oracle-level; the friend picks the
 * printing on accept). `give` is keyed by `keyOf` and holds the viewer's own
 * copy ids, which never reach the wire.
 */
export interface TradeDraftV1 {
  v: 1;
  friendId: string;
  friendName: string;
  get: Record<string, { name: string; quantity: number }>;
  give: Record<string, { name: string; oracleId: string; copyIds: string[] }>;
  note: string;
  /** Set when this basket is a counter to an incoming offer. */
  counterTo?: { offerId: string; name: string };
  /** Epoch ms of the last edit; drives the 30-day expiry. */
  updatedAt: number;
}

/** Something about the draft no longer matches the friend's collection. */
export type DraftIssue =
  | { kind: 'gone'; key: string; name: string }
  | { kind: 'reduced'; key: string; name: string; from: number; to: number };

export function emptyDraft(friendId: string, friendName: string, now = Date.now()): TradeDraftV1 {
  return { v: 1, friendId, friendName, get: {}, give: {}, note: '', updatedAt: now };
}

/** A draft with nothing in it is not worth keeping. */
export function isEmptyDraft(draft: TradeDraftV1): boolean {
  return (
    Object.keys(draft.get).length === 0 &&
    Object.keys(draft.give).length === 0 &&
    draft.note.trim() === '' &&
    !draft.counterTo
  );
}

/**
 * Bring a saved draft back in line with the world it is reopened in.
 *
 * - Get quantities clamp to `min(20, theirCount)`; a get line whose card is no
 *   longer in their collection is reported `gone` and left in place (a `gone`
 *   line blocks Send until the owner removes it).
 * - `theirCountByOracle === null` means the collection is private or unread:
 *   there is no ceiling to enforce beyond the per-line 20, and nothing is gone.
 * - Give copy ids are filtered to copies still owned; a line left with none
 *   is dropped.
 * - `counterTo` is kept as-is; checking it against the server is the UI's job.
 */
export function reconcileDraft(
  draft: TradeDraftV1,
  theirCountByOracle: ReadonlyMap<string, number> | null,
  ownedLines: readonly OwnedTradeLine[]
): { draft: TradeDraftV1; issues: DraftIssue[] } {
  const issues: DraftIssue[] = [];

  const get: TradeDraftV1['get'] = {};
  for (const [key, line] of Object.entries(draft.get)) {
    const ceiling = theirCountByOracle ? (theirCountByOracle.get(key) ?? 0) : MAX_COPIES_PER_LINE;
    if (ceiling <= 0) {
      issues.push({ kind: 'gone', key, name: line.name });
      get[key] = line;
      continue;
    }
    const to = Math.max(1, Math.min(line.quantity, MAX_COPIES_PER_LINE, ceiling));
    if (to < line.quantity) {
      issues.push({ kind: 'reduced', key, name: line.name, from: line.quantity, to });
    }
    get[key] = { ...line, quantity: to };
  }

  const ownedIds = new Map<string, Set<string>>();
  for (const line of ownedLines) {
    ownedIds.set(keyOf(line), new Set(line.copies.map((c) => c.copyId)));
  }
  const give: TradeDraftV1['give'] = {};
  for (const [key, line] of Object.entries(draft.give)) {
    const owned = ownedIds.get(key);
    const copyIds = owned ? line.copyIds.filter((id) => owned.has(id)) : [];
    if (copyIds.length > 0) give[key] = { ...line, copyIds };
  }

  return { draft: { ...draft, get, give }, issues };
}
