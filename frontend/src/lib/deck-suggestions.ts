import type { GapAnalysisCard, HiddenGemRow, HiddenGemSignal } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import type { ChangeOwnership } from './deck-change';
import { normalizeForSearch } from './normalize-search';
import { comboPayoffScore } from './combo-payoff';

/**
 * Physical availability of a suggested card — the same state every Tune
 * surface uses (`ownershipFor`). `owned` = a free/unallocated copy exists, so
 * it's addable tonight; `in-other-deck` = you own copies but they're all
 * claimed by other decks (adding triggers the cross-deck resolver); `in-cube` =
 * owned but every copy is committed to a physical cube; `unowned` = you'd have
 * to acquire it.
 */
export type Ownership = 'owned' | 'in-other-deck' | 'in-cube' | 'unowned';

/**
 * One row in the deck editor's "Suggestions" add-cards tab. All kinds are
 * pure ADD recommendations derived from data already on the deck — EDHREC
 * staples the deck doesn't run yet (`staple`), the single missing card that
 * would complete a one-away combo (`combo`), and underrated hidden gems with
 * lift/similar/axis evidence (`gem`, E146). No new network/computation.
 */
export interface SuggestionRow {
  name: string;
  kind: 'staple' | 'combo' | 'gem';
  ownership: Ownership;
  /** EDHREC inclusion % (staples only). */
  inclusion?: number;
  /** Functional role label, e.g. "Ramp" (staples only). */
  roleLabel?: string;
  imageUrl?: string;
  /** EDHREC price string (staples/gems) — shown for `unowned` buy candidates. */
  price?: string | null;
  /** What completing the combo produces, e.g. "Infinite mana" (combos only). */
  produces?: string;
  /** Evidence behind a gem, strongest first (gems only) — the UI renders the
   *  copy via hiddenGemSignalCopy so the fixed vocabulary lives in one place. */
  signals?: HiddenGemSignal[];
}

/** How many actionable suggestions fall in each availability bucket (pre-filter). */
export interface SuggestionCounts {
  owned: number;
  inOtherDeck: number;
  inCube: number;
  unowned: number;
}

/** Which availability buckets the filter toggles are currently showing. */
export interface SuggestionFilter {
  owned: boolean;
  inOtherDeck: boolean;
  inCube: boolean;
  unowned: boolean;
}

export interface SuggestionRows {
  staples: SuggestionRow[];
  combos: SuggestionRow[];
  /** Underrated hidden-gem rows (E146), engine-ranked, availability-first. */
  gems: SuggestionRow[];
  /** Totals across every bucket, ignoring `show` — drives the chip counts. */
  counts: SuggestionCounts;
}

// Owned (addable now) sorts above owned-but-committed (deck or cube), which
// sorts above unowned.
const RANK: Record<Ownership, number> = {
  owned: 0,
  'in-other-deck': 1,
  'in-cube': 1,
  unowned: 2,
};

/**
 * Build the Suggestions-tab rows from the deck's live gap analysis + one-away
 * combos. Pure so it's unit-testable and cheap to recompute on every keystroke
 * / toggle.
 *
 * @param ownershipFor live tri-state ownership lookup (the page's `ownershipFor`).
 * @param inDeck lowercased names already in the deck — dropped so a just-added
 *   card disappears immediately.
 * @param show which availability buckets the toggles are showing. `counts` is
 *   always computed over every bucket so toggled-off counts still display.
 */
