/**
 * Scryfall oracle-tag (otag) lookup for binder rules.
 *
 * Loads the bundled `tagger-tags.json` snapshot (the same file the deck builder
 * uses, served from /public) and builds a name→tags reverse index so a binder
 * rule like "tag IS mana-rock" can be matched against the user's collection
 * offline. The routing engine reads `EnrichedCard.tags`; this module is what
 * decorates cards with it just before materializing — the tags are reference
 * data and are NEVER persisted or synced (they're derived from the card name).
 *
 * ponytail: independent fetch from the deck builder's own tagger client (same
 * URL, different index shape). The browser HTTP cache serves the second hit, so
 * the only real duplication is one extra parse when both subsystems run in a
 * session. Sharing one loader would force a core lib to import the self-contained
 * deck-builder subsystem (wrong dependency direction); not worth it.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { logger } from './logger';
import { isExpressionEmpty } from './rules';
import type { BinderDef, BinderFilter, BinderFilterGroup, EnrichedCard } from '../types';

const TAG_REPO_URL =
  (import.meta.env.VITE_TAG_REPO_URL as string | undefined) ?? '/tagger-tags.json';

interface TaggerData {
  generatedAt: string;
  tags: Record<string, string[]>;
}

/** name → tags, e.g. "Sol Ring" → ["mana-rock", "ramp"]. Null until loaded. */
let tagsByName: Map<string, string[]> | null = null;
/** Sorted list of tag keys present in the snapshot (for the editor picker). */
let availableTags: string[] = [];
let loadPromise: Promise<void> | null = null;

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isCardTagsReady(): boolean {
  return tagsByName !== null;
}

/** Idempotent load of the tag snapshot. Safe to call repeatedly. */
export async function ensureCardTags(): Promise<void> {
  if (tagsByName) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch(TAG_REPO_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TaggerData = await res.json();
      const byName = new Map<string, string[]>();
      for (const [tag, names] of Object.entries(data.tags)) {
        for (const name of names) {
          const list = byName.get(name);
          if (list) list.push(tag);
          else byName.set(name, [tag]);
        }
      }
      tagsByName = byName;
      availableTags = Object.keys(data.tags).sort();
      emit();
    } catch (err) {
      logger.warn(
        '[card-tags] Failed to load oracle-tag snapshot — binder tag rules will match nothing:',
        err
      );
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

/** Tags for a card name. Empty when the snapshot isn't loaded or the card is untagged. */
export function getCardTags(name: string): string[] {
  return tagsByName?.get(name) ?? [];
}

/** Tag keys available in the snapshot. Empty until loaded. */
export function listCardTags(): string[] {
  return availableTags;
}

/** A few tags whose kebab key doesn't title-case cleanly. */
const TAG_LABELS: Record<string, string> = {
  'card-advantage': 'Card advantage',
  'graveyard-hate': 'Graveyard hate',
  'mana-rock': 'Mana rock',
  'mana-dork': 'Mana dork',
  'mana-fix': 'Mana fixing',
  'cost-reducer': 'Cost reducer',
  'spot-removal': 'Spot removal',
  'mass-land-denial': 'Mass land denial',
  'extra-turn': 'Extra turn',
  'utility-land': 'Utility land',
};

/** Human label for a tag key, e.g. "mana-rock" → "Mana rock". */
export function cardTagLabel(tag: string): string {
  return TAG_LABELS[tag] ?? tag.charAt(0).toUpperCase() + tag.slice(1).replace(/-/g, ' ');
}

function filterUsesTags(f: BinderFilter): boolean {
  return !isExpressionEmpty(f.oracleTagChips);
}

/** True if any group has a rule that reads oracle tags (e.g. a draft being edited). */
export function groupsUseTags(groups: BinderFilterGroup[]): boolean {
  return groups.some((g) => filterUsesTags(g.filter));
}

/** True if any binder has a rule that reads oracle tags — gate to skip decoration otherwise. */
export function bindersUseTags(binders: BinderDef[]): boolean {
  return binders.some((b) => groupsUseTags(b.filterGroups));
}

/**
 * Return `cards` decorated with `.tags` from the snapshot. Returns the input
 * untouched when the snapshot isn't loaded; only allocates a copy for cards
 * that actually carry tags. Caller should gate on `bindersUseTags` to avoid
 * the array walk when no rule needs tags.
 */
export function decorateWithTags(cards: EnrichedCard[]): EnrichedCard[] {
  const byName = tagsByName;
  if (!byName) return cards;
  return cards.map((c) => {
    const tags = byName.get(c.name);
    return tags ? { ...c, tags } : c;
  });
}

/**
 * Subscribe to snapshot-readiness, triggering the (idempotent) load when
 * `active`. Re-renders the caller once the snapshot finishes loading.
 */
export function useCardTagsReady(active = true): boolean {
  const ready = useSyncExternalStore(subscribe, isCardTagsReady, isCardTagsReady);
  useEffect(() => {
    if (active) void ensureCardTags();
  }, [active]);
  return ready;
}

/**
 * Cards decorated with oracle tags, recomputed when the snapshot loads or the
 * inputs change. Triggers the (idempotent) snapshot load on first use. When
 * `usesTags` is false, returns `cards` by reference — zero cost. Pass
 * `bindersUseTags(binders)` (view) or `groupsUseTags(draftGroups)` (editor).
 */
export function useCardsWithTags(cards: EnrichedCard[], usesTags: boolean): EnrichedCard[] {
  const ready = useCardTagsReady(usesTags);
  // Memoize so the decorated array is stable across renders — a fresh array
  // every render would re-trigger downstream materialize unnecessarily. `ready`
  // flips once on load, which is the only time the module index changes.
  return useMemo(
    () => (usesTags && ready ? decorateWithTags(cards) : cards),
    [cards, usesTags, ready]
  );
}
