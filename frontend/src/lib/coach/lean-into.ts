import type {
  CommanderProfile,
  CommanderKeyword,
} from '@/deck-builder/services/deckBuilder/commanderProfile';
import { PILL_REASONS, whyCardMatches } from '@/deck-builder/services/deckBuilder/whyCardMatches';
import { hasTag } from '@/deck-builder/services/tagger/client';
import type { Change } from './deck-change';

/**
 * "Lean into <theme>": the free half of E260. It re-orders rows the Coach feed
 * ALREADY holds, by a theme the commander or the deck's own engines already
 * have. No AI call, no reading spent.
 *
 * ⚠️ It is deliberately a RE-RANK of the feed, never a filter on the AI refine
 * pool. The pool's names are part of the server's `hashRefineInput`, so
 * narrowing it would silently change the input and spend a reading. Nothing
 * here touches `refinePool`; `DeckEditorLayout` hands the pool to
 * `DeckAiRefine` untouched. `CoachFeed.lean.test.tsx` pins that.
 */

export interface LeanTheme {
  /** `ability:<keyword>` or `axis:<label>`. */
  id: string;
  /** Chip text. */
  label: string;
  /** How many rows in the feed serve it. */
  count: number;
}

/** Commander keywords the tagger can also vouch for by name, for rows that
 *  carry no resolved card (thin EDHREC rows). Same keyword, same pill text. */
const TAGS_BY_KEYWORD: Partial<Record<CommanderKeyword, string[]>> = {
  lifegain: ['lifegain'],
  sacrifice: ['sacrifice'],
  tutor: ['tutor', 'land-tutor'],
  draw: ['draw', 'card-advantage'],
  'wheel-discard': ['wheel'],
  'extra-turn': ['extra-turn'],
  ramp: ['ramp'],
};

interface ThemeDef {
  id: string;
  label: string;
  /** The sentence on a row that serves it. */
  note: string;
  serves: (change: Change) => boolean;
}

function abilityDefs(profile: CommanderProfile | null): ThemeDef[] {
  if (!profile) return [];
  const out: ThemeDef[] = [];
  const seen = new Set<string>();
  for (const ability of profile.abilities) {
    const kw = ability.keyword;
    if (kw === 'tribal' || seen.has(kw)) continue;
    seen.add(kw);
    const pill = PILL_REASONS[kw];
    const tags = TAGS_BY_KEYWORD[kw] ?? [];
    out.push({
      id: `ability:${kw}`,
      label: ability.label,
      note: `Leans into ${ability.label.toLowerCase()}: ${pill}`,
      serves: (c) =>
        (c.card ? whyCardMatches(c.card, profile, 99).includes(pill) : false) ||
        tags.some((t) => hasTag(c.name, t)),
    });
  }
  return out;
}

function axisDefs(changes: Change[]): ThemeDef[] {
  const labels = new Map<string, string>();
  for (const c of changes) if (c.axis && !c.budding) labels.set(c.axis, c.group ?? c.axis);
  return [...labels].map(([axis, label]) => ({
    id: `axis:${axis}`,
    label,
    note: `Leans into your ${label.toLowerCase()} engine`,
    serves: (c: Change) => c.axis === axis && !c.budding,
  }));
}

const eligible = (c: Change) => c.type !== 'cut';

/** Themes worth offering: the few that the feed's rows actually serve, most
 *  rows first (commander abilities win a tie, they are the stronger claim). */
export function deriveLeanThemes(
  changes: Change[],
  profile: CommanderProfile | null,
  max = 3
): LeanTheme[] {
  const rows = changes.filter(eligible);
  return [...abilityDefs(profile), ...axisDefs(rows)]
    .map((d, i) => ({
      id: d.id,
      label: d.label,
      count: rows.filter(d.serves).length,
      i,
    }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.i - b.i)
    .slice(0, max)
    .map(({ id, label, count }) => ({ id, label, count }));
}

/**
 * Stable partition: rows serving the theme first, everything else after, each
 * group in its original order. Returns the notes keyed by change id so a row
 * can say which theme it serves.
 */
export function leanRank<T extends { change: Change }>(
  rows: T[],
  themeId: string,
  changes: Change[],
  profile: CommanderProfile | null
): { rows: T[]; notes: Map<string, string> } {
  const def = [...abilityDefs(profile), ...axisDefs(changes.filter(eligible))].find(
    (d) => d.id === themeId
  );
  if (!def) return { rows, notes: new Map() };
  const notes = new Map<string, string>();
  const hit: T[] = [];
  const rest: T[] = [];
  for (const r of rows) {
    if (eligible(r.change) && def.serves(r.change)) {
      hit.push(r);
      notes.set(r.change.id, def.note);
    } else rest.push(r);
  }
  return { rows: [...hit, ...rest], notes };
}
