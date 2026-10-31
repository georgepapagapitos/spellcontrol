/**
 * The pure half of GET /api/edhrec/page/*: which EDHREC pages the browser may
 * read through us, and whether a fetched body is shaped like that page.
 *
 * Not an open proxy: the host is fixed (page-store.ts), the path must match
 * one of the shapes frontend/src/deck-builder/services/edhrec/client.ts
 * actually requests, every segment is lowercase letters, digits and hyphens
 * (the slugs formatCommanderNameForUrl and EDHREC's own tag/theme/combo slugs
 * produce), and there is no query passthrough. The URL we fetch is rebuilt from
 * the matched segments, never the raw request string.
 */

const SEG = '[a-z0-9][a-z0-9-]{0,119}';

export type EdhrecPageKind =
  | 'commander' // /pages/commanders/<slug>[/<bracket>][/<theme>][/<budget>]
  | 'average-deck'
  | 'partners'
  | 'tag'
  | 'salt'
  | 'combos'
  | 'combo-detail'
  | 'card'
  | 'typeahead';

const PATTERNS: ReadonlyArray<{ kind: EdhrecPageKind; re: RegExp }> = [
  // Commander pages: slug, then optional bracket, theme and budget segments.
  { kind: 'commander', re: new RegExp(`^/pages/commanders/${SEG}(?:/${SEG}){0,3}\\.json$`) },
  { kind: 'average-deck', re: new RegExp(`^/pages/average-decks/${SEG}(?:/${SEG}){0,3}\\.json$`) },
  { kind: 'partners', re: new RegExp(`^/pages/partners/${SEG}\\.json$`) },
  { kind: 'tag', re: new RegExp(`^/pages/tags/${SEG}(?:/${SEG})?\\.json$`) },
  { kind: 'salt', re: /^\/pages\/top\/salt\.json$/ },
  { kind: 'combos', re: new RegExp(`^/pages/combos/${SEG}\\.json$`) },
  { kind: 'combo-detail', re: new RegExp(`^/pages/combos/${SEG}/${SEG}\\.json$`) },
  { kind: 'card', re: new RegExp(`^/pages/cards/${SEG}\\.json$`) },
  { kind: 'typeahead', re: /^\/static\/typeahead\/commanders$/ },
];

export interface EdhrecPageRef {
  kind: EdhrecPageKind;
  /** The EDHREC path, built from the pattern's own matches. Also the cache key. */
  path: string;
}

/** The page a request path names, or null when it isn't an allowlisted page. */
export function parseEdhrecPagePath(raw: string): EdhrecPageRef | null {
  if (raw.length > 400) return null;
  for (const { kind, re } of PATTERNS) {
    const m = re.exec(raw);
    // Return the regex's own match (the allowlist's value), not the input.
    if (m) return { kind, path: m[0] };
  }
  return null;
}

/** The host every page is fetched from, with the slash after it. */
const EDHREC_ORIGIN = 'https://json.edhrec.com/';

/**
 * The upstream URL for an allowlisted path. The constant prefix ends in the
 * slash after the host, so nothing appended can change the host (a request
 * value never sits next to the authority), which is also the shape CodeQL's
 * js/request-forgery accepts. Throws on a path parseEdhrecPagePath didn't
 * produce, so a future caller can't skip the allowlist.
 */
export function edhrecPageUrl(path: string): string {
  if (parseEdhrecPagePath(path)?.path !== path) throw new Error('not an allowlisted EDHREC page');
  return EDHREC_ORIGIN + path.slice(1);
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

/** Share of cardviews that must carry a field. Same bar as MIN_FIELD_SHARE in
 *  frontend/scripts/upstream-contract-lib.mjs (the nightly check). */
const MIN_FIELD_SHARE = 0.9;

function share<T>(items: readonly T[], pred: (t: T) => boolean): number {
  return items.length ? items.filter(pred).length / items.length : 0;
}

/**
 * Ingest gate: null when `body` is shaped like a `kind` page, else why not.
 *
 * Deliberately a floor, not the nightly check's full contract. That one asserts
 * what a popular commander's page must carry (core type lists, a theme list),
 * and a small commander or a niche theme legitimately lacks those, so it would
 * reject good pages. This asks what every page of the kind must carry for the
 * readers to work, and catches the failure modes that have actually happened:
 * an HTML/error body, an emptied page, and a renamed count or salt field.
 * An EDHREC `{ redirect }` answer is a valid page (client.ts follows it).
 */
export function pageShapeProblem(kind: EdhrecPageKind, body: unknown): string | null {
  if (kind === 'typeahead') {
    return Array.isArray(body) && body.length >= 100 && body.every((n) => typeof n === 'string')
      ? null
      : 'typeahead is not a list of 100+ names';
  }
  if (!isObj(body)) return 'body is not an object';
  if (typeof body.redirect === 'string') return null;
  if (kind === 'average-deck' || kind === 'partners') {
    return Object.keys(body).length > 0 ? null : 'empty object';
  }
  if (kind === 'combo-detail') {
    return isObj(body.combo) ? null : 'combo is missing';
  }
  const container = isObj(body.container) ? body.container : undefined;
  const dict = container && isObj(container.json_dict) ? container.json_dict : undefined;
  const lists = dict?.cardlists;
  if (!Array.isArray(lists) || lists.length === 0) {
    return 'container.json_dict.cardlists is missing or empty';
  }
  const views: Record<string, unknown>[] = [];
  for (const l of lists) {
    const cv = isObj(l) ? l.cardviews : undefined;
    if (!Array.isArray(cv)) return 'a cardlist has no cardviews array';
    for (const v of cv) if (isObj(v)) views.push(v);
  }
  if (views.length === 0) return 'no cardviews';
  if (kind === 'combos') {
    return share(views, (v) => typeof v.name === 'string' && v.name.length > 0) >= MIN_FIELD_SHARE
      ? null
      : 'combo cardviews lost their names';
  }
  if (share(views, (v) => typeof v.name === 'string' && v.name.length > 0) < 1) {
    return 'a cardview has no name';
  }
  if (kind === 'salt') {
    return share(views, (v) => isNum(v.salt)) >= MIN_FIELD_SHARE ? null : 'salt field is gone';
  }
  // commander, tag, card: a deck count under either name EDHREC has used.
  return share(views, (v) => isNum(v.num_decks) || isNum(v.inclusion)) >= MIN_FIELD_SHARE
    ? null
    : 'num_decks/inclusion is gone from the cardviews';
}
