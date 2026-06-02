/**
 * The canonical shared model for the Tune-tab "prescription" surfaces.
 *
 * The Tune tab consolidates several deck-tuning surfaces (Fill the gaps /
 * Upgrade power / Fit a budget / Build from my binder) plus an in-context
 * carousel "Swap this card" view. Each surface used to render its own bespoke
 * card row; this module gives them one shared `Change` shape so a lane and the
 * card-preview can never disagree about a recommendation, and the shared
 * `<DeckCardRow>` can render any of them.
 *
 * `Change` is a *render* model — ownership is always re-derived live by the
 * caller (never read from a persisted `isOwned` snapshot, which goes stale), and
 * the full `ScryfallCard` is carried only when already resolved; thin EDHREC
 * rows carry `name` + `imageUrl` and resolve lazily on apply.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import { parsePrice } from '@/deck-builder/services/deckBuilder/costAnalyzer';

export { parsePrice };

export type ChangeType = 'add' | 'cut' | 'swap';

/** The four intent lanes. The hero is a router, not a Change-owning lane. */
export type LaneId = 'fill-gaps' | 'upgrade' | 'budget' | 'binder';

/**
 * Allocation-aware ownership, evaluated at render time:
 * - `owned`         — at least one free (unallocated) copy in the collection.
 * - `in-other-deck` — owned, but every copy is claimed by another deck.
 * - `unowned`       — not in the collection.
 * - `undefined`     — ownership intentionally not evaluated (a cut side is
 *   ownership-blind; you remove a card regardless of whether you own it).
 */
export type ChangeOwnership = 'owned' | 'in-other-deck' | 'unowned' | undefined;

export interface Change {
  /** Stable key, survives re-sorts. cut → slotId; add → `lane:name`; swap → currentName. */
  id: string;
  /** add = net add · cut = remove only · swap = matched remove+add. */
  type: ChangeType;
  /** Owning lane — decides which apply handler commits it. */
  lane: LaneId;

  /** The card the row is about. For a swap this is the card being CUT. */
  name: string;
  /** Full card, only when already resolved (in-deck/removal rows). Thin EDHREC rows omit it. */
  card?: ScryfallCard;

  /** swap only — the replacement being added. */
  inName?: string;
  inCard?: ScryfallCard;

  /** Data-grounded "why" — already the verdict/category copy per surface. */
  reason: string;

  /**
   * Ownership at render time. Re-derive live; never cache from a persisted
   * snapshot. Leave undefined on the cut side (ownership-blind).
   */
  ownership?: ChangeOwnership;

  /**
   * Signed quality delta (PlanScore-ish, a rough inclusion proxy where it
   * exists). `undefined` means "unknown" — summers must NOT coerce it to 0.
   */
  deltaScore?: number;
  /** Signed USD delta. add = +acquire · cut = -value freed · swap = signed (negative = savings). */
  deltaPrice?: number;

  // ── MTG metadata (renders the "why", drives sort + correctness) ──
  /** Functional role key: 'ramp' | 'removal' | 'boardwipe' | 'cardDraw'. */
  role?: string;
  /** Display label: 'Ramp' | 'Removal' | 'Board Wipes' | 'Card Advantage'. */
  roleLabel?: string;
  /** EDHREC inclusion % (0–100). Primary sort key for fill-gaps. undefined → "Off-meta". */
  inclusion?: number;
  /** EDHREC synergy delta. Secondary signal; can be negative. */
  synergy?: number;
  /** Game-changer (bracket-relevant high-power) — must survive (protection + correctness). */
  isGameChanger?: boolean;
  /** Native-engine load-bearing synergy axis card — drives the "Synergy" accent. */
  isThemeSynergy?: boolean;
  /** Section-grouping key (Optimize reasonCategory, Engine axis label, …). */
  group?: string;
  /** Engine axis completion — which half of which synergy axis this fills. */
  axis?: string;
  side?: 'producer' | 'payoff';

  /** Curve-phase filtering + type display. Both can be undefined (thin EDHREC schema). */
  cmc?: number;
  typeLine?: string;
  /** Thumbnail; the row falls back to a Scryfall named-image CDN when absent. */
  imageUrl?: string;
}

/** Sort rank: a free owned copy beats an only-in-other-deck copy beats unowned. */
function ownershipRank(o: ChangeOwnership): number {
  if (o === 'owned') return 0;
  if (o === 'in-other-deck') return 1;
  return 2; // 'unowned' or undefined
}

/**
 * Owned-first ordering (the locked default): an owned card that fills a role
 * surfaces above the unowned staple, then by EDHREC inclusion descending.
 * Stable — equal-rank rows keep their input order.
 */
export function sortOwnedFirst<T extends Change>(changes: readonly T[]): T[] {
  return changes
    .map((change, index) => ({ change, index }))
    .sort((a, b) => {
      const rank = ownershipRank(a.change.ownership) - ownershipRank(b.change.ownership);
      if (rank !== 0) return rank;
      const incl = (b.change.inclusion ?? -1) - (a.change.inclusion ?? -1);
      if (incl !== 0) return incl;
      return a.index - b.index; // stable
    })
    .map((x) => x.change);
}

export interface LaneSummary {
  addCount: number;
  cutCount: number;
  /** Net card-count change (adds − cuts) — apply keeps the deck legal at its target. */
  net: number;
  /** Σ of defined `deltaScore`; `null` when none are known (never silently 0). */
  scoreDelta: number | null;
  /** Σ of defined `deltaPrice`; `null` when none parse. */
  priceDelta: number | null;
}

/** Roll a lane's changes into its header summary. undefined deltas stay unknown. */
export function laneSummary(changes: readonly Change[]): LaneSummary {
  let addCount = 0;
  let cutCount = 0;
  let scoreDelta: number | null = null;
  let priceDelta: number | null = null;

  for (const c of changes) {
    if (c.type === 'add' || c.type === 'swap') addCount += 1;
    if (c.type === 'cut' || c.type === 'swap') cutCount += 1;
    if (typeof c.deltaScore === 'number') scoreDelta = (scoreDelta ?? 0) + c.deltaScore;
    if (typeof c.deltaPrice === 'number') priceDelta = (priceDelta ?? 0) + c.deltaPrice;
  }

  return { addCount, cutCount, net: addCount - cutCount, scoreDelta, priceDelta };
}

/**
 * Adapt an off-meta synergy suggestion (the relocated Engine "Synergy picks")
 * into an add Change for the Upgrade lane. Ownership is supplied by the caller
 * (re-derived live); `inclusion` is undefined for genuinely off-meta picks, so
 * the row renders "Off-meta" rather than 0%.
 */
export function fromSynergySuggestion(s: SynergySuggestion, ownership?: ChangeOwnership): Change {
  return {
    id: `upgrade:${s.cardName}`,
    type: 'add',
    lane: 'upgrade',
    name: s.cardName,
    reason: s.reason,
    ownership,
    inclusion: s.inclusion,
    isThemeSynergy: true,
    group: s.axisLabel,
    axis: s.axis,
    side: s.side,
  };
}
