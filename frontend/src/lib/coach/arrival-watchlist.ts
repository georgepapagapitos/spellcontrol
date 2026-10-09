/**
 * The cards each deck's coach wants, remembered so Home can say "+N new
 * cards" and mean the same N the deck page shows.
 *
 * A new arrival (lib/coach/new-arrivals.ts) is any owned card in the deck's color
 * identity acquired since the deck last changed. On a real import that reads
 * as random, so the deck page narrows it to the cards the coach recommends
 * (`CoachLanes`) plus the missing piece of a one-away combo.
 * Home can't build that list itself: it needs the deck's analysis, owned
 * names and a combo fetch. So the deck page records the list here whenever it
 * works it out, and Home intersects the raw arrivals with it. A later import
 * of a wanted card still counts without reopening the deck; a deck never
 * opened on this browser has no list, and so no badge.
 *
 * Per browser on purpose: this is a hint, and syncing it would write a deck
 * row on every visit. Store-free and dependency-free so Home's boot path
 * pays nothing for it.
 */
import type { ArrivalsByType } from './new-arrivals';

const KEY = 'sc-arrival-watch';

export type ArrivalWatchlists = Readonly<Record<string, ReadonlySet<string>>>;

interface OneAwayLike {
  missingOracleIds: readonly string[];
  combo: { cards: readonly { oracleId: string; cardName: string }[] };
}

/**
 * The coach lanes a new arrival is checked against: the ones that name a card
 * whether or not you own it. Owned substitutes and owned land swaps are left
 * out on purpose. They can only name a card once you hold it, so a list
 * recorded before a purchase never has it, and Home would count fewer cards
 * than the deck page. The type takes no such lane, so one can't slip in.
 */
export interface CoachLanes {
  gaps?: readonly { name: string }[];
  synergy?: readonly { cardName: string }[];
  hiddenGems?: readonly { name: string }[];
}

/** Lowercased names the coach wants for a deck: its gaps, synergy picks and
 *  hidden gems, plus the one card that completes each one-away combo. */
export function coachWantedNames(
  lanes: CoachLanes,
  oneAway: readonly OneAwayLike[] | undefined
): Set<string> {
  const wanted = new Set<string>();
  for (const g of lanes.gaps ?? []) wanted.add(g.name.toLowerCase());
  for (const s of lanes.synergy ?? []) wanted.add(s.cardName.toLowerCase());
  for (const g of lanes.hiddenGems ?? []) wanted.add(g.name.toLowerCase());
  for (const m of oneAway ?? []) {
    if (m.missingOracleIds.length !== 1) continue;
    const piece = m.combo.cards.find((c) => c.oracleId === m.missingOracleIds[0]);
    if (piece) wanted.add(piece.cardName.toLowerCase());
  }
  return wanted;
}

/** The deck page's arrivals, narrowed to the wanted names. */
export function narrowArrivals(
  arrivalsByType: ArrivalsByType,
  wanted: ReadonlySet<string>
): ArrivalsByType {
  const out: ArrivalsByType = {};
  for (const [bucket, rows] of Object.entries(arrivalsByType)) {
    const kept = rows.filter((r) => wanted.has(r.name.toLowerCase()));
    if (kept.length > 0) out[bucket as keyof ArrivalsByType] = kept;
  }
  return out;
}

export function readArrivalWatchlists(): ArrivalWatchlists {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, ReadonlySet<string>> = {};
    for (const [id, names] of Object.entries(parsed)) {
      if (Array.isArray(names)) out[id] = new Set(names.filter((n) => typeof n === 'string'));
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Record a deck's wanted names. Writes only when the list changed, and drops
 * entries for decks that no longer exist (`liveDeckIds`).
 */
export function rememberArrivalWatchlist(
  deckId: string,
  wanted: ReadonlySet<string>,
  liveDeckIds: Iterable<string>
): void {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const stored: Record<string, string[]> =
      raw && typeof raw === 'object' ? (raw as Record<string, string[]>) : {};
    const live = new Set(liveDeckIds);
    live.add(deckId);
    const next: Record<string, string[]> = {};
    for (const [id, names] of Object.entries(stored)) if (live.has(id)) next[id] = names;
    next[deckId] = [...wanted].sort();
    const before = JSON.stringify(stored);
    const after = JSON.stringify(next);
    if (before !== after) localStorage.setItem(KEY, after);
  } catch {
    // Private mode / quota: Home just shows no badge for this deck.
  }
}
