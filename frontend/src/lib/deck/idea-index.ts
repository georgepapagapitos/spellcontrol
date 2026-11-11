import { useCallback, useEffect, useState } from 'react';
import type { EnrichedCard } from '@/types/index';

/**
 * Deck ideas (E1112): the closed list the generator can start from, read from
 * `public/idea-index.json` (built by `scripts/refresh-idea-index.mjs` from
 * EDHREC's tag list). An idea is a creature type or a way to play; the list is
 * the whole vocabulary, so typed text only ever filters it and never drives a
 * build. Loaded by the generator pages alone, never the boot path.
 */

export type IdeaKind = 'typal' | 'playstyle';

export interface Idea {
  /** EDHREC tag slug, also the route param and the commander theme slug. */
  slug: string;
  name: string;
  kind: IdeaKind;
  /** Singular creature type a typal idea counts in a collection ("Angel"). */
  type?: string;
  /** Commander decks carrying the tag. */
  decks: number;
  /** Commanders on the tag page (the page shows its top 18). */
  commanders: number;
  /** A card name for the tile's art: the idea's most-built commander. */
  card: string;
}

/** What the generator's banner needs to disclose an idea-seeded build; carried on the route's prefill. */
export interface IdeaSeedContext {
  slug: string;
  name: string;
  kind: IdeaKind;
  /** The commander's EDHREC theme of this idea was found and preselected. */
  themeSelected: boolean;
  /** Decks the chosen commander has under this idea (the grid tile's count), when known. */
  decks?: number;
}

export interface IdeaIndex {
  generatedAt: string;
  ideas: Idea[];
  /** Search terms per slug beyond the name ("sac" for Aristocrats). */
  aliases: Record<string, string[]>;
}

export function parseIdeaIndex(json: unknown): IdeaIndex | null {
  if (!json || typeof json !== 'object') return null;
  const raw = json as { generatedAt?: unknown; ideas?: unknown; aliases?: unknown };
  if (!Array.isArray(raw.ideas)) return null;
  const ideas = raw.ideas.filter(
    (i): i is Idea =>
      !!i &&
      typeof i.slug === 'string' &&
      typeof i.name === 'string' &&
      (i.kind === 'typal' || i.kind === 'playstyle') &&
      typeof i.decks === 'number'
  );
  if (ideas.length === 0) return null;
  const aliases =
    raw.aliases && typeof raw.aliases === 'object' ? (raw.aliases as Record<string, string[]>) : {};
  // Most built first: the shelves and every tie-break read this order.
  ideas.sort((a, b) => b.decks - a.decks);
  return {
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '',
    ideas,
    aliases,
  };
}

let indexPromise: Promise<IdeaIndex | null> | null = null;

/** Loads the snapshot once per page load; a failed load resets so a later call retries. */
export function loadIdeaIndex(): Promise<IdeaIndex | null> {
  if (!indexPromise) {
    indexPromise = fetch('/idea-index.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(parseIdeaIndex)
      .then((index) => {
        if (!index) indexPromise = null;
        return index;
      })
      .catch(() => {
        indexPromise = null;
        return null;
      });
  }
  return indexPromise;
}

export function __resetIdeaIndexForTests(): void {
  indexPromise = null;
}

export type IdeaIndexState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; index: IdeaIndex };

/**
 * The snapshot as component state, with a retry for the one failure surface. `enabled: false`
 * (a finder with no idea support) never fetches it and stays `loading`.
 */
export function useIdeaIndex(enabled = true): IdeaIndexState & { retry: () => void } {
  const [state, setState] = useState<IdeaIndexState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadIdeaIndex().then((index) => {
      if (!cancelled) setState(index ? { status: 'ready', index } : { status: 'error' });
    });
    return () => {
      cancelled = true;
    };
  }, [attempt, enabled]);
  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  return { ...state, retry };
}

export function findIdea(index: IdeaIndex, slug: string): Idea | undefined {
  return index.ideas.find((i) => i.slug === slug);
}

// ── Search ────────────────────────────────────────────────────────────────

