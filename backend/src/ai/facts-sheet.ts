import type { BracketEstimation } from '@spellcontrol/deck-metrics';
import type { OracleEntry } from './deck-review';

/**
 * The computed facts sheet the review's two passes read before they write (E1020).
 *
 * The review kept inventing its weakness: "Krenko is not in the list", "no
 * sweeper" beside Fiery Confluence. The model was re-deriving facts the app
 * already knows how to compute, with thinking off. So the app computes them
 * and hands over the answer, with card NAMES, so a claim is checkable against
 * the sheet instead of against the model's memory of the list.
 *
 * Reuses the existing classifiers rather than adding one: the tagger tags the
 * bracket estimator reads (`tagger-tags.json`, via `getTagLookup`), the finer
 * Scryfall oracle-tag corpus (`otag-index.json`, via `backendOracleTagLookup`)
 * for target types, and the bracket estimate itself. A short rules-text
 * fallback catches cards neither tag set knows (a new set, or a modal card
 * tagged for only one of its modes); it only ever ADDS a card to a role.
 *
 * Pure: every lookup is injected. The route binds them to the real data, and
 * decides what an absent tag file means (no sheet at all, never a sheet that
 * confidently says "none" for every role).
 */

export interface FactsSheetInput {
  commanders: string[];
  cards: { name: string; qty: number }[];
  /** Oracle entries for the deck (cache hits only). */
  oracle: OracleEntry[];
  /** Tagger tag membership (`tagger-tags.json`). Required: without it there is no sheet. */
  taggerHas: (name: string, tag: string) => boolean;
  /** Scryfall oracle-tag membership (`otag-index.json`). Optional. */
  otagHas?: (name: string, slug: string) => boolean;
  /** The bracket estimate, when the caller could compute one. */
  bracket?: BracketEstimation | null;
}

interface RoleSpec {
  label: string;
  tagger: string[];
  otag: string[];
  text?: RegExp;
}

const NAME_CAP = 14;

const SPOT_TEXT =
  /\b(?:destroy|exile)\s+(?:up to \w+ )?target\s+(?:[\w-]+\s+){0,3}?(?:creature|permanent|planeswalker|artifact|enchantment)\b|\bdeals? \d+ damage to (?:any target|target creature)\b/i;
const SWEEPER_TEXT =
  /\b(?:destroy|exile) all (?:[\w-]+ )?(?:creatures?|permanents?|artifacts?|enchantments?|nonland permanents?)\b|\bdeals? (?:\d+|x) damage to each (?:other )?(?:non-?\w+ )?creature\b|\beach creature gets -\d+\/-\d+|\ball creatures get -\d+\/-\d+/i;
const COUNTER_TEXT = /\bcounter target (?:\w+ ){0,3}(?:spell|ability)\b/i;

const ROLES: Record<'ramp' | 'draw' | 'spot' | 'sweeper' | 'counter' | 'protect', RoleSpec> = {
  ramp: { label: 'Ramp', tagger: ['ramp'], otag: ['ramp'] },
  draw: { label: 'Card draw', tagger: ['draw'], otag: ['draw'] },
  spot: {
    label: 'Spot removal',
    tagger: ['spot-removal'],
    otag: ['spot-removal'],
    text: SPOT_TEXT,
  },
  sweeper: {
    label: 'Sweepers',
    tagger: ['boardwipe'],
    otag: ['sweeper'],
    text: SWEEPER_TEXT,
  },
  counter: {
    label: 'Counterspells',
    tagger: ['counterspell'],
    otag: ['counterspell'],
    text: COUNTER_TEXT,
  },
  protect: { label: 'Protection', tagger: ['protection'], otag: ['protection'] },
};

interface TargetSpec {
  label: string;
  otag: string[];
  text: RegExp;
}

