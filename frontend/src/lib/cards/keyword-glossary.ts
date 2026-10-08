import { useEffect, useMemo, useState } from 'react';

/**
 * Keyword links in card rules text. `public/keyword-glossary.json` is derived
 * from the Comprehensive Rules by scripts/keyword-glossary.mjs: one row per
 * keyword ability / action with the sentence of its rule that says what it
 * does. It is ~15 KB gzipped, so card text can link its keywords without the
 * ~1 MB rules bundle, which loads only when someone opens the full rule.
 */
export interface KeywordGloss {
  name: string;
  rule: string;
  kind: 'ability' | 'action';
  text: string;
}

interface GlossaryFile {
  meta: { effective: string };
  keywords: KeywordGloss[];
}

/**
 * Keyword actions that are the everyday verbs of rules text. A link on every
 * "destroy", "exile" and "create" would underline half of every card and
 * tell nobody anything; the rules reference still has them.
 */
const NOT_LINKED = new Set([
  'Activate',
  'Attach',
  'Cast',
  'Counter',
  'Create',
  'Destroy',
  'Discard',
  'Double',
  'Triple',
  'Exchange',
  'Exile',
  'Fight',
  'Play',
  'Reveal',
  'Sacrifice',
  'Search',
  'Shuffle',
  'Tap and Untap',
  'Transform',
]);

/**
 * Other ways a keyword is printed. Landwalk is always "islandwalk",
 * "nonbasic landwalk"; typecycling ("basic landcycling", "wizardcycling") is
 * cycling (702.29); multikicker is kicker (702.33c); daybound and nightbound
 * are printed one at a time.
 */
const ALIASES: Record<string, string[]> = {
  Landwalk: ['(?:island|swamp|forest|mountain|plains|desert)walk'],
  Cycling: ['\\p{L}+cycling'],
  Kicker: ['multikicker'],
  'Daybound and Nightbound': ['daybound', 'nightbound'],
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A keyword action is a verb, so rules text conjugates it: "investigates",
 * "scries", "is goaded", "faces a villainous choice". The first word takes
 * the endings; the rest of the phrase is matched as written.
 */
function conjugated(name: string): string {
  const [first, ...rest] = name.split(' ');
  const tail = rest.map((w) => ` ${escapeRe(w)}`).join('');
  if (/^the$/i.test(first)) return escapeRe(name);
  let head: string;
  if (/[^aeiou]y$/i.test(first)) head = `${escapeRe(first.slice(0, -1))}(?:y|ies|ied|ying)`;
  else if (/e$/i.test(first)) head = `${escapeRe(first.slice(0, -1))}(?:e|es|ed|ing)`;
  else head = `${escapeRe(first)}(?:s|es|ed|ing)?`;
  return head + tail;
}

export interface KeywordMatcher {
  re: RegExp;
  /** `entries[i]` owns capture group `i + 1`. */
  entries: KeywordGloss[];
}

export function buildKeywordMatcher(keywords: KeywordGloss[]): KeywordMatcher {
  const linked = keywords.filter((k) => !NOT_LINKED.has(k.name) && !/[()]/.test(k.name));
  // Longest name first, so "Manifest Dread" wins over "Manifest" at the same spot.
  linked.sort((a, b) => b.name.length - a.name.length);
  const groups = linked.map((k) => {
    const forms = [k.kind === 'action' ? conjugated(k.name) : escapeRe(k.name)];
    forms.push(...(ALIASES[k.name] ?? []));
    return `(${forms.join('|')})`;
  });
  // A keyword is a whole word: "flash" is not in "flashback", "ward" is not in "toward".
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${groups.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  return { re, entries: linked };
}

export type OracleSegment =
  | { kind: 'text'; text: string }
  | { kind: 'reminder'; text: string }
  | { kind: 'keyword'; text: string; entry: KeywordGloss };

/**
 * A card's names as its rules text may print them: each face of "A // B",
 * and a legendary's short name — "Annie Flash, the Veteran" is "Annie Flash"
 * in its own text.
 */
function selfNames(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const full of names) {
    for (const face of full.split(' // ')) {
      out.add(face);
      if (face.includes(', ')) out.add(face.slice(0, face.indexOf(', ')));
    }
  }
  return [...out].filter(Boolean);
}

/** Where each of `names` sits in `line`, so a card's own name is never read as a keyword. */
function nameSpans(line: string, names: readonly string[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const name of names) {
    if (!name) continue;
    for (let at = line.indexOf(name); at >= 0; at = line.indexOf(name, at + name.length)) {
      spans.push([at, at + name.length]);
    }
  }
  return spans;
}

function linkPlain(
  text: string,
  matcher: KeywordMatcher,
  seen: Set<string>,
  spans: Array<[number, number]>,
  offset: number
): OracleSegment[] {
  const out: OracleSegment[] = [];
  let last = 0;
  matcher.re.lastIndex = 0;
  for (let m = matcher.re.exec(text); m; m = matcher.re.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    const inName = spans.some(([a, b]) => offset + start < b && offset + end > a);
    const group = m.findIndex((g, i) => i > 0 && g !== undefined);
    const entry = matcher.entries[group - 1];
    if (inName || !entry || seen.has(entry.name)) continue;
    seen.add(entry.name);
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) });
    out.push({ kind: 'keyword', text: m[0], entry });
    last = end;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/**
 * Card rules text as lines of segments: reminder text (the parentheticals,
 * italic on the printed card) apart from the rest, and each keyword linked
 * the first time it appears on the face — "Flying, trample … creatures with
 * flying" links flying once. Reminder text is never linked; it is already the
 * explanation. `names` are the card's own names, which are never keywords
 * ("Arrow Storm deals 4 damage" is not storm). With no matcher (the
 * glossary hasn't loaded, or failed to) the text comes back unlinked.
 */
