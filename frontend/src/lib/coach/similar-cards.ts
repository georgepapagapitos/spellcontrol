/**
 * "Cards like this one" — a pure, offline similarity scorer for a single deck
 * card. Given a focused card and a pool of candidates, it ranks the candidates
 * by how mechanically alike they are, so the deck-view carousel can surface
 * replacement / discovery suggestions ("here's what you could swap this for").
 *
 * Similarity is the sum of four explainable layers (max 1.0):
 *   - Synergy-axis overlap (0.50) — the dominant signal. Two cards are alike if
 *     they play the same engine role: both make tokens, both pay off sacrifice,
 *     etc. Computed as the Jaccard overlap of their `(axis, side)` pairs from the
 *     shared 23-axis classifier (`classifyCard`), which reads real oracle text.
 *   - Tagger role match (0.25) — same functional role (ramp / removal / boardwipe
 *     / cardDraw). Catches role-homogeneous swaps two rocks that the axis
 *     classifier may split because their text differs. Roles are *injected* by
 *     the caller (the tagger is keyed by card name, not card data) so this module
 *     stays pure and unit-testable.
 *   - CMC proximity (0.15) — keeps the curve intact when swapping.
 *   - Primary-type match (0.10) — don't offer a land as a replacement for a
 *     creature.
 *
 * Pure + isomorphic: no React, no store, no network. The candidate pool, each
 * candidate's live ownership/inclusion, and both cards' tagger roles are all
 * supplied by the caller. Lives in `src/lib/**` so it's coverage-gated.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';
import { axisKeys, axisJaccard, sharedAxisNames } from './axis-overlap';
import { withinColorIdentity } from './card-matching';
import type { ChangeOwnership } from './deck-change';

/** The focused card the suggestions are "like". */
export interface SimilarTarget {
  card: ScryfallCard;
  /** Tagger role of the target, injected by the caller (`getCardRole`). */
  role?: RoleKey | null;
}

/** One candidate to score against the target. */
export interface SimilarInput {
  card: ScryfallCard;
  /** Live, render-time ownership — drives the owned-first sort. Never cached. */
  ownership?: ChangeOwnership;
  /** Free (unallocated) copies the user owns — for the "N free" badge. */
  freeCount?: number;
  /** EDHREC inclusion % for this commander, if known — a ranking tiebreak. */
  inclusion?: number;
  /** Tagger role of the candidate, injected by the caller (`getCardRole`). */
  role?: RoleKey | null;
}

export interface SimilarCardsOptions {
  /**
   * Commander color identity. Candidates whose color identity isn't a subset of
   * this are dropped (a card you can't legally run isn't a replacement). Omit to
   * skip the filter.
   */
  identity?: string[];
  /** Max results returned. Default 6. */
  maxResults?: number;
  /** Noise floor — candidates scoring below this are dropped. Default 0.15. */
  minScore?: number;
}

export interface SimilarCandidate {
  name: string;
  card: ScryfallCard;
  /** Total similarity, 0–1. */
  score: number;
  ownership?: ChangeOwnership;
  freeCount?: number;
  inclusion?: number;
  /** Axis keys both cards share — the explainable "why these are alike". */
  sharedAxes: string[];
}

// ── Layer weights (sum to 1.0) ──
const W_AXIS = 0.5;
const W_ROLE = 0.25;
const W_CMC = 0.15;
const W_TYPE = 0.1;

const DEFAULT_MAX = 6;
const DEFAULT_MIN_SCORE = 0.15;

/**
 * Magic's primary card types, in the order we resolve a card's *single* primary
 * type from its type line (a "Land Creature" reads as Land for curve purposes;
 * lands never count toward the curve).
 */
const PRIMARY_TYPES = [
  'Land',
  'Creature',
  'Planeswalker',
  'Battle',
  'Artifact',
  'Enchantment',
  'Instant',
  'Sorcery',
] as const;

