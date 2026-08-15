/**
 * The ⌘K command palette's command model and matcher.
 *
 * Deliberately NOT built on `lib/shortcut-registry` — that registry holds
 * display data (`{keys, description}`) for the `?` overlay and has no handlers,
 * so there is nothing there to execute. This module owns the executable half.
 *
 * Pure by construction: `buildCommands` takes its navigation callback, so the
 * whole command surface is testable without a router or a store.
 */
import type { Deck } from '../store/decks';

/** Groups render in this order, and only when they have matches. 'Cards' is
 *  the async Scryfall lane (E247): `buildCommands` never emits it — the
 *  palette appends those rows as search results arrive. */
export const COMMAND_GROUPS = ['Navigate', 'Your decks', 'Actions', 'AI', 'Cards'] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export interface Command {
  /** Stable key — also the option id for `aria-activedescendant`. */
  id: string;
  label: string;
  group: CommandGroup;
  /** Secondary line (a deck's commander, a route's parent section). */
  hint?: string;
  /** Words that should match but do not appear in the label. */
  keywords?: string[];
  run: () => void;
}

/** Top-level destinations, in the order the app's own nav presents them. */
const ROUTES: ReadonlyArray<{ label: string; path: string; hint?: string; keywords?: string[] }> = [
  { label: 'Home', path: '/home' },
  { label: 'Collection', path: '/collection', keywords: ['cards', 'owned'] },
  { label: 'Binders', path: '/collection/binders', hint: 'Collection' },
  { label: 'Lists', path: '/collection/lists', hint: 'Collection' },
  { label: 'Combos', path: '/collection/combos', hint: 'Collection' },
  { label: 'Sets', path: '/collection/sets', hint: 'Collection' },
  { label: 'Cubes', path: '/collection/cube', hint: 'Collection' },
  { label: 'Decks', path: '/decks' },
  { label: 'Discover decks', path: '/decks/discover', hint: 'Decks' },
  { label: 'Saved decks', path: '/decks/saved', hint: 'Decks' },
  { label: 'Compare decks', path: '/decks/compare', hint: 'Decks' },
  { label: 'Play', path: '/play', keywords: ['game', 'life', 'counters'] },
  { label: 'Friends', path: '/friends' },
  { label: 'Trades', path: '/trades' },
  { label: 'Pods', path: '/pods' },
  { label: 'Search', path: '/search', keywords: ['find', 'scryfall'] },
  { label: 'Tags', path: '/tags' },
  { label: 'You', path: '/you', keywords: ['profile', 'settings', 'account'] },
];

/**
 * The secondary line for a deck row.
 *
 * Most decks in this app are named after their commander, and "Abigale →
 * Abigale, Eloquent First-Year" is a tautology that costs a line and tells the
 * reader nothing — four sibling decks then render as four identical rows. So
 * the commander is shown only when it actually adds a fact; otherwise the size
 * is, which is what the decks index leads with too.
 */
function deckHint(deck: Deck): string {
  const commander = deck.commander?.name;
  const size = `${deck.cards.length} cards`;
  if (!commander) return size;
  const redundant = norm(commander).startsWith(norm(deck.name));
  return redundant ? size : `${commander} · ${size}`;
}

export interface BuildCommandsCtx {
  decks: readonly Deck[];
  /** Navigate to a path; `state` mirrors react-router's location state. */
  go: (path: string, state?: Record<string, unknown>) => void;
  /**
   * AI feature reachable for this account (`useAiStatus()` non-null). The AI
   * group self-hides like every AI surface — absent, not greyed out (E247).
   */
  aiAvailable?: boolean;
  /** The deck page currently open, when there is one — enables deck-scoped AI. */
  deckPage?: { id: string; name: string } | null;
}

/**
 * The full command surface for the current app state.
 *
 * Decks are included by name so "abi" reaches a deck without a trip through
 * the decks index. Only real destinations and real handlers are listed — a
 * command that cannot fire is worse than an absent one.
 */
