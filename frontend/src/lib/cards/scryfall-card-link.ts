/**
 * Read Scryfall card references out of a link, a pasted URL or a dropped HTML
 * fragment. Dragging a card image off scryfall.com hands the drop a
 * `text/uri-list` (the card page, `scryfall.com/card/{set}/{number}/{slug}`)
 * and a `text/html` fragment whose `<img src>` is the CDN image, named by the
 * printing's Scryfall id. Either one names an exact printing, so both are read.
 *
 * Pure and bounded: input is capped before any regex runs, and every pattern
 * is a literal-anchored scan with bounded repetition, so a hostile paste can't
 * make it backtrack (CodeQL's ReDoS query runs on this repo).
 */

export type ScryfallCardRef = { id: string } | { set: string; number: string };

/** Longer input is cut to this before scanning. A dragged selection of a whole
 *  Scryfall results page is well under it. */
export const MAX_LINK_INPUT = 50_000;
/** At most this many cards come out of one drop or paste. */
export const MAX_CARD_REFS = 50;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// Collector numbers carry letters (`123a`, `A-12`), stars (`★`, or
// `%E2%98%85` percent-encoded) and daggers. Bounded, and `%` never matches the
// class, so the alternation can't overlap itself.
const NUMBER = '(?:[a-z0-9★†-]|%[0-9a-f]{2}){1,32}';
// A set code or collector number ends at a path, query, fragment, attribute
// quote, whitespace or tag boundary.
const END = `(?=[/?#"'\\s<>&)]|$)`;
// Not preceded by a host character, so `notscryfall.com` never matches.
const START = '(?<![a-z0-9.-])(?:https?:\\/\\/)?';
// Endpoints under api.scryfall.com/cards/ that look like `{set}/{number}` but
// aren't (an MTGO or Arena id lookup, the named/search endpoints).
const NOT_A_SET = '(?!(?:mtgo|arena|named|search|random|collection)\\/)';

const PAGE = new RegExp(
  `${START}(?:www\\.)?scryfall\\.com\\/card\\/([a-z0-9]{3,6})\\/(${NUMBER})${END}`,
  'giu'
);
const IMAGE = new RegExp(
  `${START}(?:cards\\.scryfall\\.io|c[0-9]\\.scryfall\\.com|img\\.scryfall\\.com)` +
    `(?:\\/file\\/scryfall-cards|\\/cards)?\\/[a-z_]{3,20}\\/(?:front|back)\\/[0-9a-f]\\/[0-9a-f]\\/` +
    `(${UUID})\\.(?:jpe?g|png|webp)`,
  'giu'
);
const API_ID = new RegExp(`${START}api\\.scryfall\\.com\\/cards\\/(${UUID})${END}`, 'giu');
const API_SET = new RegExp(
  `${START}api\\.scryfall\\.com\\/cards\\/${NOT_A_SET}([a-z0-9]{3,6})\\/(${NUMBER})${END}`,
  'giu'
);

const SCRYFALL_HOST = /^(?:https?:\/\/)?(?:[a-z0-9]{1,10}\.)?scryfall\.(?:com|io)(?:[/?#]|$)/i;

/** True when the whole (trimmed) text is a link somewhere on Scryfall, card or
 *  not. Lets a search box tell "a Scryfall link that isn't a card" apart from
 *  an ordinary query. */
export function isScryfallLink(text: string): boolean {
  const t = text.trim();
  return t.length <= 2048 && !/\s/.test(t) && SCRYFALL_HOST.test(t);
}

function decodeNumber(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Every Scryfall card the text names, in the order it names them, without
 * duplicates. When the text carries any printing id (an image or API id URL),
 * only the ids are returned: a dragged card brings both its page link and its
 * image, which name the same printing, and the id is the exact one. Text that
 * mentions no Scryfall card gives an empty list.
 */
export function parseScryfallCardRefs(text: string): ScryfallCardRef[] {
  if (!text) return [];
  const input = text.length > MAX_LINK_INPUT ? text.slice(0, MAX_LINK_INPUT) : text;

  const found: Array<{ at: number; ref: ScryfallCardRef }> = [];
  for (const re of [IMAGE, API_ID]) {
    for (const m of input.matchAll(re))
      found.push({ at: m.index, ref: { id: m[1].toLowerCase() } });
  }
  const hasIds = found.length > 0;
  if (!hasIds) {
    for (const re of [PAGE, API_SET]) {
      for (const m of input.matchAll(re)) {
        found.push({ at: m.index, ref: { set: m[1].toLowerCase(), number: decodeNumber(m[2]) } });
      }
    }
  }

  found.sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  const refs: ScryfallCardRef[] = [];
  for (const { ref } of found) {
    const key = 'id' in ref ? ref.id : `${ref.set}/${ref.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
    if (refs.length === MAX_CARD_REFS) break;
  }
  return refs;
}
