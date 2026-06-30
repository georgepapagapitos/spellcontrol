import type { GapAnalysisCard } from '@/deck-builder/types';
import {
  cardMatchesRole,
  getCardSubtype,
  getCardTags,
  type RoleKey,
} from '@/deck-builder/services/tagger/client';
import { getSimilarRank } from './cardSimilar';
import type { WhyFactor } from '@/lib/why-factors';

/**
 * Owned-substitute finder — for a recommended-but-missing staple, find a card
 * the user already owns that fills the same functional role, within the deck's
 * color identity and not already in the list. Turns a "shopping list" of cards
 * to buy into a "Wanted X → Used Y you own" substitution.
 *
 * Pure and synchronous. Like `costAnalyzer` / `gapAnalysisBuilder`, the output
 * (`SubstituteRow`) is **lean and persistable** — card names + primitives only,
 * never embedded card objects. The owned pool is a lean `SubstituteCandidate[]`
 * (name + color identity + CMC), which the live collection (`EnrichedCard`) and
 * the Scryfall card shape both map onto trivially — keeping this module decoupled
 * from any one card representation.
 *
 * The `reason` string is the verdict copy the substitution UI surfaces (and the
 * planned verdict-badge work reuses): e.g. "Mind Stone fills the 2-mana ramp
 * slot — owned, same mana rock."
 */

/** Minimal owned-card shape the finder needs — maps from `EnrichedCard` or `ScryfallCard`. */
export interface SubstituteCandidate {
  name: string;
  /** WUBRG color-identity keys (`EnrichedCard.colorIdentity` / `ScryfallCard.color_identity`). */
  colorIdentity: string[];
  /** Mana value, for slot-closeness ranking. */
  cmc?: number;
  /** Type line (`EnrichedCard.typeLine` / `ScryfallCard.type_line`), for type-overlap closeness. */
  typeLine?: string;
}

/** A candidate fits when its whole color identity sits inside the deck's (mirrors `fitsColorIdentity`). */
function fitsIdentity(candidate: SubstituteCandidate, identity: string[]): boolean {
  return candidate.colorIdentity.every((c) => identity.includes(c));
}

export interface SubstituteRow {
  /** The missing staple we wanted (EDHREC-recommended, not owned). */
  wantedName: string;
  /** Functional role both cards fill. */
  wantedRole: RoleKey;
  /** Display label for the role (e.g. "Ramp"), if known. */
  wantedRoleLabel?: string;
  /** Mana value of the wanted card's slot, if known. */
  wantedCmc?: number;
  /** The owned card we'll use instead. */
  usedName: string;
  /** True when the owned card shares the wanted card's subtype (mana-rock→mana-rock). */
  usedSubtypeMatch: boolean;
  /** Plain-English rationale (the verdict copy). */
  reason: string;
  /** Grounded breakdown behind `reason` (EDHREC-substitute provenance, subtype,
   *  mana closeness, play-rate) for the <WhyBreakdown> disclosure. */
  whyFactors?: WhyFactor[];
  /** Other owned cards that could fill the same staple, ranked, best-first —
   *  populated only on the primary row by `buildSubstitutionOptions` for the
   *  "N other owned options" expander. Each is itself a full SubstituteRow. */
  alternatives?: SubstituteRow[];
}

export interface SubstitutionPlan {
  /** One row per missing staple we could fill from the collection. */
  rows: SubstituteRow[];
  /** Missing staples with no owned substitute — genuine "buy" decisions. */
  unmatched: string[];
}

export interface SubstituteFinderOptions {
  /** EDHREC inclusion % by card name — ranks closer (more-played) substitutes first. */
  inclusionByName?: Map<string, number>;
}

/** Functional roles the tagger recognizes (mirrors `RoleKey`). */
const ROLE_KEYS = new Set<RoleKey>(['ramp', 'removal', 'boardwipe', 'cardDraw']);

/** Display labels for functional roles (mirrors `gapAnalysisBuilder`'s ROLE_LABELS). */
const ROLE_LABELS: Record<RoleKey, string> = {
  ramp: 'ramp',
  removal: 'removal',
  boardwipe: 'board wipe',
  cardDraw: 'card advantage',
};

/** Narrow `GapAnalysisCard.role` (a free `string`) to a known `RoleKey`, or null. */
function asRoleKey(role: string | undefined): RoleKey | null {
  return role && ROLE_KEYS.has(role as RoleKey) ? (role as RoleKey) : null;
}

/** Humanize a subtype tag for the reason string ("mana-rock" → "mana rock"). */
function humanizeSubtype(subtype: string): string {
  return subtype.replace(/-/g, ' ');
}