export function normalizeQuery(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Everything a person might type for an idea: its name, the singular type, and the aliases. */
export function ideaTerms(idea: Idea, index: IdeaIndex): string[] {
  const terms = [normalizeQuery(idea.name)];
  if (idea.type) terms.push(normalizeQuery(idea.type));
  for (const a of index.aliases[idea.slug] ?? []) terms.push(normalizeQuery(a));
  return terms;
}

const wordsOf = (s: string) => s.split(/[\s/-]+/).filter(Boolean);

function scoreIdea(terms: string[], q: string): number {
  const tokens = wordsOf(q);
  let best = 0;
  for (const t of terms) {
    if (t === q) best = Math.max(best, 100);
    else if (t.startsWith(q)) best = Math.max(best, 80);
    else if (wordsOf(t).some((w) => w.startsWith(q))) best = Math.max(best, 60);
    else if (tokens.length > 1 && tokens.every((tok) => wordsOf(t).some((w) => w.startsWith(tok))))
      best = Math.max(best, 50);
    else if (q.length >= 3 && t.includes(q)) best = Math.max(best, 40);
  }
  return best;
}

/** Ideas matching what was typed, best match first and most built among equals. */
export function searchIdeas(index: IdeaIndex, text: string, limit = 6): Idea[] {
  const q = normalizeQuery(text);
  if (!q) return [];
  return index.ideas
    .map((idea) => ({ idea, score: scoreIdea(ideaTerms(idea, index), q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.idea.decks - a.idea.decks)
    .slice(0, limit)
    .map((r) => r.idea);
}

/**
 * The ideas nearest a query that matched nothing: those sharing the most words (or word starts of
 * three letters or more) with it, most built first. With no overlap at all, the most built ideas,
 * flagged `fallback` so the caller doesn't call them close.
 */
export function nearestIdeas(
  index: IdeaIndex,
  text: string,
  limit = 4
): { ideas: Idea[]; fallback: boolean } {
  const tokens = wordsOf(normalizeQuery(text)).filter((t) => t.length >= 3);
  const scored = index.ideas
    .map((idea) => {
      const words = ideaTerms(idea, index).flatMap(wordsOf);
      const hits = tokens.filter((tok) =>
        words.some((w) => w.startsWith(tok) || (w.length >= 3 && tok.startsWith(w)))
      ).length;
      return { idea, hits };
    })
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.idea.decks - a.idea.decks);
  if (scored.length > 0)
    return { ideas: scored.slice(0, limit).map((r) => r.idea), fallback: false };
  const popular = [...index.ideas].sort((a, b) => b.decks - a.decks).slice(0, limit);
  return { ideas: popular, fallback: true };
}

/** Commander names containing what was typed, name-starts first. Needs three letters so a stray "a" lists nothing. */
export function matchCommanderNames(names: readonly string[], text: string, limit = 4): string[] {
  const q = normalizeQuery(text);
  if (q.length < 3) return [];
  const starts: string[] = [];
  const wordStarts: string[] = [];
  const inside: string[] = [];
  for (const name of names) {
    if (name.includes('//')) continue;
    const n = normalizeQuery(name);
    if (n.startsWith(q)) starts.push(name);
    else if (wordsOf(n).some((w) => w.startsWith(q))) wordStarts.push(name);
    else if (n.includes(q)) inside.push(name);
  }
  return [...starts, ...wordStarts, ...inside].slice(0, limit);
}

// ── Collection ────────────────────────────────────────────────────────────

/** The subtypes of a type line, lowercased and padded so " time lord " can be tested whole. */
function subtypeKey(typeLine: string): string {
  const subs = typeLine
    .split('//')
    .map((face) => face.split(/[—–]/)[1] ?? '')
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return subs ? ` ${subs} ` : '';
}

/** Distinct owned card names per typal idea, counted from the collection's own type lines. */
export function ownedTypeCounts(
  cards: readonly Pick<EnrichedCard, 'name' | 'typeLine'>[],
  ideas: readonly Idea[]
): Map<string, number> {
  const subtypesByName = new Map<string, string>();
  for (const c of cards) {
    if (!c.typeLine || subtypesByName.has(c.name)) continue;
    subtypesByName.set(c.name, subtypeKey(c.typeLine));
  }
  const counts = new Map<string, number>();
  for (const idea of ideas) {
    if (idea.kind !== 'typal' || !idea.type) continue;
    const needle = ` ${idea.type.toLowerCase()} `;
    let n = 0;
    for (const key of subtypesByName.values()) if (key.includes(needle)) n++;
    if (n > 0) counts.set(idea.slug, n);
  }
  return counts;
}

/** A collection needs this many distinct cards of a type before the shelf says it could build it. */
export const MIN_OWNED_FOR_SHELF = 12;

/** Typal ideas the collection holds enough of to start from, fullest first. */
export function collectionCouldBuild(
  counts: ReadonlyMap<string, number>,
  index: IdeaIndex,
  limit = 4
): Array<{ idea: Idea; owned: number }> {
  return index.ideas
    .filter((i) => (counts.get(i.slug) ?? 0) >= MIN_OWNED_FOR_SHELF)
    .map((idea) => ({ idea, owned: counts.get(idea.slug) ?? 0 }))
    .sort((a, b) => b.owned - a.owned || b.idea.decks - a.idea.decks)
    .slice(0, limit);
}

/** One line under an idea's name. */
export function ideaBlurb(idea: Idea): string {
  return idea.kind === 'typal'
    ? `The commanders that lead ${idea.name.toLowerCase()}, most built first.`
    : `The commanders built around ${idea.name}, most built first.`;
}

/** Shown beside the kind: "Creature type" or "Way to play". */
export function ideaKindLabel(kind: IdeaKind): string {
  return kind === 'typal' ? 'Creature type' : 'Way to play';
}

/**
 * "Giada, Font of Hope" -> "Giada"; "Kaalia of the Vast" -> "Kaalia"; "The Ur-Dragon" stays whole.
 * The word on a "Build with" button, so it only has to be unmistakable beside the full name.
 */
export function shortCommanderName(name: string): string {
  const front = name.split(' // ')[0];
  const beforeComma = front.split(',')[0];
  if (front.includes(',') || beforeComma.length <= 16) return beforeComma;
  const words = beforeComma.split(' ');
  return /^(the|a|an)$/i.test(words[0]) ? words.slice(0, 2).join(' ') : words[0];
}

/**
 * Ideas that show up among the themes of an idea's leading commanders, most shared first
 * ("Pairs well with"). `themeLists` is one EDHREC theme list per commander; the idea itself is
 * left out, and only slugs on the closed idea list count.
 */
export function relatedIdeas(
  index: IdeaIndex,
  self: Idea,
  themeLists: ReadonlyArray<ReadonlyArray<{ slug: string; count?: number }>>,
  limit = 4
): Idea[] {
  const score = new Map<string, number>();
  for (const themes of themeLists) {
    for (const t of themes) {
      if (t.slug === self.slug) continue;
      score.set(t.slug, (score.get(t.slug) ?? 0) + 1_000_000 + (t.count ?? 0));
    }
  }
  return index.ideas
    .filter((i) => score.has(i.slug))
    .sort((a, b) => (score.get(b.slug) ?? 0) - (score.get(a.slug) ?? 0))
    .slice(0, limit);
}
