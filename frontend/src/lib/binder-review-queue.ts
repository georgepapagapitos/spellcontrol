import { nextBinderMatch } from '@spellcontrol/binder-routing';
import type { BinderDef, EnrichedCard, MaterializedBinder } from '../types';
import type { DriftCard, DriftResult } from './binder-drift';
import { printingFinishKey } from './collection-mutations';

/** One drift row, possibly rolled up from several identical (same-printing) copies. */
export interface ReviewQueueRow {
  key: string;
  name: string;
  reason: DriftCard['reason'];
  /** Every physical copyId this row's actions apply to (roll-up ×N). */
  copyIds: string[];
  /** A live representative card, when one exists — needed for "Added it"
   *  (added) to snapshot current price/edhrec, and for "Don't add" to
   *  compute where the card would file next. Undefined for a removed row
   *  whose card left the collection entirely. */
  representative?: EnrichedCard;
}

export type RemovedDestination =
  | { kind: 'binder'; binderId: string; binderName: string }
  | { kind: 'uncategorized' }
  | { kind: 'not-owned' };

export interface RemovedGroup {
  destination: RemovedDestination;
  rows: ReviewQueueRow[];
}

export interface ReviewQueue {
  removedGroups: RemovedGroup[];
  addedRows: ReviewQueueRow[];
}

function toRow(card: DriftCard, copyIds: string[]): ReviewQueueRow {
  return {
    key: card.key,
    name: card.name,
    reason: card.reason,
    copyIds,
    representative: card.card,
  };
}

/** Stable identity for a removed group — used as its React list key. */
export function destinationKey(d: RemovedDestination): string {
  return d.kind === 'binder' ? `binder:${d.binderId}` : d.kind;
}

/**
 * Builds the review queue's row/group structure from a drift result. Pure —
 * no store reads, no mutation. The per-row `copyIds` roll up every owned copy
 * sharing that printing+finish so a bulk "Keep it here" / "Don't add" click
 * applies to all of them, not just the one representative in `DriftCard`.
 *
 * - Removed rows are grouped by where the card currently lands (computed via
 *   `nextBinderMatch`, which — after the E88 exclusion-fall-through fix —
 *   mirrors `materializeBinders` exactly): another binder, uncategorized, or
 *   "not owned" for a card that left the collection entirely (no live card
 *   to route).
 * - Added rows are a single flat group (they all belong to the viewed binder
 *   right now; the "where would it go instead" question only matters once
 *   it's excluded, which the UI answers separately at click time).
 */
export function buildReviewQueue(
  drift: DriftResult,
  binder: MaterializedBinder,
  allCards: EnrichedCard[],
  binderDefs: BinderDef[]
): ReviewQueue {
  const allByKey = new Map<string, string[]>();
  for (const c of allCards) {
    const k = printingFinishKey(c);
    const arr = allByKey.get(k);
    if (arr) arr.push(c.copyId);
    else allByKey.set(k, [c.copyId]);
  }

  const inBinderByKey = new Map<string, string[]>();
  for (const section of binder.sections) {
    for (const c of section.cards) {
      const k = printingFinishKey(c);
      const arr = inBinderByKey.get(k);
      if (arr) arr.push(c.copyId);
      else inBinderByKey.set(k, [c.copyId]);
    }
  }

  const groupsByKey = new Map<string, RemovedGroup>();
  for (const dc of drift.removed) {
    let destination: RemovedDestination;
    if (!dc.card) {
      destination = { kind: 'not-owned' };
    } else {
      const match = nextBinderMatch(dc.card, binderDefs);
      destination = match
        ? { kind: 'binder', binderId: match.id, binderName: match.name }
        : { kind: 'uncategorized' };
    }
    const gk = destinationKey(destination);
    let group = groupsByKey.get(gk);
    if (!group) {
      group = { destination, rows: [] };
      groupsByKey.set(gk, group);
    }
    // Every currently-owned copy of this printing — "Keep it here" re-pins all
    // of them, not just the one representative copy the drift diff kept.
    group.rows.push(toRow(dc, allByKey.get(dc.key) ?? []));
  }

  // Order: real binders by position (physical re-filing order), then
  // uncategorized, then not-owned last (nothing to physically move).
  const positionByBinderId = new Map(binderDefs.map((d) => [d.id, d.position]));
  const removedGroups = [...groupsByKey.values()].sort((a, b) => {
    const rank = (d: RemovedDestination) =>
      d.kind === 'binder'
        ? (positionByBinderId.get(d.binderId) ?? Infinity)
        : d.kind === 'uncategorized'
          ? 1e9
          : 1e10;
    return rank(a.destination) - rank(b.destination);
  });

  const addedRows = drift.added.map((dc) => toRow(dc, inBinderByKey.get(dc.key) ?? []));

  return { removedGroups, addedRows };
}

/** One-line label for a removed group's destination, used as the group header. */
export function formatDestination(d: RemovedDestination): string {
  switch (d.kind) {
    case 'binder':
      return `now in ${d.binderName}`;
    case 'uncategorized':
      return 'now uncategorized';
    case 'not-owned':
      return 'no longer owned';
  }
}

/**
 * Confirmation line for the "Don't add" action, computed BEFORE the exclusion
 * is applied: "if this binder didn't claim it, where would it land?" Uses
 * `excludeBinderId` (pretend this binder doesn't exist) rather than waiting
 * for the store's excludedCopyIds to update, so the caller can show it
 * immediately at click time.
 */
export function formatExcludeDestination(
  card: EnrichedCard,
  binderId: string,
  binderDefs: BinderDef[]
): string {
  const match = nextBinderMatch(card, binderDefs, { excludeBinderId: binderId });
  return match ? `Excluded — files to ${match.name}` : 'Excluded — files to Uncategorized';
}