interface RankedCandidate {
  card: SubstituteCandidate;
  subtypeMatch: boolean;
  cmcDelta: number;
  similarity: number;
  inclusion: number;
  /** EDHREC similar-list rank for this card vs the wanted staple (0 = closest); Infinity when unindexed. */
  simRank: number;
}

/** Lowercased word set of a type line, dash stripped: "Legendary Creature — Elf Druid" → {legendary, creature, elf, druid}. */
function typeTokens(typeLine: string | undefined): Set<string> {
  if (!typeLine) return new Set();
  return new Set(typeLine.toLowerCase().replace(/[—-]/g, ' ').split(/\s+/).filter(Boolean));
}

/** Jaccard overlap of two sets (0 when either is empty). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Tunable weights for the four similarity terms (sum need not be 1). */
export interface SimilarityWeights {
  tags: number;
  type: number;
  subtype: number;
  cmc: number;
}

// Similarity weights — how "close" an owned card feels to the wanted staple.
// Tags (the tagger's functional fingerprint) dominate; type overlap and exact
// subtype refine; CMC closeness is a gentle nudge.
//
// VALIDATED, not just guessed. substituteFinder.eval.test.ts scores the
// within-role ranking these produce against EDHREC's per-card `similar` lists
// (deck co-occurrence ground truth, independent of the tagger tags this scorer
// consumes). Findings (TUNE=1 grid search + even/odd holdout, 75-staple fixture):
//   • all four terms beat any single term (tags-only 0.21, type-only 0.18 vs 0.44),
//   • the full-set grid optimum (+0.03 nDCG@5) does NOT survive a holdout — the
//     "tuned" weights underperform these on held-out queries, i.e. overfitting.
// So these hand-set values are kept deliberately: holdout-stable at ~0.44
// nDCG@5. That ~0.44 ceiling is also the quantified case for sourcing similarity
// from EDHREC directly (the index) rather than this heuristic, which stays the
// cold-start fallback. Re-validate after regenerating the fixture via
// `node scripts/fetch-edhrec-similar.mjs`; the regression case guards the floor.
export const DEFAULT_SIMILARITY_WEIGHTS: SimilarityWeights = {
  tags: 0.5,
  type: 0.25,
  subtype: 0.15,
  cmc: 0.1,
};

/**
 * How closely an owned candidate mirrors the wanted card (0–1ish). Combines the
 * tagger functional fingerprint (Jaccard over all tags), type-line overlap,
 * exact subtype match, and CMC closeness. Both cards are already role-matched,
 * so this picks the *closest* same-role card rather than just any same-role one.
 */
export function similarityScore(
  missing: GapAnalysisCard,
  candidate: SubstituteCandidate,
  subtypeMatch: boolean,
  cmcDelta: number,
  weights: SimilarityWeights = DEFAULT_SIMILARITY_WEIGHTS
): number {
  const tagSim = jaccard(new Set(getCardTags(missing.name)), new Set(getCardTags(candidate.name)));
  const typeSim = jaccard(typeTokens(missing.typeLine), typeTokens(candidate.typeLine));
  const cmcSim = Number.isFinite(cmcDelta) ? 1 / (1 + cmcDelta) : 0;
  return (
    weights.tags * tagSim +
    weights.type * typeSim +
    weights.subtype * (subtypeMatch ? 1 : 0) +
    weights.cmc * cmcSim
  );
}

/**
 * Find the single best owned card to substitute for one missing staple, or null
 * when nothing in the collection fits (→ a genuine "buy"). Candidates must be
 * owned, in color identity, role-matched, and not already in the deck.
 *
 * Ranking (best first): highest similarity (tags + type + subtype + CMC), then
 * highest EDHREC inclusion, then name (for determinism).
 */
/**
 * Rank every owned card that could substitute `missing`, best-first. The shared
 * core of `findOwnedSubstitute` (takes `[0]`) and `buildSubstitutionOptions`
 * (takes the top-N). Returns null when the staple has no matchable role or no
 * owned candidate clears the gates. The validated weights / sort are untouched.
 */
