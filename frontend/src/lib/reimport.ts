import type { EnrichedCard } from '../types';
import type { ImportHistoryEntry } from './local-cards';

/**
 * Re-import detection for the import-mode prompt.
 *
 * Importing in "merge" mode appends every incoming card with a fresh copyId —
 * there is no dedup (by design: a physical collection can hold real
 * duplicates). So re-importing an updated export (the common "refresh my
 * collection" flow) and choosing "Add to collection" silently stacks a SECOND
 * copy of every card. This module spots the case so the UI can warn and steer
 * the user to "Replace" instead.
 *
 * Two signals, in increasing strength:
 * - `findPriorImports`: an incoming source whose NAME matches a name already
 *   in import history. Soft — used only to prime the import-mode dialog's
 *   copy before the user has picked a mode. A renamed export of the same
 *   collection has a different name, so this alone misses it.
 * - `findContentReimportMatch`: the incoming batch's actual card content
 *   (once parsed) overlaps a specific prior import almost entirely, by both
 *   which printings and how many of each. Name-independent, so it catches the
 *   renamed-file case. Strong enough to gate the import rather than merely
 *   annotate it — see its own doc comment for the threshold rationale.
 */

/** Internal labels that aren't real source files — their content can't be
 *  identified by name, so they never count as a re-import. */
const SYNTHETIC_LABELS: ReadonlySet<string> = new Set(['pasted-list', 'scanned-cards']);

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Returns the prior import-history entries (most-recent first) whose name
 * matches one of `incomingNames`. A non-empty result means the user is likely
 * re-importing something already in their collection. At most one entry per
 * distinct name — the most recent one.
 */
export function findPriorImports(
  incomingNames: readonly string[],
  history: readonly ImportHistoryEntry[]
): ImportHistoryEntry[] {
  const wanted = new Set(
    incomingNames
      .filter((n) => !SYNTHETIC_LABELS.has(n))
      .map(normalize)
      .filter(Boolean)
  );
  if (wanted.size === 0) return [];

  const latestByName = new Map<string, ImportHistoryEntry>();
  for (const entry of history) {
    const key = normalize(entry.name);
    if (!wanted.has(key)) continue;
    const current = latestByName.get(key);
    if (!current || entry.addedAt > current.addedAt) latestByName.set(key, entry);
  }
  return [...latestByName.values()].sort((a, b) => b.addedAt - a.addedAt);
}

type Fingerprintable = Pick<EnrichedCard, 'scryfallId' | 'name' | 'setCode' | 'finish'>;

/** Identity key for a single printing+finish: scryfallId when we have it
 *  (unambiguous), falling back to normalized name+set for unresolved rows. */
function fingerprintKey(c: Fingerprintable): string {
  const printing = c.scryfallId || `${normalize(c.name)}::${normalize(c.setCode)}`;
  return `${printing}::${c.finish}`;
}

function fingerprintProfile(cards: readonly Fingerprintable[]): Map<string, number> {
  const profile = new Map<string, number>();
  for (const c of cards) {
    const key = fingerprintKey(c);
    profile.set(key, (profile.get(key) ?? 0) + 1);
  }
  return profile;
}

// Both ratios must clear this to gate. High on purpose — false positives are
// worse than false negatives here (per the ticket): a new partial batch that
// happens to include a few staples you already own (a booster pack with a
// Sol Ring) shares only a handful of printings with the collection, so its
// PRINTING overlap ratio stays low. A genuine re-export of the same
// collection shares essentially every printing at essentially the same
// quantities, so both ratios land near 1.0. 0.85 leaves headroom for a
// collection that grew a little between exports (new pulls added, nothing
// removed) while still requiring the bulk of the incoming batch to be an
// exact echo of a specific prior import.
const PRINTING_OVERLAP_THRESHOLD = 0.85;
const QUANTITY_OVERLAP_THRESHOLD = 0.85;

export interface ContentReimportMatch {
  entry: ImportHistoryEntry;
  /** Fraction of the incoming batch's distinct (printing, finish) keys already present in `entry`. */
  printingOverlap: number;
  /** Fraction of the incoming batch's card count matched by `entry`'s quantities, key-for-key. */
  quantityOverlap: number;
}

/**
 * Content-based re-import detection: compares the incoming batch's
 * (printing, finish) quantity profile against each prior import's own cards
 * (identified via their stamped `importId`). Returns the single
 * strongest match if it clears both thresholds above, else null.
 *
 * Unlike `findPriorImports`, this needs the incoming cards already parsed
 * (post Scryfall-resolve) — call it once the upload/paste response is in
 * hand, before committing a 'merge' import to the store.
 */
export function findContentReimportMatch(
  incoming: readonly Fingerprintable[],
  history: readonly ImportHistoryEntry[],
  existingCards: readonly (Fingerprintable & { importId?: string })[]
): ContentReimportMatch | null {
  if (incoming.length === 0 || history.length === 0) return null;
  const incomingProfile = fingerprintProfile(incoming);
  const incomingTotal = incoming.length;

  let best: ContentReimportMatch | null = null;
  for (const entry of history) {
    if (!entry.id) continue;
    const entryCards = existingCards.filter((c) => c.importId === entry.id);
    if (entryCards.length === 0) continue;
    const entryProfile = fingerprintProfile(entryCards);

    let overlapKeys = 0;
    let overlapQty = 0;
    for (const [key, count] of incomingProfile) {
      const matchCount = entryProfile.get(key);
      if (matchCount) {
        overlapKeys += 1;
        overlapQty += Math.min(count, matchCount);
      }
    }
    const printingOverlap = overlapKeys / incomingProfile.size;
    const quantityOverlap = overlapQty / incomingTotal;
    if (
      printingOverlap >= PRINTING_OVERLAP_THRESHOLD &&
      quantityOverlap >= QUANTITY_OVERLAP_THRESHOLD &&
      (!best || quantityOverlap > best.quantityOverlap)
    ) {
      best = { entry, printingOverlap, quantityOverlap };
    }
  }
  return best;
}