/** What the deck can answer, by target type. `target permanent` answers all of them. */
const TARGETS: TargetSpec[] = [
  {
    label: 'creature',
    otag: ['removal-creature'],
    text: /\b(?:destroy|exile)\s+(?:up to \w+ )?target\s+(?:[\w-]+\s+){0,3}?(?:creature|permanent)\b|\bdeals? \d+ damage to (?:any target|target creature)\b|\bdeals? \d+ damage to each (?:other )?(?:non-?\w+ )?creature\b|\b(?:destroy|exile) all (?:[\w-]+ )?creatures?\b/i,
  },
  {
    label: 'artifact',
    otag: ['removal-artifact'],
    text: /\b(?:destroy|exile)\s+(?:up to \w+ )?target\s+(?:[\w-]+\s+){0,3}?(?:artifact|permanent)\b/i,
  },
  {
    label: 'enchantment',
    otag: ['removal-enchantment'],
    text: /\b(?:destroy|exile)\s+(?:up to \w+ )?target\s+(?:[\w-]+\s+){0,3}?(?:enchantment|permanent)\b/i,
  },
  {
    label: 'planeswalker',
    otag: ['removal-planeswalker'],
    text: /\b(?:destroy|exile)\s+(?:up to \w+ )?target\s+(?:[\w-]+\s+){0,3}?(?:planeswalker|permanent)\b|\bdeals? \d+ damage to any target\b/i,
  },
];

const frontType = (typeLine?: string) => (typeLine ?? '').split(' // ')[0];
const BASIC = /^(?:Snow-Covered )?(?:Plains|Island|Swamp|Mountain|Forest)$|^Wastes$/;
const isLand = (typeLine?: string, name?: string) =>
  typeLine ? /\bLand\b/.test(frontType(typeLine)) : BASIC.test(name ?? '');

function list(names: string[]): string {
  if (names.length === 0) return 'none';
  const shown = names.slice(0, NAME_CAP).join(', ');
  return names.length > NAME_CAP ? `${shown}, and ${names.length - NAME_CAP} more` : shown;
}

