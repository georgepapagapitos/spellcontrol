import type { GapAnalysisCard } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import { normalizeForSearch } from './normalize-search';

/**
 * One row in the deck editor's "Suggestions" add-cards tab. Both kinds are
 * pure ADD recommendations derived from data already on the deck — EDHREC
 * staples the deck doesn't run yet (`staple`) and the single missing card that
 * would complete a one-away combo (`combo`). No new network/computation.
 */
export interface SuggestionRow {
  name: string;
  kind: 'staple' | 'combo';
  /** Whether the user owns at least one copy — drives owned-first ordering. */
  owned: boolean;
  /** EDHREC inclusion % (staples only). */
  inclusion?: number;
  /** Functional role label, e.g. "Ramp" (staples only). */
  roleLabel?: string;
  imageUrl?: string;
  /** What completing the combo produces, e.g. "Infinite mana" (combos only). */
  produces?: string;
}

export interface SuggestionRows {
  staples: SuggestionRow[];
  combos: SuggestionRow[];
}

/**
 * Build the Suggestions-tab rows from the deck's live gap analysis + one-away
 * combos. Pure so it's unit-testable and cheap to recompute on every keystroke.
 *
 * @param inDeck lowercased names already in the deck — staples/combos for these
 *   are dropped so a just-added card disappears from the list immediately.
 */
export function buildSuggestionRows(
  gap: GapAnalysisCard[] | undefined,
  oneAway: ComboMatch[] | undefined,
  opts: { ownedNames: Set<string>; query: string; inDeck: Set<string> }
): SuggestionRows {
  const { ownedNames, query, inDeck } = opts;
  const nq = normalizeForSearch(query);
  const matchesQuery = (name: string) => !nq || normalizeForSearch(name).includes(nq);
  // Owned/in-deck checks are case-insensitive: gap/combo names come from EDHREC
  // + Spellbook, ownedNames/inDeck from collection imports — sources that can
  // disagree on capitalization.
  const owned = new Set([...ownedNames].map((n) => n.toLowerCase()));
  const isOwned = (name: string) => owned.has(name.toLowerCase());

  // EDHREC staples the deck wants but doesn't run yet. gapAnalysis is already
  // "not in deck", but the deck mutates live, so re-check against `inDeck`.
  const seen = new Set<string>();
  const staples: SuggestionRow[] = [];
  for (const g of gap ?? []) {
    if (inDeck.has(g.name.toLowerCase())) continue;
    if (!matchesQuery(g.name)) continue;
    if (seen.has(g.name)) continue;
    seen.add(g.name);
    staples.push({
      name: g.name,
      kind: 'staple',
      owned: isOwned(g.name),
      inclusion: g.inclusion,
      roleLabel: g.roleLabel,
      imageUrl: g.imageUrl,
    });
  }
  // Owned-first (zero-cost adds surface up top), then by inclusion %.
  staples.sort((a, b) =>
    a.owned !== b.owned ? (a.owned ? -1 : 1) : (b.inclusion ?? 0) - (a.inclusion ?? 0)
  );

  // One-away combos: each names exactly one missing card. Sort by popularity,
  // skip any card already shown as a staple or already in the deck.
  const combos: SuggestionRow[] = [];
  const sorted = [...(oneAway ?? [])]
    .filter((m) => m.missingOracleIds.length === 1)
    .sort((a, b) => b.combo.popularity - a.combo.popularity);
  for (const m of sorted) {
    const card = m.combo.cards.find((c) => c.oracleId === m.missingOracleIds[0]);
    if (!card) continue;
    const key = card.cardName;
    if (inDeck.has(key.toLowerCase())) continue;
    if (seen.has(key)) continue; // already a staple row, or a dup combo
    if (!matchesQuery(key)) continue;
    seen.add(key);
    combos.push({
      name: key,
      kind: 'combo',
      owned: isOwned(key),
      produces: m.combo.produces.join(' + ') || undefined,
    });
  }

  return { staples, combos };
}
