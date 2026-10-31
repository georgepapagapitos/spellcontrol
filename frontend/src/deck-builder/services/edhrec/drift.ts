import { reportError } from '@/lib/util/analytics';

/**
 * Runtime tripwire for EDHREC's undocumented JSON. A shape change has made a
 * feature go inert five times without a single error (inclusion to num_decks,
 * salt/prices/type_line dropped, salt label to number, highsynergycards to
 * highliftcards), so the parsers report what they did not expect: once per
 * signature per page load, as a counted client error in Admin → Analytics.
 * Reporting never changes a parse result and never throws.
 */

/** Cardlist tag (lowercased) to the MTG card type it implies. */
export const TAG_TYPE_MAP: Record<string, string> = {
  creatures: 'Creature',
  instants: 'Instant',
  sorceries: 'Sorcery',
  utilityartifacts: 'Artifact',
  manaartifacts: 'Artifact',
  enchantments: 'Enchantment',
  planeswalkers: 'Planeswalker',
  utilitylands: 'Land',
  lands: 'Land',
};

/** Card lists that imply no type: curated highlights. */
export const HIGHLIGHT_TAGS: ReadonlySet<string> = new Set([
  'newcards',
  'topcards',
  'gamechangers',
  'highsynergycards',
  'highliftcards',
]);

/** Commander lists on tag pages: not card pools, so no card-field checks. */
export const COMMANDER_LIST_TAGS: ReadonlySet<string> = new Set([
  'topcommanders',
  'newcommanders',
  'commanders',
]);

/** The card type a cardlist tag implies. An own-property lookup, so a tag
 *  named "constructor" or "__proto__" implies nothing rather than a builtin. */
export function tagType(tag: string): string | undefined {
  const t = tag.toLowerCase();
  return Object.hasOwn(TAG_TYPE_MAP, t) ? TAG_TYPE_MAP[t] : undefined;
}

export function isKnownCardlistTag(tag: string): boolean {
  const t = tag.toLowerCase();
  return tagType(t) !== undefined || HIGHLIGHT_TAGS.has(t) || COMMANDER_LIST_TAGS.has(t);
}

/**
 * Drift reports share the beacon's per-load error budget (10) with real
 * crashes, so each kind gets a small quota of its own: at most 4 rows a load.
 * Separate quotas keep a page full of new tags from crowding out a missing
 * field, which is the report that means a feature has gone inert.
 */
type DriftKind = 'unknown-tag' | 'missing-field';
const MAX_REPORTS_PER_KIND: Record<DriftKind, number> = { 'unknown-tag': 1, 'missing-field': 3 };

const reported = new Set<string>();
const countByKind = new Map<DriftKind, number>();

/** Tests only: forget what has been reported this session. */
export function resetDriftReports(): void {
  reported.clear();
  countByKind.clear();
}

function report(source: string, kind: DriftKind, detail: string, message: string): void {
  const key = `${source}|${kind}|${detail}`;
  if (reported.has(key)) return;
  const used = countByKind.get(kind) ?? 0;
  if (used >= MAX_REPORTS_PER_KIND[kind]) return;
  reported.add(key);
  countByKind.set(kind, used + 1);
  try {
    // A plain object: no stack, so the row's frame stays empty and one
    // signature is one row.
    reportError('error', { message: `EDHREC drift (${source}): ${message}` });
  } catch {
    // Telemetry must never break parsing.
  }
}

/** A tag-shaped name goes into the analytics row as is. Anything else is
 *  percent-encoded and cut to 40 characters, so the row stays plain text and
 *  two different odd tags stay two signatures. */
const TAG_SHAPE = /^[a-z0-9_+-]{1,40}$/;

/** encodeURIComponent throws on a lone surrogate, and a report must never
 *  break parsing. */
function encodeTag(t: string): string {
  try {
    return encodeURIComponent(t).slice(0, 40);
  } catch {
    return 'unparseable';
  }
}

export function reportUnknownTag(source: string, tag: string): void {
  const t = tag.toLowerCase();
  const safe = TAG_SHAPE.test(t) ? t : encodeTag(t);
  report(source, 'unknown-tag', safe, `unknown cardlist tag "${safe}"`);
}

/** Pages smaller than this say nothing about a field being gone. */
const MIN_SAMPLE = 10;

export interface DriftCardview {
  inclusion?: number;
  num_decks?: number;
  potential_decks?: number;
  synergy?: number;
  lift?: number;
  salt?: number;
  label?: string;
}

type Check = readonly [field: string, has: (c: DriftCardview) => boolean];

const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

const CARDLIST_CHECKS: readonly Check[] = [
  ['num_decks', (c) => num(c.num_decks) || num(c.inclusion)],
  ['potential_decks', (c) => num(c.potential_decks)],
  ['synergy-or-lift', (c) => num(c.synergy) || num(c.lift)],
];

const CARD_PAGE_CHECKS: readonly Check[] = [
  ['num_decks', (c) => num(c.num_decks) || num(c.inclusion)],
  ['potential_decks', (c) => num(c.potential_decks)],
  ['lift', (c) => num(c.lift)],
];

const SALT_CHECKS: readonly Check[] = [
  ['salt', (c) => num(c.salt) || /Salt Score:\s*[\d.]+/.test(c.label ?? '')],
];

function checkFields(source: string, views: DriftCardview[], checks: readonly Check[]): void {
  if (views.length < MIN_SAMPLE) return;
  for (const [field, has] of checks) {
    const missing = views.filter((c) => !has(c)).length;
    if (missing * 2 > views.length) {
      report(
        source,
        'missing-field',
        field,
        `${field} missing on ${missing} of ${views.length} cardviews`
      );
    }
  }
}

/** Commander / theme / tag page: field presence over every card-pool cardview. */
export function checkCardlistPage(
  lists: ReadonlyArray<{ tag: string; cardviews?: DriftCardview[] }>
): void {
  const views: DriftCardview[] = [];
  for (const l of lists) {
    const t = l.tag?.toLowerCase();
    if (!t || COMMANDER_LIST_TAGS.has(t)) continue;
    if (tagType(t) !== undefined || HIGHLIGHT_TAGS.has(t)) views.push(...(l.cardviews ?? []));
  }
  checkFields('cardlists', views, CARDLIST_CHECKS);
}

export function checkCardPage(views: DriftCardview[]): void {
  checkFields('card-page', views, CARD_PAGE_CHECKS);
}

export function checkSaltPage(views: DriftCardview[]): void {
  checkFields('salt', views, SALT_CHECKS);
}
