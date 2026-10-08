import { MAX_COPIES_PER_LINE, isPinned, keyOf, type GetEntry } from './trade-basket';
import type { OwnedTradeLine } from './trade-picker';

/**
 * A half-built trade, saved per (viewer, friend) so the basket survives a
 * reload and a trip around the app.
 *
 * `get` is keyed by `getEntryKey`: one entry per PRINTING asked for (tapping a
 * printing asks for that printing), or per card when any printing will do.
 * `give` is keyed by `keyOf` and holds the viewer's own copy ids, which never
 * reach the wire.
 *
 * v2 made the ask printing-level. v1 drafts (oracle-level asks) are read by
 * {@link migrateDraft}: each becomes an "any printing" entry, which still sends
 * exactly what it always did.
 */
export interface TradeDraft {
  v: 2;
  friendId: string;
  friendName: string;
  get: Record<string, GetEntry>;
  give: Record<string, { name: string; oracleId: string; copyIds: string[] }>;
  note: string;
  /** Set when this basket is a counter to an incoming offer. */
  counterTo?: { offerId: string; name: string };
  /** Epoch ms of the last edit; drives the 30-day expiry. */
  updatedAt: number;
}

/** What a v1 draft looked like on disk. */
interface TradeDraftShape extends Omit<TradeDraft, 'v' | 'get'> {
  v: 1;
  get: Record<string, { name: string; quantity: number }>;
}

/**
 * Brings a saved draft of any version to the current one; null when it is not
 * a draft at all. v1 asks were keyed by oracle id, so the key doubles as the
 * entry's oracleId and the entry stays "any printing".
 */
export function migrateDraft(raw: unknown): TradeDraft | null {
  const d = raw as Partial<TradeDraft> | Partial<TradeDraftShape> | null;
  if (!d || typeof d !== 'object' || typeof d.updatedAt !== 'number') return null;
  if (d.v === 2) return d as TradeDraft;
  if (d.v !== 1) return null;
  const get: TradeDraft['get'] = {};
  for (const [key, line] of Object.entries((d as TradeDraftShape).get ?? {})) {
    get[key] = { name: line.name, oracleId: key, quantity: line.quantity };
  }
  return { ...(d as TradeDraftShape), v: 2, get };
}

/** Something about the draft no longer matches the friend's collection. */
export type DraftIssue =
  | { kind: 'gone'; key: string; name: string }
  | { kind: 'reduced'; key: string; name: string; from: number; to: number };

export function emptyDraft(friendId: string, friendName: string, now = Date.now()): TradeDraft {
  return { v: 2, friendId, friendName, get: {}, give: {}, note: '', updatedAt: now };
}

/** A draft with nothing in it is not worth keeping. */
export function isEmptyDraft(draft: TradeDraft): boolean {
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
 * - A pinned entry clamps to THEIR count of that printing
 *   (`theirCountByPrinting`, keyed like the entry); one that names a printing
 *   they no longer hold is `gone` even if they own the card in another printing.
 * - `theirCountByOracle === null` means the collection is private or unread:
 *   there is no ceiling to enforce beyond the per-line 20, and nothing is gone.
 * - Give copy ids are filtered to copies still owned; a line left with none
 *   is dropped.
 * - `counterTo` is kept as-is; checking it against the server is the UI's job.
 */
export function reconcileDraft(
  draft: TradeDraft,
  theirCountByOracle: ReadonlyMap<string, number> | null,
  ownedLines: readonly OwnedTradeLine[],
  theirCountByPrinting: ReadonlyMap<string, number> | null = null
): { draft: TradeDraft; issues: DraftIssue[] } {
  const issues: DraftIssue[] = [];

  const get: TradeDraft['get'] = {};
  for (const [key, line] of Object.entries(draft.get)) {
    const counts = isPinned(line) ? theirCountByPrinting : theirCountByOracle;
    const ceiling = counts
      ? (counts.get(isPinned(line) ? key : keyOf(line)) ?? 0)
      : MAX_COPIES_PER_LINE;
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
  const give: TradeDraft['give'] = {};
  for (const [key, line] of Object.entries(draft.give)) {
    const owned = ownedIds.get(key);
    const copyIds = owned ? line.copyIds.filter((id) => owned.has(id)) : [];
    if (copyIds.length > 0) give[key] = { ...line, copyIds };
  }

  return { draft: { ...draft, get, give }, issues };
}