function rankCandidates(
  missing: GapAnalysisCard,
  ownedPool: readonly SubstituteCandidate[],
  deckNames: ReadonlySet<string>,
  identity: string[],
  opts: SubstituteFinderOptions
): { ranked: RankedCandidate[]; role: RoleKey; roleLabel: string } | null {
  const role = asRoleKey(missing.role);
  if (!role) return null; // no role → nothing to match against

  const wantedSubtype = getCardSubtype(missing.name);
  const inclusionByName = opts.inclusionByName;
  // EDHREC's own substitute ranking for this staple (deck co-occurrence). When
  // present it leads the sort; cards it doesn't list keep their heuristic order.
  const simRanks = getSimilarRank(missing.name);

  const ranked: RankedCandidate[] = [];
  for (const card of ownedPool) {
    if (card.name === missing.name) continue; // never substitute a card for itself
    if (deckNames.has(card.name)) continue; // already in the deck
    if (!fitsIdentity(card, identity)) continue; // outside the deck's identity
    if (!cardMatchesRole(card.name, role)) continue; // wrong role

    const subtypeMatch = wantedSubtype != null && getCardSubtype(card.name) === wantedSubtype;
    const cmcDelta =
      missing.cmc != null && card.cmc != null ? Math.abs(card.cmc - missing.cmc) : Infinity;
    ranked.push({
      card,
      subtypeMatch,
      cmcDelta,
      similarity: similarityScore(missing, card, subtypeMatch, cmcDelta),
      inclusion: inclusionByName?.get(card.name) ?? 0,
      simRank: simRanks?.get(card.name) ?? Infinity,
    });
  }

  if (ranked.length === 0) return null;

  ranked.sort((a, b) => {
    // EDHREC similar rank leads (lower = closer; unindexed → Infinity, sorts
    // last), then the validated heuristic, then inclusion, then name.
    if (a.simRank !== b.simRank) return a.simRank - b.simRank;
    if (a.similarity !== b.similarity) return b.similarity - a.similarity;
    if (a.inclusion !== b.inclusion) return b.inclusion - a.inclusion;
    return a.card.name.localeCompare(b.card.name);
  });

  return { ranked, role, roleLabel: missing.roleLabel ?? ROLE_LABELS[role] };
}

/** Turn one ranked candidate into a SubstituteRow (reason + grounded factors). */
function toRow(
  missing: GapAnalysisCard,
  role: RoleKey,
  roleLabel: string,
  cand: RankedCandidate
): SubstituteRow {
  const usedSubtype = getCardSubtype(cand.card.name);
  return {
    wantedName: missing.name,
    wantedRole: role,
    wantedRoleLabel: roleLabel,
    wantedCmc: missing.cmc,
    usedName: cand.card.name,
    usedSubtypeMatch: cand.subtypeMatch,
    reason: buildReason(
      cand.card.name,
      roleLabel,
      missing.cmc,
      cand.subtypeMatch,
      usedSubtype,
      cand.simRank !== Infinity ? missing.name : null
    ),
    whyFactors: buildSubstituteFactors(missing, cand, usedSubtype),
  };
}

/**
 * Grounded "why this owned card fills the staple" — purpose-built for the
 * collection lane (every row is owned, so ownership is not restated). Leads with
 * EDHREC-substitute provenance (the strongest signal), then subtype/mana
 * closeness, then the owned card's own play-rate. No fabricated "% match" — the
 * heuristic similarity tops out at ~0.44 nDCG, so the relative *rank* carries
 * fit, not a false precision.
 */
function buildSubstituteFactors(
  missing: GapAnalysisCard,
  cand: RankedCandidate,
  usedSubtype: string | null
): WhyFactor[] {
  const out: WhyFactor[] = [];
  if (cand.simRank !== Infinity) {
    out.push({ text: `A common substitute for ${missing.name} on EDHREC`, tone: 'pro' });
  }
  if (cand.subtypeMatch && usedSubtype) {
    out.push({
      text: `Same ${humanizeSubtype(usedSubtype)} — fills the slot like-for-like`,
      tone: 'pro',
    });
  }
  if (cand.cmcDelta === 0) out.push({ text: 'Same mana cost', tone: 'pro' });
  else if (cand.cmcDelta === 1) out.push({ text: 'Within 1 mana of the staple', tone: 'neutral' });
  if (cand.inclusion > 0) {
    out.push({
      text: `Played in ${Math.round(cand.inclusion)}% of similar decks`,
      tone: cand.inclusion >= 50 ? 'pro' : 'neutral',
    });
  }
  return out;
}

/**
 * For a recommended-but-missing staple, the single best owned card that fills
 * its role. See {@link rankCandidates} for the gates + sort.
 */
export function findOwnedSubstitute(
  missing: GapAnalysisCard,
  ownedPool: readonly SubstituteCandidate[],
  deckNames: ReadonlySet<string>,
  identity: string[],
  opts: SubstituteFinderOptions = {}
): SubstituteRow | null {
  const r = rankCandidates(missing, ownedPool, deckNames, identity, opts);
  if (!r) return null;
  return toRow(missing, r.role, r.roleLabel, r.ranked[0]);
}

