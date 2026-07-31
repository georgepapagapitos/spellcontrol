/**
 * Scryfall oracle-tag (otag) lookup for binder rules and the card-tags sheet.
 *
 * Loads the bundled `otag-index.json` artifact (built by
 * scripts/refresh-otag-index.mjs from Scryfall's oracle_tags + oracle_cards bulk
 * feeds) and builds a name→tags index so a binder rule like "tag IS mana-rock"
 * can be matched against the user's collection offline. The routing engine reads
 * `EnrichedCard.tags`; this module decorates cards with it just before
 * materializing — the tags are reference data and are NEVER persisted or synced
 * (they're derived from the card name).
 *
 * NOT the same corpus as the deck builder's `tagger-tags.json`. That file is 23
 * hand-curated functional buckets its role classification is tuned against; this
 * is the full ~4.5k-tag community vocabulary for display and filtering. Kept
 * separate on purpose so deck generation can't shift when the corpus does.
 *
 * Tag hierarchy is pre-expanded at build time (a card tagged
 * `hate-graveyard-cast` already carries `hate-graveyard` here), so lookup stays a
 * plain Map hit with no ancestor walk.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { logger } from './logger';
import { isExpressionEmpty } from './rules';
import type { BinderDef, BinderFilter, BinderFilterGroup, EnrichedCard } from '../types';

const OTAG_INDEX_URL =
  (import.meta.env.VITE_OTAG_INDEX_URL as string | undefined) ?? '/otag-index.json';

interface OtagIndex {
  generatedAt: string;
  /** Parallel array; `cards` values are indices into it. */
  tags: { s: string; l: string; d: string }[];
  cards: Record<string, number[]>;
}

/**
 * Slugs that existing binder rules may have persisted under the old 23-tag
 * vocabulary but that the full corpus names differently. A card matching the
 * modern slug also gets the legacy one, so saved rules keep matching without a
 * migration. Additive only — never remove an entry, rules are user data.
 */
const LEGACY_TAG_ALIASES: Record<string, string> = {
  boardwipe: 'sweeper',
  'graveyard-hate': 'hate-graveyard',
  sacrifice: 'sacrifice-outlet',
};

/** name → tags, e.g. "Sol Ring" → ["mana-rock", "ramp"]. Null until loaded. */
let tagsByName: Map<string, string[]> | null = null;
/** Sorted list of tag slugs present in the corpus (for the editor picker). */
let availableTags: string[] = [];
/** slug → { label, description } from the corpus, for UI copy. */
let tagMeta: Map<string, { label: string; description: string }> = new Map();
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

/** True after a load attempt failed (cleared when a retry starts). */
let loadFailed = false;
export function isCardTagsFailed(): boolean {
  return loadFailed;
}

/** Idempotent load of the tag snapshot. Safe to call repeatedly — a failed
 *  attempt can be retried by calling again (the promise clears on settle). */
export async function ensureCardTags(): Promise<void> {
  if (tagsByName) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      if (loadFailed) {
        loadFailed = false;
        emit();
      }
      const res = await fetch(OTAG_INDEX_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: OtagIndex = await res.json();

      const slugs = data.tags.map((t) => t.s);
      tagMeta = new Map(data.tags.map((t) => [t.s, { label: t.l, description: t.d }]));
      // Legacy slug → the modern slug it now lives under, inverted so the load
      // below can append the legacy name to any card carrying the modern one.
      const legacyBySlug = new Map<string, string[]>();
      for (const [legacy, modern] of Object.entries(LEGACY_TAG_ALIASES)) {
        const list = legacyBySlug.get(modern);
        if (list) list.push(legacy);
        else legacyBySlug.set(modern, [legacy]);
      }

      const byName = new Map<string, string[]>();
      for (const [name, ids] of Object.entries(data.cards)) {
        const tags: string[] = [];
        for (const id of ids) {
          const slug = slugs[id];
          if (slug === undefined) continue;
          tags.push(slug);
          const legacy = legacyBySlug.get(slug);
          if (legacy) tags.push(...legacy);
        }
        byName.set(name, tags);
      }
      tagsByName = byName;
      availableTags = [...slugs].sort();
      emit();
    } catch (err) {
      loadFailed = true;
      emit();
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

/** Tag keys available in the corpus. Empty until loaded. */
export function listCardTags(): string[] {
  return availableTags;
}

/** Scryfall's own description for a tag, or '' when it has none / isn't loaded.
 *  Only ~29% of the corpus carries one, so callers must handle the empty case. */
export function cardTagDescription(tag: string): string {
  return tagMeta.get(tag)?.description ?? '';
}

/** A few tags whose kebab key doesn't title-case cleanly. Takes precedence over
 *  the corpus label, which is usually just the slug repeated. */
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
  const curated = TAG_LABELS[tag];
  if (curated) return curated;
  // Corpus labels are frequently the slug verbatim; title-case either way.
  const raw = tagMeta.get(tag)?.label || tag;
  return raw.charAt(0).toUpperCase() + raw.slice(1).replace(/-/g, ' ');
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

/** Subscribe to load-failure state — pair with {@link useCardTagsReady} so a
 *  fetch failure surfaces as an error (with retry) instead of a forever
 *  spinner. Cleared when a retry attempt starts. */
export function useCardTagsError(): boolean {
  return useSyncExternalStore(subscribe, isCardTagsFailed, isCardTagsFailed);
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
