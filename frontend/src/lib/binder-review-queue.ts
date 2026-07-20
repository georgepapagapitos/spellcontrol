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

/** Where an incoming card is physically sitting right now — the other end of
 *  the move the group header renders (`source → here`). */
export type AddedSource =
  | { kind: 'binder'; binderId: string; binderName: string }
  | { kind: 'uncategorized' };

export interface AddedGroup {
  source: AddedSource;
  rows: ReviewQueueRow[];
}

export interface ReviewQueue {
  removedGroups: RemovedGroup[];
  addedGroups: AddedGroup[];
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

/** Stable identity for an added group — used as its React list key. */
export function sourceKey(s: AddedSource): string {
  return s.kind === 'binder' ? `binder:${s.binderId}` : s.kind;
}

/**
 * Builds the review queue's row/group structure from a drift result. Pure —
 * no store reads, no mutation. The per-row `copyIds` roll up every owned copy
 * sharing that printing+finish so a bulk "Keep it here" / "Don't add" click
 * applies to all of them, not just the one representative in `DriftCard`.
 *
 * Every group is one physical MOVE anchored on the viewed binder:
 *
 * - Removed rows are grouped by where the card now lands (`here → X`,
 *   computed via `nextBinderMatch`, which — after the E88
 *   exclusion-fall-through fix — mirrors `materializeBinders` exactly):
 *   another binder, uncategorized, or "not owned" for a card that left the
 *   collection entirely (no live card to route).
 * - Added rows are grouped by where the cardboard sits right now (`X → here`):
 *   the binder whose last-reviewed snapshot still holds the key is where the
 *   user last confirmed it physically lives (that binder's own queue shows
 *   the matching outbound row). No snapshot holds it → it was never filed
 *   into a reviewed binder, i.e. the unsorted pile (Uncategorized).
 *   ponytail: snapshot-holder is a per-key guess — copies of one printing
 *   split between a reviewed binder and a fresh import all point at the
 *   binder; the row's reason line ("newly imported from …") keeps the
 *   provenance visible.
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

  const positionByBinderId = new Map(binderDefs.map((d) => [d.id, d.position]));

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
  const removedGroups = [...groupsByKey.values()].sort((a, b) => {
    const rank = (d: RemovedDestination) =>
      d.kind === 'binder'
        ? (positionByBinderId.get(d.binderId) ?? Infinity)
        : d.kind === 'uncategorized'
          ? 1e9
          : 1e10;
    return rank(a.destination) - rank(b.destination);
  });

  // Snapshot holders, in position order — the physical-source lookup table
  // for incoming cards (see doc comment above).
  const holders = binderDefs
    .filter((d) => d.id !== binder.def.id)
    .sort((a, b) => a.position - b.position)
    .flatMap((d) =>
      d.lastReviewedSnapshot ? [{ def: d, keys: new Set(d.lastReviewedSnapshot.keys) }] : []
    );

  const addedBySource = new Map<string, AddedGroup>();
  for (const dc of drift.added) {
    const holder = holders.find((h) => h.keys.has(dc.key));
    const source: AddedSource = holder
      ? { kind: 'binder', binderId: holder.def.id, binderName: holder.def.name }
      : { kind: 'uncategorized' };
    const sk = sourceKey(source);
    let group = addedBySource.get(sk);
    if (!group) {
      group = { source, rows: [] };
      addedBySource.set(sk, group);
    }
    group.rows.push(toRow(dc, inBinderByKey.get(dc.key) ?? []));
  }

  // Same physical-walk order as removed groups: binders by position, then
  // the unsorted pile last.
  const addedGroups = [...addedBySource.values()].sort((a, b) => {
    const rank = (s: AddedSource) =>
      s.kind === 'binder' ? (positionByBinderId.get(s.binderId) ?? Infinity) : 1e9;
    return rank(a.source) - rank(b.source);
  });

  return { removedGroups, addedGroups };
}

/** Short "to …" phrase for a removed group's route — bulk-action aria-labels
 *  and anywhere the move needs to be a plain string. */
export function formatDestinationLabel(d: RemovedDestination): string {
  switch (d.kind) {
    case 'binder':
      return `to ${d.binderName}`;
    case 'uncategorized':
      return 'to Uncategorized';
    case 'not-owned':
      return 'no longer owned';
  }
}

/** Short "from …" phrase for an added group's route — mirrors
 *  `formatDestinationLabel`. */
export function formatSourceLabel(s: AddedSource): string {
  return s.kind === 'binder' ? `from ${s.binderName}` : 'from Uncategorized';
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