/**
 * Compose the verdict sentence. When `similarTo` is set, the pick came from
 * EDHREC's similar list (deck co-occurrence) rather than the heuristic, so the
 * copy cites that stronger provenance.
 */
function buildReason(
  usedName: string,
  roleLabel: string,
  wantedCmc: number | undefined,
  subtypeMatch: boolean,
  usedSubtype: string | null,
  similarTo: string | null = null
): string {
  const slot = wantedCmc != null ? `${wantedCmc}-mana ${roleLabel}` : roleLabel;
  if (similarTo) {
    return `${usedName} fills the ${slot} slot — owned, a common substitute for ${similarTo}.`;
  }
  const tail = subtypeMatch && usedSubtype ? `same ${humanizeSubtype(usedSubtype)}` : 'same role';
  return `${usedName} fills the ${slot} slot — owned, ${tail}.`;
}

/**
 * Build the full substitution plan for a set of missing staples: greedily assign
 * each staple the best owned substitute, with each owned card offered to at most
 * one staple (so two missing ramp pieces don't both claim the same Mind Stone).
 * Staples processed in input order — pass them ranked (e.g. by inclusion) so the
 * most-wanted staples get first pick of the collection.
 *
 * Pure. Staples with no owned fit land in `unmatched` (genuine buys).
 */
export function buildSubstitutionPlan(
  missingStaples: readonly GapAnalysisCard[],
  ownedPool: readonly SubstituteCandidate[],
  deckNames: ReadonlySet<string>,
  identity: string[],
  opts: SubstituteFinderOptions = {}
): SubstitutionPlan {
  const rows: SubstituteRow[] = [];
  const unmatched: string[] = [];
  const claimed = new Set<string>();

  for (const missing of missingStaples) {
    // Hide already-claimed owned cards from this staple's search.
    const pool = claimed.size === 0 ? ownedPool : ownedPool.filter((c) => !claimed.has(c.name));
    const row = findOwnedSubstitute(missing, pool, deckNames, identity, opts);
    if (row) {
      rows.push(row);
      claimed.add(row.usedName);
    } else {
      unmatched.push(missing.name);
    }
  }

  return { rows, unmatched };
}

/**
 * Like {@link buildSubstitutionPlan}, but each primary row carries up to
 * `topN - 1` ranked `alternatives` — other owned cards that fill the same staple
 * — for the Coach "N other owned options" expander. Deck generation keeps using
 * the greedy single-pick `buildSubstitutionPlan`; this is the feed-only,
 * compare-on-demand variant.
 *
 * Two passes, so an alternative is never a card already chosen as another
 * staple's primary (which would imply applying the same physical copy twice):
 * pass 1 greedily claims primaries; pass 2 fills each row's alternatives from
 * its ranked list, excluding every claimed primary.
 */
export function buildSubstitutionOptions(
  missingStaples: readonly GapAnalysisCard[],
  ownedPool: readonly SubstituteCandidate[],
  deckNames: ReadonlySet<string>,
  identity: string[],
  opts: SubstituteFinderOptions = {},
  topN = 3
): SubstitutionPlan {
  const rows: SubstituteRow[] = [];
  const unmatched: string[] = [];
  const claimed = new Set<string>();
  const ranking = new Map<
    string,
    { missing: GapAnalysisCard; ranked: RankedCandidate[]; role: RoleKey; roleLabel: string }
  >();

  // Pass 1: greedy primaries (each owned card claimed by at most one staple).
  for (const missing of missingStaples) {
    const pool = claimed.size === 0 ? ownedPool : ownedPool.filter((c) => !claimed.has(c.name));
    const r = rankCandidates(missing, pool, deckNames, identity, opts);
    if (!r) {
      unmatched.push(missing.name);
      continue;
    }
    rows.push(toRow(missing, r.role, r.roleLabel, r.ranked[0]));
    claimed.add(r.ranked[0].card.name);
    ranking.set(missing.name, { missing, ...r });
  }

  // Pass 2: alternatives = the staple's remaining ranked candidates, minus any
  // card claimed as another staple's primary, capped to topN-1.
  for (const row of rows) {
    const r = ranking.get(row.wantedName);
    if (!r) continue;
    const alts = r.ranked
      .slice(1)
      .filter((c) => !claimed.has(c.card.name))
      .slice(0, Math.max(0, topN - 1))
      .map((c) => toRow(r.missing, r.role, r.roleLabel, c));
    if (alts.length > 0) row.alternatives = alts;
  }

  return { rows, unmatched };
}
