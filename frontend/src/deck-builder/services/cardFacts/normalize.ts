/**
 * Oracle-text normalization for the card-facts parser (see schema.ts).
 *
 * Every face's text is lowercased, reminder-stripped and whitespace-collapsed,
 * and every reference to the card itself becomes the token `cardname`: the
 * full name, each face's name, a legendary's short name ("Liliana" for
 * "Liliana, Dreadhorde General") and the modern self-references ("this
 * creature", "this Saga", ...). With self-references folded, "exile target
 * creature" can never be confused with "exile cardname", and two cards that
 * differ only in name read the same.
 *
 * `numberless` is the similarity variant: every number (digits, number words,
 * X) becomes N. The facts themselves keep the real numbers.
 */
import { stripReminder } from '../synergy/text';

/** Modern Oracle self-references. "this" + a card-type noun always means the card itself. */
const SELF_NOUNS =
  /\bthis (?:creature|artifact|enchantment|land|permanent|planeswalker|saga|aura|equipment|vehicle|card|spell|token|class|case|battle|siege|room|attraction|contraption|dungeon)\b/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Name variants that refer to the card itself, longest first. Only a
 * legendary gets a short name: Oracle writes "Liliana" for "Liliana,
 * Dreadhorde General" and "Meren" for "Meren of Clan Nel Toth", but never
 * "Sword" for "Sword of Feast and Famine".
 */
export function selfNames(
  cardName: string,
  faceNames: readonly string[],
  legendary: boolean
): string[] {
  const names = new Set<string>();
  for (const n of [cardName, ...cardName.split(' // '), ...faceNames]) {
    const lower = n.toLowerCase().replace(/[‘’]/g, "'").trim();
    if (!lower) continue;
    names.add(lower);
    if (!legendary) continue;
    const comma = lower.indexOf(',');
    if (comma > 2) names.add(lower.slice(0, comma));
    const of = lower.indexOf(' of ');
    if (of > 2 && !lower.slice(0, of).includes(' ')) names.add(lower.slice(0, of));
  }
  return [...names].sort((a, b) => b.length - a.length);
}

/** Lowercase, strip reminder text, fold self-references, collapse whitespace. */
export function normalizeLine(line: string, names: readonly string[]): string {
  let t = stripReminder(line)
    .toLowerCase()
    .replace(/[−–]/g, '-') // Scryfall's minus sign in loyalty costs
    .replace(/[‘’]/g, "'");
  for (const n of names) {
    t = t.replace(new RegExp(`(?<![a-z])${escapeRegExp(n)}(?![a-z])`, 'g'), 'cardname');
  }
  t = t.replace(SELF_NOUNS, 'cardname');
  return t.replace(/\s+/g, ' ').trim();
}

const NUMBER_WORDS =
  /\b(?:\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|twenty)\b/g;

/** The similarity variant: every number becomes N. */
export function numberless(text: string): string {
  return text.replace(NUMBER_WORDS, 'N');
}

/** Parse "3", "three", "x" into a number or 'X'; null when it isn't a count. */
export function parseCount(word: string | undefined): number | 'X' | null {
  if (!word) return null;
  const w = word.trim().toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  if (w === 'x') return 'X';
  const words: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    twenty: 20,
  };
  return words[w] ?? null;
}

/** Split an ability's text into sentences. Oracle never abbreviates, so ". " is a boundary. */
export function sentences(text: string): string[] {
  return text
    .split(/\.(?:\s+|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}