/** The primary type of a card, or '' when none of the known types appear. */
export function primaryType(typeLine: string | undefined): string {
  if (!typeLine) return '';
  // Only the left of the em-dash is the type; the right is subtypes.
  const left = typeLine.split('—')[0] ?? typeLine;
  for (const t of PRIMARY_TYPES) {
    if (left.includes(t)) return t;
  }
  return '';
}

/** CMC-delta → contribution (closer curve = more alike). */
function cmcContribution(a: number | undefined, b: number | undefined): number {
  if (a == null || b == null) return 0;
  const delta = Math.abs(a - b);
  if (delta === 0) return W_CMC;
  if (delta === 1) return W_CMC * (2 / 3); // 0.10
  if (delta === 2) return W_CMC * (1 / 3); // 0.05
  return 0;
}

/**
 * Score one candidate against the target. Pure — pass both tagger roles in.
 * Returns the 0–1 similarity plus the axis names the two cards share.
 */
export function scoreSimilarity(
  target: SimilarTarget,
  candidate: SimilarInput
): { score: number; sharedAxes: string[] } {
  const targetAxes = axisKeys(target.card);
  const candAxes = axisKeys(candidate.card);

  // Layer 1 — synergy-axis Jaccard.
  const shared = sharedAxisNames(targetAxes, candAxes);
  const axisScore = axisJaccard(targetAxes, candAxes) * W_AXIS;

  // Layer 2 — tagger role match.
  const roleScore = target.role && candidate.role && target.role === candidate.role ? W_ROLE : 0;

  // Layer 3 — CMC proximity.
  const cmcScore = cmcContribution(target.card.cmc, candidate.card.cmc);

  // Layer 4 — primary-type match.
  const typeScore =
    primaryType(target.card.type_line) &&
    primaryType(target.card.type_line) === primaryType(candidate.card.type_line)
      ? W_TYPE
      : 0;

  return { score: axisScore + roleScore + cmcScore + typeScore, sharedAxes: shared };
}

/** Owned (free copy) ranks above only-in-other-deck, above unowned. */
function ownershipRank(o: ChangeOwnership): number {
  if (o === 'owned') return 0;
  if (o === 'in-other-deck') return 1;
  return 2;
}

/**
 * Rank a pool of candidates by similarity to `target`. Drops the target itself,
 * off-identity cards (when `opts.identity` is given), and anything below the
 * noise floor. Sorts owned-first → score desc → inclusion desc → name, then caps
 * to `maxResults`.
 */
export function computeSimilarCards(
  target: SimilarTarget,
  pool: readonly SimilarInput[],
  opts: SimilarCardsOptions = {}
): SimilarCandidate[] {
  const maxResults = opts.maxResults ?? DEFAULT_MAX;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
  const targetName = target.card.name.toLowerCase();

  const scored: SimilarCandidate[] = [];
  const seen = new Set<string>();
  for (const cand of pool) {
    const name = cand.card.name;
    const key = name.toLowerCase();
    if (key === targetName || seen.has(key)) continue;
    if (
      opts.identity &&
      opts.identity.length > 0 &&
      !withinColorIdentity(cand.card, opts.identity)
    ) {
      continue;
    }
    const { score, sharedAxes } = scoreSimilarity(target, cand);
    if (score < minScore) continue;
    seen.add(key);
    scored.push({
      name,
      card: cand.card,
      score,
      ownership: cand.ownership,
      freeCount: cand.freeCount,
      inclusion: cand.inclusion,
      sharedAxes,
    });
  }

  scored.sort((a, b) => {
    const own = ownershipRank(a.ownership) - ownershipRank(b.ownership);
    if (own !== 0) return own;
    if (b.score !== a.score) return b.score - a.score;
    const incl = (b.inclusion ?? -1) - (a.inclusion ?? -1);
    if (incl !== 0) return incl;
    return a.name.localeCompare(b.name);
  });

  return scored.slice(0, maxResults);
}
