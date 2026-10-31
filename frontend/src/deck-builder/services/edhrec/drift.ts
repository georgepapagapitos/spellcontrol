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

export function isKnownCardlistTag(tag: string): boolean {
  const t = tag.toLowerCase();
  return t in TAG_TYPE_MAP || HIGHLIGHT_TAGS.has(t) || COMMANDER_LIST_TAGS.has(t);
}

const reported = new Set<string>();

/** Tests only: forget what has been reported this session. */
export function resetDriftReports(): void {
  reported.clear();
}

function report(source: string, kind: string, detail: string, message: string): void {
  const key = `${source}|${kind}|${detail}`;
  if (reported.has(key)) return;
  reported.add(key);
  try {
    // A plain object: no stack, so the row's frame stays empty and one
    // signature is one row.
    reportError('error', { message: `EDHREC drift (${source}): ${message}` });
  } catch {
    // Telemetry must never break parsing.
  }
}

export function reportUnknownTag(source: string, tag: string): void {
  report(source, 'unknown-tag', tag.toLowerCase(), `unknown cardlist tag "${tag.slice(0, 40)}"`);
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
    if (t in TAG_TYPE_MAP || HIGHLIGHT_TAGS.has(t)) views.push(...(l.cardviews ?? []));
  }
  checkFields('cardlists', views, CARDLIST_CHECKS);
}

export function checkCardPage(views: DriftCardview[]): void {
  checkFields('card-page', views, CARD_PAGE_CHECKS);
}

export function checkSaltPage(views: DriftCardview[]): void {
  checkFields('salt', views, SALT_CHECKS);
}
