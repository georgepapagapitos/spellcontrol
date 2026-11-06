// A previewed card: Scryfall reads every card `not_legal` in every format
// until its release date, so a deck built from a set a week out (Star Trek
// Commander, TRC, released 2026-11-13) flagged each of its new cards as not
// legal in Commander. The commander zone already built these and disclosed
// the date (commanderEligibility); this is the same fact for the 99.

/** Today in the player's calendar, as Scryfall writes dates ("2026-09-29"). */
export function localIsoDate(now: Date): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

/** A release date ("2026-11-13") in the app's short date format ("Nov 13, 2026"). */
export function formatReleaseDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? isoDate
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Scryfall's field names, so a ScryfallCard passes as is. */
interface Dated {
  released_at?: string;
  legalities?: Record<string, string>;
}

/** The card's release date when it hasn't released yet, else null. */
export function upcomingReleaseDate(card: Dated, now: Date = new Date()): string | null {
  return card.released_at && card.released_at > localIsoDate(now) ? card.released_at : null;
}

/**
 * Formats that take every paper set on release, so `not_legal` on an unreleased
 * card only means "not out yet". Standard, Pioneer, Modern, Pauper, Brawl and
 * Pauper Commander take only some sets (or rarities), so a preview card there
 * may stay not legal after release, and keeps its flag.
 */
const LEGAL_ON_RELEASE = new Set(['commander', 'legacy', 'vintage']);

/** Not legal in the format only because it hasn't released yet. */
export function isPreviewOnlyIllegal(
  card: Dated,
  legalityKey: string,
  now: Date = new Date()
): boolean {
  return (
    LEGAL_ON_RELEASE.has(legalityKey) &&
    card.legalities?.[legalityKey] === 'not_legal' &&
    upcomingReleaseDate(card, now) !== null
  );
}

/** Legal in the format, not legal only because it hasn't released yet, or no
 *  legality data to say otherwise (card search: an unknown never hides a card). */
export function readsFormatLegal(
  card: Dated,
  legalityKey: string,
  now: Date = new Date()
): boolean {
  const status = card.legalities?.[legalityKey];
  return (
    !status ||
    status === 'legal' ||
    status === 'restricted' ||
    isPreviewOnlyIllegal(card, legalityKey, now)
  );
}