export function buildSuggestionRows(
  gap: GapAnalysisCard[] | undefined,
  oneAway: ComboMatch[] | undefined,
  opts: {
    ownershipFor: (name: string) => ChangeOwnership;
    query: string;
    inDeck: Set<string>;
    show: SuggestionFilter;
    /** Hidden-gem rows from the deck's analysis (E146). */
    hiddenGems?: HiddenGemRow[];
  }
): SuggestionRows {
  const { ownershipFor, query, inDeck, show, hiddenGems } = opts;
  const nq = normalizeForSearch(query);
  const matchesQuery = (name: string) => !nq || normalizeForSearch(name).includes(nq);
  const ownershipOf = (name: string): Ownership => {
    const o = ownershipFor(name);
    return o === 'owned' || o === 'in-other-deck' || o === 'in-cube' ? o : 'unowned';
  };
  const shown = (o: Ownership) =>
    (o === 'owned' && show.owned) ||
    (o === 'in-other-deck' && show.inOtherDeck) ||
    (o === 'in-cube' && show.inCube) ||
    (o === 'unowned' && show.unowned);

  const counts: SuggestionCounts = { owned: 0, inOtherDeck: 0, inCube: 0, unowned: 0 };
  const tally = (o: Ownership) => {
    if (o === 'owned') counts.owned += 1;
    else if (o === 'in-other-deck') counts.inOtherDeck += 1;
    else if (o === 'in-cube') counts.inCube += 1;
    else counts.unowned += 1;
  };

  // Dedup across both sections (a combo card that's also a staple appears once).
  const seen = new Set<string>();

  // EDHREC staples the deck wants but doesn't run yet. gapAnalysis is already
  // "not in deck", but the deck mutates live, so re-check against `inDeck`.
  const staples: SuggestionRow[] = [];
  for (const g of gap ?? []) {
    if (inDeck.has(g.name.toLowerCase())) continue;
    if (!matchesQuery(g.name)) continue;
    if (seen.has(g.name)) continue;
    seen.add(g.name);
    const ownership = ownershipOf(g.name);
    tally(ownership);
    if (!shown(ownership)) continue;
    staples.push({
      name: g.name,
      kind: 'staple',
      ownership,
      inclusion: g.inclusion,
      roleLabel: g.roleLabel,
      imageUrl: g.imageUrl,
      price: g.price,
    });
  }
  // Available-first, then by inclusion %.
  staples.sort((a, b) =>
    RANK[a.ownership] !== RANK[b.ownership]
      ? RANK[a.ownership] - RANK[b.ownership]
      : (b.inclusion ?? 0) - (a.inclusion ?? 0)
  );

  // One-away combos: each names exactly one missing card. Sort by payoff
  // quality (E83 — a wincon beats a value combo regardless of raw
  // popularity), then by popularity as the tie-break. Skip any card already
  // shown as a staple or already in the deck.
  const combos: SuggestionRow[] = [];
  const sorted = [...(oneAway ?? [])]
    .filter((m) => m.missingOracleIds.length === 1)
    .sort(
      (a, b) =>
        comboPayoffScore(b.combo.produces) - comboPayoffScore(a.combo.produces) ||
        b.combo.popularity - a.combo.popularity
    );
  for (const m of sorted) {
    const card = m.combo.cards.find((c) => c.oracleId === m.missingOracleIds[0]);
    if (!card) continue;
    const key = card.cardName;
    if (inDeck.has(key.toLowerCase())) continue;
    if (seen.has(key)) continue;
    if (!matchesQuery(key)) continue;
    seen.add(key);
    const ownership = ownershipOf(key);
    tally(ownership);
    if (!shown(ownership)) continue;
    combos.push({
      name: key,
      kind: 'combo',
      ownership,
      produces: m.combo.produces.join(' + ') || undefined,
    });
  }

  // Hidden gems (E146): engine-ranked already; availability-first like
  // staples, engine order as the tie-break. A gem that meanwhile became a
  // staple/combo row (or entered the deck) is dropped by the shared dedupe.
  const gems: SuggestionRow[] = [];
  for (const g of hiddenGems ?? []) {
    if (inDeck.has(g.name.toLowerCase())) continue;
    if (seen.has(g.name)) continue;
    if (!matchesQuery(g.name)) continue;
    seen.add(g.name);
    const ownership = ownershipOf(g.name);
    tally(ownership);
    if (!shown(ownership)) continue;
    gems.push({
      name: g.name,
      kind: 'gem',
      ownership,
      price: g.price,
      signals: g.signals,
    });
  }
  const gemRank = new Map(gems.map((g, i) => [g.name, i]));
  gems.sort((a, b) =>
    RANK[a.ownership] !== RANK[b.ownership]
      ? RANK[a.ownership] - RANK[b.ownership]
      : (gemRank.get(a.name) ?? 0) - (gemRank.get(b.name) ?? 0)
  );

  return { staples, combos, gems, counts };
}
