/**
 * A card's token output, distilled from Scryfall's `all_parts`.
 *
 * Its own module because **two** cache-writing paths need it and neither may
 * import the other: the offline slim bundle (`offline/bulk-cache.ts`) and the
 * shared SQLite card cache (`scryfall-bulk.ts`). Pushing the shared leaf down
 * here rather than importing sideways is the same rule the frontend's
 * import-cycle guard enforces.
 */

/** One token (or emblem) a card can create. Mirrors the frontend's
 *  `CardToken` and the offline bundle's `SlimTokenRef` — the same two fields,
 *  because a physical-token prep checklist needs a name and a type line and
 *  nothing else. */
export interface CardTokenRef {
  name: string;
  typeLine?: string;
}

/** The `all_parts` shape this reads — only what it needs, so both callers'
 *  card types satisfy it structurally. */
export interface RelatedPart {
  component?: string;
  name?: string;
  type_line?: string;
}

/**
 * Keep only the `component === 'token'` entries (tokens and emblems), dedupe
 * by name + type line, and drop everything else — the card itself, and
 * meld/combo parts, which are cards rather than things the card creates.
 *
 * Returns undefined when the card makes no tokens, so the field stays absent
 * rather than storing an empty array on the ~90% of cards that make none.
 */
export function tokensFromParts(
  parts: readonly RelatedPart[] | undefined
): CardTokenRef[] | undefined {
  if (!parts || parts.length === 0) return undefined;
  const seen = new Set<string>();
  const out: CardTokenRef[] = [];
  for (const p of parts) {
    if (p.component !== 'token' || !p.name) continue;
    const key = `${p.name} ${p.type_line ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p.type_line ? { name: p.name, typeLine: p.type_line } : { name: p.name });
  }
  return out.length > 0 ? out : undefined;
}