export function buildCommands({ decks, go, aiAvailable, deckPage }: BuildCommandsCtx): Command[] {
  const out: Command[] = ROUTES.map((r) => ({
    id: `nav:${r.path}`,
    label: r.label,
    group: 'Navigate' as const,
    hint: r.hint,
    keywords: r.keywords,
    run: () => go(r.path),
  }));

  for (const deck of decks) {
    out.push({
      id: `deck:${deck.id}`,
      label: deck.name,
      group: 'Your decks',
      hint: deckHint(deck),
      // Still searchable by commander even when the hint doesn't show it.
      keywords: deck.commander?.name ? [deck.commander.name] : undefined,
      run: () => go(`/decks/${deck.id}`),
    });
  }

  out.push(
    {
      id: 'action:new-deck',
      label: 'New deck',
      group: 'Actions',
      keywords: ['create', 'build'],
      run: () => go('/decks/new'),
    },
    {
      id: 'action:guided-build',
      label: 'Guided build',
      group: 'Actions',
      hint: 'New deck',
      run: () => go('/decks/new/guided'),
    },
    {
      // DecksIndexPage owns the import dialog as local state, so the palette
      // asks for it through location state — the same channel DeckNewPage's
      // `prefill` already uses. No new global store for one boolean.
      id: 'action:import-deck',
      label: 'Import deck',
      group: 'Actions',
      keywords: ['upload', 'moxfield', 'archidekt'],
      run: () => go('/decks', { openImport: true }),
    }
  );

  // AI commands exist only while the feature is reachable — same self-hiding
  // rule as every AI surface (unavailable ⇒ absent, never greyed out).
  if (aiAvailable) {
    if (deckPage) {
      out.push({
        id: 'ai:read-deck',
        label: 'Read the deck',
        group: 'AI',
        hint: deckPage.name,
        keywords: ['ai', 'review', 'reading', 'coach'],
        // The Coach tab hosts the review panel; `openAiReview` asks it to
        // arrive expanded — the same location-state channel Import deck uses.
        run: () => go(`/decks/${deckPage.id}?view=tune`, { openAiReview: true }),
      });
    }
    out.push({
      id: 'ai:settings',
      label: 'AI settings',
      group: 'AI',
      hint: 'You',
      keywords: ['beta', 'opt in', 'readings', 'quota'],
      run: () => go('/you?section=ai'),
    });
  }

  return out;
}

/** Fold accents and case so "Jarad" matches "jarád" and "JARAD". */
const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Rank one command against a query. Higher is better; 0 means "no match".
 *
 * A plain deterministic ladder rather than fuzzy subsequence matching: with a
 * command list this small, users type a prefix, and fuzzy scoring mostly
 * produces surprising winners ("dec" matching "Discover **dec**ks" above
 * "**Dec**ks"). Prefix beats word-start beats substring, and the label always
 * outranks a keyword.
 */
export function scoreCommand(command: Command, query: string): number {
  const q = norm(query.trim());
  if (!q) return 1;
  const label = norm(command.label);

  if (label === q) return 100;
  if (label.startsWith(q)) return 90;
  // Word-start inside the label: "saved" in "Discover saved decks".
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(label)) return 70;
  if (label.includes(q)) return 50;

  for (const kw of command.keywords ?? []) {
    const k = norm(kw);
    if (k.startsWith(q)) return 40;
    if (k.includes(q)) return 30;
  }
  if (command.hint && norm(command.hint).includes(q)) return 20;

  return 0;
}

export interface CommandGroupResult {
  group: CommandGroup;
  commands: Command[];
}

/**
 * Filter + rank into render-ready groups.
 *
 * Ties keep the source order, so an empty query renders the natural list
 * (nav in app order, decks in store order) instead of an arbitrary shuffle.
 */
export function matchCommands(
  commands: readonly Command[],
  query: string,
  limitPerGroup = 6
): CommandGroupResult[] {
  const scored = commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const out: CommandGroupResult[] = [];
  for (const group of COMMAND_GROUPS) {
    const inGroup = scored.filter((s) => s.command.group === group).slice(0, limitPerGroup);
    if (inGroup.length > 0) out.push({ group, commands: inGroup.map((s) => s.command) });
  }
  return out;
}

/** Flatten grouped results back to the keyboard-navigation order. */
export function flattenGroups(groups: readonly CommandGroupResult[]): Command[] {
  return groups.flatMap((g) => g.commands);
}