function pips(manaCost: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  // Only the front face: a back face is cast from the battlefield.
  for (const m of (manaCost ?? '')
    .split(' // ')[0]
    .matchAll(/\{([WUBRG])\}|\{([WUBRG])\/[WUBRGP2]\}/g)) {
    const c = (m[1] ?? m[2])!;
    out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}

/** Colors a land taps for, read from its rules text. Fetch lands produce no mana. */
function landColors(text: string | undefined): string[] {
  const t = text ?? '';
  const colors = new Set<string>();
  for (const m of t.matchAll(/\bAdd\b([^.]*)/g)) {
    if (/any (?:one )?(?:color|type)/i.test(m[1])) return ['W', 'U', 'B', 'R', 'G'];
    for (const s of m[1].matchAll(/\{([WUBRG])\}/g)) colors.add(s[1]);
  }
  return [...colors];
}

export function buildFactsSheet(input: FactsSheetInput): string {
  const { commanders, cards, oracle, taggerHas, otagHas, bracket } = input;
  const byName = new Map(oracle.map((o) => [o.name, o]));
  const cmd = new Set(commanders);
  const entries = cards.filter((c) => !cmd.has(c.name));
  // Nonland, noncommander cards: the ones a role is about. An unhydrated card
  // (cache miss) is assumed a spell; tags decide whether it lists anywhere.
  const spells = entries.filter((c) => !isLand(byName.get(c.name)?.typeLine, c.name));

  // Union of both tag sources. The tagger set is what the deck page's own role
  // counts (Roles: ... Board wipe N) come from, so a sheet built from the oracle
  // tags alone could say "Sweepers: none" beside a Statistics line counting
  // three (measured: it did, on fixture-3-healthy, and the review then called
  // the deck sweeper-less).
  const has = (name: string, tagger: string[], otag: string[]) =>
    tagger.some((t) => taggerHas(name, t)) ||
    (otagHas ? otag.some((t) => otagHas(name, t)) : false);
  const textOf = (name: string) => byName.get(name)?.oracleText ?? '';
  const inRole = (spec: RoleSpec) =>
    spells
      .filter(
        (c) =>
          has(c.name, spec.tagger, spec.otag) ||
          (spec.text ? spec.text.test(textOf(c.name)) : false)
      )
      .map((c) => c.name);

  const lines: string[] = [];
  lines.push(`- Commander${commanders.length > 1 ? 's' : ''}: ${commanders.join(' and ')}`);
  for (const spec of Object.values(ROLES)) {
    const names = inRole(spec);
    lines.push(`- ${spec.label} (${names.length}): ${list(names)}`);
  }

  const answers = TARGETS.map((t) => {
    const names = spells
      .filter(
        (c) =>
          (otagHas ? t.otag.some((o) => otagHas(c.name, o)) : false) || t.text.test(textOf(c.name))
      )
      .map((c) => c.name);
    return `${t.label}: ${list(names)}`;
  });
  const graveyard = spells
    .filter(
      (c) =>
        taggerHas(c.name, 'graveyard-hate') ||
        (otagHas ? otagHas(c.name, 'sweeper-graveyard') : false) ||
        /\bexile (?:all cards from )?(?:target player's|all|each player's|target opponent's) graveyard/i.test(
          textOf(c.name)
        )
    )
    .map((c) => c.name);
  answers.push(`graveyard: ${list(graveyard)}`);
  lines.push(`- Answers by target type: ${answers.join(' | ')}`);

  // Castability: colored pips the spells demand against the lands that make them.
  const demand: Record<string, number> = {};
  for (const c of spells) {
    const p = pips(byName.get(c.name)?.manaCost);
    for (const [k, v] of Object.entries(p)) demand[k] = (demand[k] ?? 0) + v * c.qty;
  }
  for (const k of commanders) {
    for (const [c, v] of Object.entries(pips(byName.get(k)?.manaCost)))
      demand[c] = (demand[c] ?? 0) + v;
  }
  const lands = entries.filter((c) => isLand(byName.get(c.name)?.typeLine, c.name));
  const landCount = lands.reduce((n, c) => n + c.qty, 0);
  const sources: Record<string, number> = {};
  for (const c of lands) {
    const text = byName.get(c.name)?.oracleText;
    for (const col of landColors(text)) sources[col] = (sources[col] ?? 0) + c.qty;
  }
  const order = ['W', 'U', 'B', 'R', 'G'].filter((c) => demand[c]);
  if (order.length > 0) {
    lines.push(
      `- Mana: ${landCount} lands. Colored mana symbols in spell costs (commander included): ` +
        `${order.map((c) => `${c} ${demand[c]}`).join(', ')}. ` +
        `Lands whose text adds that color: ${order.map((c) => `${c} ${sources[c] ?? 0}`).join(', ')} ` +
        '(a land that adds any color counts toward every color; fetch lands are not counted).'
    );
  }

  if (bracket) {
    const b = bracket.breakdown;
    const parts: string[] = [];
    if (b.gameChangerCount) parts.push(`game changers: ${list(b.gameChangerNames)}`);
    if (b.massLandDenialCount) parts.push(`mass land denial: ${list(b.massLandDenialNames)}`);
    if (b.extraTurnCount) parts.push(`extra turns: ${list(b.extraTurnNames)}`);
    if (b.tutorCount) parts.push(`tutors: ${list(b.tutorNames)}`);
    if (b.fastManaCount) parts.push(`fast mana: ${list(b.fastManaNames)}`);
    if (b.twoCardComboCount) parts.push(`complete two-card combos: ${b.twoCardComboCount}`);
    if (b.comboPieceNames?.length)
      parts.push(`combo pieces in the deck: ${list(b.comboPieceNames)}`);
    lines.push(`- Bracket signals: ${parts.length ? parts.join(' · ') : 'none found'}`);
  }

  return lines.join('\n');
}

/** The sheet as a user-message section. */
export function renderFactsSheet(sheet: string): string {
  return (
    '## Facts sheet (computed by the app from the decklist above; given data, not opinion)\n\n' +
    sheet
  );
}