export function segmentOracle(
  text: string,
  matcher: KeywordMatcher | null,
  names: readonly string[] = []
): OracleSegment[][] {
  const seen = new Set<string>();
  const own = selfNames(names);
  return text.split('\n').map((line) => {
    const spans = nameSpans(line, own);
    const out: OracleSegment[] = [];
    let offset = 0;
    for (const part of line.split(/(\([^)]*\))/g)) {
      if (!part) continue;
      if (part.startsWith('(') && part.endsWith(')')) out.push({ kind: 'reminder', text: part });
      else if (matcher) out.push(...linkPlain(part, matcher, seen, spans, offset));
      else out.push({ kind: 'text', text: part });
      offset += part.length;
    }
    return out;
  });
}

/** Where the glossary is served from (public/, generated by scripts/keyword-glossary.mjs). */
export const KEYWORD_GLOSSARY_URL = '/keyword-glossary.json';

/** How a keyword's kind reads beside its name: the popover and the search hit say it the same way. */
export const KEYWORD_KIND_LABEL: Record<KeywordGloss['kind'], string> = {
  ability: 'Keyword ability',
  action: 'Keyword action',
};

let cache: Promise<{ matcher: KeywordMatcher; lookup: KeywordLookup }> | null = null;

/** Fetch the glossary once and build what reads it. A failed load is retried on the next call. */
function loadGlossary() {
  if (!cache) {
    cache = fetch(KEYWORD_GLOSSARY_URL)
      .then((r) => {
        if (!r.ok) throw new Error("Couldn't load the keyword glossary.");
        return r.json() as Promise<GlossaryFile>;
      })
      .then((file) => {
        const matcher = buildKeywordMatcher(file.keywords);
        return { matcher, lookup: buildKeywordLookup(file.keywords, matcher) };
      });
    cache.catch(() => {
      cache = null;
    });
  }
  return cache;
}

/** The matcher that links keywords in card text. */
export function loadKeywordMatcher(): Promise<KeywordMatcher> {
  return loadGlossary().then((g) => g.matcher);
}

/** Answers "is this whole query a keyword?" for card search. */
export type KeywordLookup = (query: string) => KeywordGloss | null;

const normName = (s: string) => s.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim();

/**
 * A query names a keyword when it IS one: its exact name in any case
 * ("WARD", "scry", including everyday verbs like "destroy", which card text
 * leaves unlinked but a lookup can still want), or a form card text prints it
 * in ("scried", "islandwalk", "multikicker"). A keyword inside a longer query
 * ("ward elf", "t:creature ward") is a card search, never a rules hit.
 */
export function buildKeywordLookup(
  keywords: KeywordGloss[],
  matcher: KeywordMatcher
): KeywordLookup {
  const byName = new Map(keywords.map((k) => [normName(k.name), k]));
  const whole = new RegExp(`^(?:${matcher.re.source})$`, 'iu');
  return (query) => {
    const q = normName(query);
    if (q.length < 3) return null;
    const exact = byName.get(q);
    if (exact) return exact;
    const m = whole.exec(q);
    if (!m) return null;
    const group = m.findIndex((g, i) => i > 0 && g !== undefined);
    return group > 0 ? matcher.entries[group - 1] : null;
  };
}

/** The keyword lookup, from the matcher's one fetch (the ~15 KB glossary, never the ~1 MB rules bundle). */
export function loadKeywordLookup(): Promise<KeywordLookup> {
  return loadGlossary().then((g) => g.lookup);
}

/** A query that could be a word, not Scryfall syntax: letters, spaces, hyphens, apostrophes. */
const PLAIN_WORDS = /^[\p{L}' ’-]+$/u;

/**
 * The keyword a search query names, or null. The glossary loads only once a
 * query could be one, so a syntax search (`t:dragon`) never fetches it.
 */
export function useKeywordLookup(query: string): KeywordGloss | null {
  const plain = query.trim().length >= 3 && PLAIN_WORDS.test(query.trim());
  const [lookup, setLookup] = useState<KeywordLookup | null>(null);
  useEffect(() => {
    if (!plain || lookup) return;
    let alive = true;
    loadKeywordLookup().then(
      (l) => alive && setLookup(() => l),
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [plain, lookup]);
  return useMemo(() => (plain && lookup ? lookup(query) : null), [plain, lookup, query]);
}

/**
 * The keyword matcher, or null until it loads. Card text renders unlinked in
 * the meantime and gains its links in place, underline only, so nothing moves.
 * A failed load leaves the text as it always was.
 */
export function useKeywordMatcher(): KeywordMatcher | null {
  const [matcher, setMatcher] = useState<KeywordMatcher | null>(null);
  useEffect(() => {
    let alive = true;
    loadKeywordMatcher().then(
      (m) => alive && setMatcher(m),
      () => {}
    );
    return () => {
      alive = false;
    };
  }, []);
  return matcher;
}

/**
 * A card's rules text as lines of segments, keywords linked once the
 * glossary has loaded. `names` are the card's
 * own names, which are never read as keywords.
 */
export function useRulesText(text: string, names: readonly string[] = []): OracleSegment[][] {
  const matcher = useKeywordMatcher();
  // Joined so a fresh `names` array each render doesn't re-run the match.
  const joined = names.join('\n');
  return useMemo(() => segmentOracle(text, matcher, joined.split('\n')), [text, matcher, joined]);
}
